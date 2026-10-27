import type { AuthUser } from '../../../types';
import { canViewWorkStatistics, isStaffRole } from '../../../auth/roles';
import { withTransaction } from '../../../db';
import { scopeFilter } from '../../../utils/scopeFilter';
import { compositionVisibility } from '../services/composition-visibility';
import { planAccountSql } from '../services/plan-account';
import type { Scope } from './domain';
import { compositionLinkProblem, submissionFailure } from '../services/submission-feedback';
import { dutyAllows } from '../../../core/duties';
import { AppError } from '../../../middleware/errors';
import { authorize, select } from './store';
import { submittedWorkSql } from './work-receipts';
import type { WorkRegistrationFilter, WorkRegistrationReport } from '../../../core/contracts';
import { userIdMap } from '../../../auth/user-id';
import { COMPOSITION_TYPES, COMPOSITION_SUB_TYPES } from '../zhihu/composition';

export interface WorkFilters {
  from?: string;
  to?: string;
  view?: 'self' | 'team' | 'all';
  ownerId?: string;
  planId?: string;
  registeredOnly?: boolean;
  result?: 'submitted' | 'failed' | 'pending';
  id?: string;
  search?: string;
  successfulOnly?: boolean;
}
const successfulComposition = submittedWorkSql.replace(/\bco\./g, 'c.');
// All three views use this same set: one row per composition, plus evidence-only records.
function workQuery(user: AuthUser, scope: Scope) {
  const visibility = compositionVisibility(user);
  const query = `
      SELECT CAST(e.id AS CHAR) id,'evidence' source,CAST(e.binding_id AS CHAR) binding_id,
        CAST(p.id AS CHAR) plan_id,p.keyword,e.work_url,e.description,c.title work_title,e.status,e.reason,
        b.verification_status,CAST(b.executor_id AS CHAR) executor_id,u.display_name executor_name,
        CAST(c.id AS CHAR) composition_id,c.sync_status,c.sync_error,p.sync_status plan_sync_status,p.sync_error plan_sync_error,c.zhihu_status_json,c.media_type,c.media_account,c.composition_type,c.composition_sub_type,c.release_time,COALESCE(c.created_at,e.created_at) created_at,c.status composition_status,
        (SELECT MAX(t.name) FROM tasks t WHERE t.project_id=p.project_id AND t.zhihu_task_id=p.zhihu_task_id) task_name,
        (${successfulComposition} AND p.sync_status='synced' AND e.status<>'rejected'
          AND COALESCE(b.verification_status,'')<>'disputed') registration_success
      FROM zh_evidence e JOIN zh_keyword_bindings b ON b.id=e.binding_id
      JOIN zh_keywords k ON k.id=b.keyword_id JOIN plans p ON p.id=k.plan_id
      LEFT JOIN users u ON u.id=b.executor_id
      LEFT JOIN compositions c ON c.id=(SELECT MAX(linked.id) FROM compositions linked
        WHERE linked.plan_id=p.id AND linked.owner_id=b.executor_id AND BINARY linked.promo_url=BINARY e.work_url)
      WHERE k.account_id=? AND k.project_id=? AND p.project_id=k.project_id
        AND (?=1 OR b.leader_id=? OR b.executor_id=?)
        AND (c.id IS NULL OR e.id=(SELECT MAX(ee.id) FROM zh_evidence ee
          JOIN zh_keyword_bindings bb ON bb.id=ee.binding_id JOIN zh_keywords kk ON kk.id=bb.keyword_id
          WHERE kk.plan_id=p.id AND kk.account_id=k.account_id AND kk.project_id=k.project_id
            AND bb.executor_id=c.owner_id AND BINARY ee.work_url=BINARY c.promo_url))
      UNION ALL
      SELECT CONCAT('composition:',c.id) id,'composition' source,NULL binding_id,
        CAST(p.id AS CHAR) plan_id,p.keyword,c.promo_url work_url,c.title description,c.title work_title,
        c.status,c.reject_reason reason,NULL verification_status,
        CAST(c.owner_id AS CHAR) executor_id,u.display_name executor_name,
        CAST(c.id AS CHAR) composition_id,c.sync_status,c.sync_error,p.sync_status plan_sync_status,p.sync_error plan_sync_error,c.zhihu_status_json,c.media_type,c.media_account,c.composition_type,c.composition_sub_type,c.release_time,c.created_at,c.status composition_status,
        (SELECT MAX(t.name) FROM tasks t WHERE t.project_id=p.project_id AND t.zhihu_task_id=p.zhihu_task_id) task_name,
        (${successfulComposition} AND p.sync_status='synced') registration_success
      FROM compositions c JOIN plans p ON p.id=c.plan_id LEFT JOIN users u ON u.id=c.owner_id
      WHERE p.project_id=? AND ${planAccountSql()}=? AND ${visibility.clause}
        AND NOT EXISTS(SELECT 1 FROM zh_evidence e JOIN zh_keyword_bindings b ON b.id=e.binding_id
          JOIN zh_keywords k ON k.id=b.keyword_id
          WHERE k.plan_id=p.id AND k.account_id=? AND k.project_id=?
            AND b.executor_id=c.owner_id AND BINARY e.work_url=BINARY c.promo_url
            AND (?=1 OR b.leader_id=? OR b.executor_id=?))`;
  const args = [
    scope.accountId,
    scope.projectId,
    Number(isStaffRole(user.role)),
    user.sub,
    user.sub,
    scope.projectId,
    scope.accountId,
    ...visibility.bindings,
    scope.accountId,
    scope.projectId,
    Number(isStaffRole(user.role)),
    user.sub,
    user.sub,
  ];
  return { query, args };
}
const resultSql =
  "CASE WHEN plan_sync_status='failed' OR sync_status='failed' THEN 'failed' WHEN sync_status='synced' THEN 'submitted' ELSE 'pending' END";
