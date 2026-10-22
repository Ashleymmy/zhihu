import type { AuthUser } from '../../../types';
import type {
  MemberActivityProvider,
  MemberActivityCounts,
  MemberActivityFilter,
  MemberActivityRecord,
  TaskScope,
} from '../../../core/contracts';
import { canViewWorkStatistics } from '../../../auth/roles';
import { assertDuty } from '../../../core/duties';
import { AppError } from '../../../middleware/errors';
import { withTransaction } from '../../../db';
import { authorize, select, type RecordRow } from './store';
import { filteredQuery } from './works';
import { submissionFailure } from '../services/submission-feedback';

const zero = (): MemberActivityCounts => ({ tasks: 0, currentTasks: 0, verifiedTasks: 0, works: 0 });
const str = (v: unknown) => (v == null ? '' : String(v));
const safeUrl = (v: unknown) => (/^https?:\/\//i.test(str(v)) ? str(v) : undefined);
async function access(scopes: TaskScope[], user: AuthUser) {
  if (!canViewWorkStatistics(user.role)) throw new AppError(403, 40300, '仅管理员和开发者可查看成员任务及作品统计');
  assertDuty(user, 'operations');
  if (!scopes.length) throw new AppError(403, 40304, '没有可查看的项目');
  for (const scope of scopes) await authorize(user, scope);
}
function tasks(scopes: TaskScope[], ids: string[], f?: MemberActivityFilter) {
  const where = [
    `(${scopes.map(() => '(k.project_id=? AND k.account_id=?)').join(' OR ')})`,
    'p.project_id=k.project_id',
    'COALESCE(b.executor_id,b.leader_id) IN (?)',
  ];
  const args: unknown[] = [...scopes.flatMap((s) => [s.projectId, s.accountId]), ids];
  if (f?.status === 'current') where.push('b.released_at IS NULL');
  if (f?.status === 'released') where.push('b.released_at IS NOT NULL');
  if (f?.status === 'verified') where.push("b.verification_status='passed'");
  if (f?.from) {
    where.push('COALESCE(b.assigned_at,b.claimed_at)>=?');
    args.push(f.from);
  }
  if (f?.to) {
    where.push('COALESCE(b.assigned_at,b.claimed_at)<DATE_ADD(?,INTERVAL 1 DAY)');
    args.push(f.to);
  }
  if (f?.taskRef) {
    where.push('CAST(p.id AS CHAR)=?');
    args.push(f.taskRef);
  }
  if (f?.search) {
    where.push("(LOCATE(?,p.keyword)>0 OR LOCATE(?,COALESCE(p.novel_title,''))>0)");
    args.push(f.search, f.search);
  }
  return {
    query: `SELECT CAST(b.id AS CHAR) id,CAST(COALESCE(b.executor_id,b.leader_id) AS CHAR) member_id,
    CAST(k.project_id AS CHAR) project_id,CAST(k.account_id AS CHAR) account_id,CAST(p.id AS CHAR) plan_id,
    p.keyword,p.novel_title,COALESCE(NULLIF(p.novel_url,''),p.landing_url) novel_url,p.sync_status,p.sync_error,p.status plan_status,
    b.executor_id,b.released_at,b.stop_new_use_at,b.verification_status,b.release_reason,
    DATE_FORMAT(COALESCE(b.assigned_at,b.claimed_at),'%Y-%m-%d %H:%i:%s') at,
    DATE_FORMAT(b.released_at,'%Y-%m-%d %H:%i:%s') released_time,
    DATE_FORMAT(b.activated_on,'%Y-%m-%d') activated_on,
    t.name activity,cm.channel_name,leader.display_name leader_name
    FROM zh_keyword_bindings b JOIN zh_keywords k ON k.id=b.keyword_id JOIN plans p ON p.id=k.plan_id
    LEFT JOIN tasks t ON t.id=k.task_id AND t.project_id=k.project_id
    LEFT JOIN zh_channel_mappings cm ON cm.id=k.channel_mapping_id
    LEFT JOIN users leader ON leader.id=b.leader_id WHERE ${where.join(' AND ')}`,
    args,
  };
}
function works(scopes: TaskScope[], user: AuthUser, ids: string[], f?: MemberActivityFilter) {
  const queries = scopes.map((s) => {
    const q = filteredQuery(user, s, { from: f?.from, to: f?.to, planId: f?.taskRef });
    const search = f?.search
      ? ` AND (LOCATE(?,COALESCE(records.keyword,''))>0 OR LOCATE(?,COALESCE(records.work_title,''))>0
      OR LOCATE(?,COALESCE(records.description,''))>0 OR LOCATE(?,COALESCE(records.work_url,''))>0
      OR EXISTS(SELECT 1 FROM plans sp WHERE sp.id=records.plan_id AND LOCATE(?,COALESCE(sp.novel_title,''))>0))`
      : '';
    return {
      query: `SELECT records.*,? project_id,? account_id FROM (${q.query}) records WHERE executor_id IN (?)${search}`,
      args: [s.projectId, s.accountId, ...q.args, ids, ...(f?.search ? Array(5).fill(f.search) : [])],
    };
  });
  return { query: queries.map((q) => q.query).join(' UNION ALL '), args: queries.flatMap((q) => q.args) };
}
function taskRow(r: RecordRow): MemberActivityRecord {
  let status = '待交作品',
    tone: MemberActivityRecord['tone'] = 'warning';
  if (r.released_at) {
    status = '已释放';
    tone = 'neutral';
  } else if (r.stop_new_use_at || r.plan_status === 'ended') {
    status = '已停用';
    tone = 'neutral';
  } else if (r.sync_status === 'failed') {
    status = '关键词提交失败';
    tone = 'danger';
  } else if (r.verification_status === 'disputed') {
    status = '有争议';
    tone = 'danger';
  } else if (!r.executor_id) status = '待分配';
  else if (r.verification_status === 'passed') {
    status = '已核验';
    tone = 'success';
  } else if (r.verification_status === 'rejected') {
    status = '核验未通过';
    tone = 'danger';
  } else if (r.activated_on) status = '待核验';
  return {
    id: 'task:' + r.id,
    projectId: str(r.project_id),
    accountId: str(r.account_id),
    taskRef: str(r.plan_id),
    title: str(r.keyword),
    keyword: str(r.keyword),
    at: str(r.at),
    status,
    tone,
    fields: [
      { label: '小说原名', value: str(r.novel_title) || '未填写' },
      { label: '原文链接', value: str(r.novel_url), url: safeUrl(r.novel_url) },
      { label: '推广活动', value: str(r.activity) },
      { label: '渠道', value: str(r.channel_name) },
      { label: '领取／分配时间', value: str(r.at) },
      { label: '开始使用日期', value: str(r.activated_on) },
      { label: '记录中的团长', value: str(r.leader_name) || '无团长' },
      { label: '释放时间', value: str(r.released_time) },
      { label: '释放原因', value: str(r.release_reason) },
      { label: '提交问题', value: r.sync_status === 'failed' ? submissionFailure(r.sync_error, 'keyword') : '' },
    ].filter((f) => f.value),
  };
}
function workRow(r: RecordRow): MemberActivityRecord {
  const remote = (
    typeof r.zhihu_status_json === 'string' ? JSON.parse(r.zhihu_status_json) : r.zhihu_status_json
  ) as Record<string, unknown> | null;
  const review = str(remote?.auditStatus ?? remote?.audit_status ?? remote?.status);
  const reviews: Record<string, string> = {
    approved: '已通过',
    passed: '已通过',
    pending: '待审核',
    reviewing: '审核中',
    rejected: '已退回',
    failed: '未通过',
  };
  const verified: Record<string, string> = {
    passed: '已核验',
    pending: '待核验',
    disputed: '有争议',
    rejected: '未通过',
  };
  const status =
    r.submission_result === 'failed' ? '提交失败' : r.submission_result === 'pending' ? '待提交' : '已提交';
  const reason =
    r.plan_sync_status === 'failed'
      ? submissionFailure(r.plan_sync_error, 'keyword')
      : r.sync_status === 'failed'
        ? submissionFailure(r.sync_error, 'composition')
        : str(r.reason || remote?.rejectReason || remote?.reject_reason);
  return {
    id: 'work:' + r.id,
    projectId: str(r.project_id),
    accountId: str(r.account_id),
    taskRef: str(r.plan_id),
    title: str(r.work_title || r.description || r.keyword),
    keyword: str(r.keyword),
    at: str(r.at),
    status,
    tone: status === '提交失败' ? 'danger' : status === '已提交' ? 'success' : 'warning',
    url: safeUrl(r.work_url),
    fields: [
      { label: '作品链接', value: str(r.work_url), url: safeUrl(r.work_url) },
      { label: '作品说明', value: str(r.description) },
      { label: '提交结果', value: status },
      { label: '知乎审核', value: reviews[review] || '等待审核结果' },
      { label: '平台核验', value: verified[str(r.verification_status)] || verified[str(r.status)] || '尚未核验' },
      { label: '失败／退回原因', value: reason },
      { label: '首次登记时间', value: str(r.at) },
      { label: '发布时间', value: str(r.published_at) },
      { label: '发布平台', value: str(r.media_type) },
      { label: '发布账号', value: str(r.media_account) },
      { label: '推广活动', value: str(r.task_name) },
      { label: '小说原名', value: str(r.novel_title) },
      { label: '原文链接', value: str(r.novel_url), url: safeUrl(r.novel_url) },
    ].filter((f) => f.value),
  };
}
export const memberActivity: MemberActivityProvider = {
  async summary(scopes, user, memberIds) {
    await access(scopes, user);
    return withTransaction(async (c) => {
      const result = Object.fromEntries(memberIds.map((id) => [id, zero()]));
      const t = tasks(scopes, memberIds),
        w = works(scopes, user, memberIds);
      for (const r of await select(
        c,
        `SELECT member_id,COUNT(*) tasks,SUM(released_at IS NULL) current_tasks,SUM(verification_status='passed') verified_tasks FROM (${t.query}) records GROUP BY member_id`,
        t.args,
      ))
        Object.assign(result[str(r.member_id)], {
          tasks: Number(r.tasks),
          currentTasks: Number(r.current_tasks),
          verifiedTasks: Number(r.verified_tasks),
        });
      for (const r of await select(
        c,
        `SELECT executor_id,COUNT(*) works FROM (${w.query}) records GROUP BY executor_id`,
        w.args,
      ))
        result[str(r.executor_id)].works = Number(r.works);
      return result;
    });
  },
  async records(scopes, user, memberId, filter) {
    await access(scopes, user);
    return withTransaction(async (c) => {
      const q = filter.kind === 'tasks' ? tasks(scopes, [memberId], filter) : works(scopes, user, [memberId], filter);
      const [count] = await select(c, `SELECT COUNT(*) total FROM (${q.query}) records`, q.args);
      const projection =
        filter.kind === 'tasks'
          ? `SELECT * FROM (${q.query}) records`
          : `SELECT records.*,
        DATE_FORMAT(records.created_at,'%Y-%m-%d %H:%i:%s') at,DATE_FORMAT(records.release_time,'%Y-%m-%d %H:%i:%s') published_at,
        p.novel_title,COALESCE(NULLIF(p.novel_url,''),p.landing_url) novel_url FROM (${q.query}) records JOIN plans p ON p.id=records.plan_id`;
      const list = await select(
        c,
        `SELECT * FROM (${projection}) page_records ORDER BY at DESC,project_id,account_id,id DESC LIMIT ? OFFSET ?`,
        [...q.args, filter.pageSize, (filter.page - 1) * filter.pageSize],
      );
      return { total: Number(count.total), list: list.map(filter.kind === 'tasks' ? taskRow : workRow) };
    });
  },
};