export function filteredQuery(user: AuthUser, scope: Scope, filters: WorkFilters = {}) {
  const base = workQuery(user, scope),
    where = ['1=1'],
    args: unknown[] = [...base.args];
  const search = filters.search?.trim();
  if (search) {
    const columns = ['keyword', 'description', 'work_title', 'executor_name', 'work_url'];
    where.push('(' + columns.map(column => `LOCATE(?,COALESCE(${column},''))>0`).join(' OR ') + ')');
    args.push(...columns.map(() => search));
  }
  if (filters.from) {
    where.push('created_at>=?');
    args.push(filters.from);
  }
  if (filters.to) {
    where.push('created_at<DATE_ADD(?,INTERVAL 1 DAY)');
    args.push(filters.to);
  }
  if (filters.view === 'self' || user.role === 'creator') {
    where.push('executor_id=?');
    args.push(user.sub);
  }
  if (filters.view === 'team') {
    where.push('executor_id<>?');
    args.push(user.sub);
  }
  if (filters.ownerId) {
    where.push('executor_id=?');
    args.push(filters.ownerId);
  }
  if (filters.planId) { where.push('plan_id=?'); args.push(filters.planId); }
  if (filters.registeredOnly) where.push('composition_id IS NOT NULL');
  if (filters.successfulOnly) where.push('registration_success=1');
  if (filters.result) {
    where.push(`${resultSql}=?`);
    args.push(filters.result);
  }
  if (filters.id) {
    if (filters.id.startsWith('composition:')) {
      where.push('composition_id=?');
      args.push(filters.id.slice(12));
    } else {
      where.push('id=?');
      args.push(filters.id);
    }
  }
  return {
    query: `SELECT *,${resultSql} submission_result FROM (${base.query}) works WHERE ${where.join(' AND ')}`,
    args,
  };
}
function decorate(user: AuthUser, item: Record<string, unknown>) {
  item.failure_reason =
    item.sync_status === 'failed' || item.plan_sync_status === 'failed'
      ? compositionLinkProblem(String(item.media_type), String(item.work_url)) ||
        submissionFailure(
          item.plan_sync_status === 'failed' ? item.plan_sync_error : item.sync_error,
          item.plan_sync_status === 'failed' ? 'keyword' : 'composition',
        )
      : null;
  item.can_edit =
    !!item.composition_id &&
    item.composition_status !== 'ended' &&
    item.sync_status !== 'syncing' &&
    item.plan_sync_status === 'synced' &&
    (!isStaffRole(user.role) || dutyAllows(user, 'operations'));
  if (!isStaffRole(user.role)) {
    delete item.sync_error;
    delete item.plan_sync_error;
  }
  return item;
}
export async function listWorks(
  user: AuthUser,
  scope: Scope,
  page: number,
  pageSize: number,
  filters: WorkFilters = {},
) {
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const { query, args } = filteredQuery(user, scope, filters);
    const [count] = await select(c, `SELECT COUNT(*) total FROM (${query}) filtered`, args);
    const list = await select(
      c,
      `SELECT * FROM (${query}) filtered ORDER BY created_at DESC,source,id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    );
    return { list: list.map((item) => decorate(user, item)), total: Number(count.total), page, pageSize };
  });
}
export async function workDetail(user: AuthUser, scope: Scope, id: string) {
  const data = await listWorks(user, scope, 1, 1, { id });
  if (!data.list.length) throw new AppError(404, 40401, '作品不存在或不在当前可查看范围内');
  return data.list[0];
}
// The same authorized, de-duplicated query feeds the list, daily counts and full export.
export async function workRegistrations(scope: Scope, user: AuthUser, filters: WorkRegistrationFilter, includeRows: boolean): Promise<WorkRegistrationReport> {
  if (!canViewWorkStatistics(user.role)) throw new AppError(403, 40300, '仅管理员和开发者可查看作品统计及导出');
  await authorize(user, scope);
  return withTransaction(async c => {
    const { query, args } = filteredQuery(user, scope, filters);
    const daily = await select(c, `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') date,COUNT(*) count FROM (${query}) records GROUP BY DATE_FORMAT(created_at,'%Y-%m-%d') ORDER BY date DESC`, args);
    const total = daily.reduce((sum, row) => sum + Number(row.count), 0);
    if (includeRows && total > 30000) throw new AppError(422, 42200, '符合条件的作品超过 30000 条，请缩小登记日期范围后导出');
    const records = includeRows ? await select(c, `SELECT records.*,
      DATE_FORMAT(records.created_at,'%Y-%m-%d %H:%i:%s') registered_at,DATE_FORMAT(records.release_time,'%Y-%m-%d %H:%i:%s') published_at,
      p.name plan_name,p.novel_title,COALESCE(NULLIF(p.novel_url,''),p.landing_url) novel_url,
      u.username performer_account,CAST(u.id AS CHAR) performer_id,
      CAST(historical.id AS CHAR) historical_binding_id,CAST(historical.leader_id AS CHAR) leader_id,
      leader.display_name leader_name,leader.username leader_account
      FROM (${query}) records JOIN plans p ON p.id=records.plan_id
      LEFT JOIN users u ON u.id=records.executor_id
      LEFT JOIN zh_keyword_bindings historical ON historical.id=COALESCE(records.binding_id,
        (SELECT hb.id FROM zh_keyword_bindings hb JOIN zh_keywords hk ON hk.id=hb.keyword_id
         WHERE hk.plan_id=p.id AND hb.executor_id=records.executor_id
           AND COALESCE(hb.assigned_at,hb.claimed_at)<=records.created_at
           AND (hb.released_at IS NULL OR hb.released_at>=records.created_at)
         ORDER BY COALESCE(hb.assigned_at,hb.claimed_at) DESC,hb.id DESC LIMIT 1))
      LEFT JOIN users leader ON leader.id=historical.leader_id
      ORDER BY records.created_at DESC,records.source,records.id DESC`, args) : [];
    const publicIds = await userIdMap(c, records.flatMap(r => [r.performer_id,r.leader_id]));
    return { total, daily: daily.map(row => ({ date: String(row.date), count: Number(row.count) })), rows: records.map(row => {
      const raw = row.zhihu_status_json;
      const remote = (typeof raw === 'string' ? JSON.parse(raw) : raw) || {};
      const status = String(remote.auditStatus ?? remote.audit_status ?? remote.status ?? '');
      const reviewLabels: Record<string,string> = { pending:'待审核',reviewing:'审核中',approved:'已通过',passed:'已通过',rejected:'已退回',failed:'未通过' };
      return {
        id: String(row.composition_id ?? row.id), registeredAt: String(row.registered_at),
        title: String(row.work_title ?? row.description ?? ''), keyword: String(row.keyword ?? ''), taskName: String(row.task_name ?? ''),
        performerName: String(row.executor_name ?? ''), mediaType: String(row.media_type ?? ''), mediaAccount: String(row.media_account ?? ''),
        workUrl: String(row.work_url ?? ''), publishedAt: String(row.published_at ?? ''),
        registrationStatus: Number(row.registration_success) === 1 ? '成功登记' : row.submission_result === 'failed' ? '提交失败' : row.submission_result === 'pending' ? '待提交' : '无效或需核实',
        reviewStatus: reviewLabels[status] ?? (status || (row.composition_id ? '等待审核结果' : '平台核验记录')),
        planName: String(row.plan_name ?? ''),
        category: row.composition_type == null ? '' : COMPOSITION_TYPES.find(v => v.value === Number(row.composition_type))?.label ?? String(row.composition_type),
        subcategory: row.composition_sub_type == null ? '' : COMPOSITION_SUB_TYPES.find(v => v.value === Number(row.composition_sub_type))?.label ?? String(row.composition_sub_type),
        novelTitle: String(row.novel_title ?? ''), novelUrl: String(row.novel_url ?? ''),
        performerAccount: String(row.performer_account ?? ''), performerId: publicIds.get(String(row.performer_id)) ?? '',
        leaderName: String(row.leader_name ?? ''), leaderAccount: String(row.leader_account ?? ''), leaderId: publicIds.get(String(row.leader_id)) ?? '',
        relationNote: !row.historical_binding_id ? '未记录回传时的团队归属' : row.leader_id ? '取自回传对应的领取／分配记录' : '回传时独立使用，无团长',
        failureReason: row.plan_sync_status === 'failed' ? submissionFailure(row.plan_sync_error, 'keyword') : row.sync_status === 'failed' ? submissionFailure(row.sync_error, 'composition') : String(row.reason || remote.rejectReason || remote.reject_reason || ''),
      };
    }) };
  });
}
const totalsSql = `COUNT(*) registered,COALESCE(SUM(submission_result='submitted'),0) submitted,COALESCE(SUM(submission_result='failed'),0) failed,COALESCE(SUM(submission_result='pending'),0) pending`;
function counts(row: Record<string, unknown>) {
  return {
    registered: Number(row.registered || 0),
    submitted: Number(row.submitted || 0),
    failed: Number(row.failed || 0),
    pending: Number(row.pending || 0),
  };
}
export async function workActivity(user: AuthUser, scope: Scope, filters: WorkFilters, page: number, pageSize: number) {
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const { query, args } = filteredQuery(user, scope, { ...filters, registeredOnly: true });
    const [summary] = await select(c, `SELECT ${totalsSql} FROM (${query}) works`, args);
    const visible = scopeFilter(user, 'u.id');
    const memberWhere = [visible.clause],
      memberArgs: unknown[] = [...visible.bindings];
    if (filters.view === 'self' || user.role === 'creator') {
      memberWhere.push('u.id=?');
      memberArgs.push(user.sub);
    }
    if (filters.view === 'team') {
      memberWhere.push('u.id<>?');
      memberArgs.push(user.sub);
    }
    if (filters.ownerId) {
      memberWhere.push('u.id=?');
      memberArgs.push(filters.ownerId);
    }
    // Include current members who have not registered any work, and historical visible work owners.
    const memberQuery = `SELECT CAST(u.id AS CHAR) id,u.display_name name,u.role,
      COALESCE(w.registered,0) registered,COALESCE(w.submitted,0) submitted,COALESCE(w.failed,0) failed,COALESCE(w.pending,0) pending
      FROM users u LEFT JOIN (SELECT executor_id,${totalsSql} FROM (${query}) works GROUP BY executor_id) w ON w.executor_id=u.id
      WHERE (${memberWhere.join(' AND ')}) AND (w.executor_id IS NOT NULL OR (u.is_active=1 AND EXISTS(SELECT 1 FROM project_members pm WHERE pm.user_id=u.id AND pm.project_id=? AND pm.left_at IS NULL)))`;
    const values = [...args, ...memberArgs, scope.projectId];
    const [total] = await select(c, `SELECT COUNT(*) total FROM (${memberQuery}) members`, values);
    const list = await select(c, `${memberQuery} ORDER BY registered DESC,u.id LIMIT ? OFFSET ?`, [
      ...values,
      pageSize,
      (page - 1) * pageSize,
    ]);
    return {
      summary: canViewWorkStatistics(user.role) ? counts(summary) : null,
      list: list.map((row) => ({ id: String(row.id), name: String(row.name), role: String(row.role),
        ...(canViewWorkStatistics(user.role) ? counts(row) : {}),
      })),
      total: Number(total.total),
      page,
      pageSize,
    };
  });
}
