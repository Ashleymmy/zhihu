import type { AuthUser } from '../../../types';
import { isStaffRole } from '../../../auth/roles';
import { withTransaction } from '../../../db';
import { scopeFilter } from '../../../utils/scopeFilter';
import { planAccountSql } from '../services/plan-account';
import type { Scope } from './domain';
import { compositionLinkProblem, submissionFailure } from '../services/submission-feedback';
import { dutyAllows } from '../../../core/duties';
import { AppError } from '../../../middleware/errors';
import { authorize, select } from './store';

export interface WorkFilters {
  from?: string;
  to?: string;
  view?: 'self' | 'team' | 'all';
  ownerId?: string;
  registeredOnly?: boolean;
  result?: 'submitted' | 'failed' | 'pending';
  id?: string;
}
// All three views use this same set: one row per composition, plus evidence-only records.
function workQuery(user: AuthUser, scope: Scope) {
  const visibility = scopeFilter(user, 'c.owner_id');
  const query = `
      SELECT CAST(e.id AS CHAR) id,'evidence' source,CAST(e.binding_id AS CHAR) binding_id,
        CAST(p.id AS CHAR) plan_id,p.keyword,e.work_url,e.description,e.status,e.reason,
        b.verification_status,CAST(b.executor_id AS CHAR) executor_id,u.display_name executor_name,
        CAST(c.id AS CHAR) composition_id,c.sync_status,c.sync_error,p.sync_status plan_sync_status,p.sync_error plan_sync_error,c.zhihu_status_json,c.media_type,c.media_account,c.composition_type,c.composition_sub_type,c.release_time,COALESCE(c.created_at,e.created_at) created_at,c.status composition_status,
        (SELECT MAX(t.name) FROM tasks t WHERE t.project_id=p.project_id AND t.zhihu_task_id=p.zhihu_task_id) task_name
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
        CAST(p.id AS CHAR) plan_id,p.keyword,c.promo_url work_url,c.title description,
        c.status,c.reject_reason reason,NULL verification_status,
        CAST(c.owner_id AS CHAR) executor_id,u.display_name executor_name,
        CAST(c.id AS CHAR) composition_id,c.sync_status,c.sync_error,p.sync_status plan_sync_status,p.sync_error plan_sync_error,c.zhihu_status_json,c.media_type,c.media_account,c.composition_type,c.composition_sub_type,c.release_time,c.created_at,c.status composition_status,
        (SELECT MAX(t.name) FROM tasks t WHERE t.project_id=p.project_id AND t.zhihu_task_id=p.zhihu_task_id) task_name
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
function filteredQuery(user: AuthUser, scope: Scope, filters: WorkFilters = {}) {
  const base = workQuery(user, scope),
    where = ['1=1'],
    args: unknown[] = [...base.args];
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
  if (filters.registeredOnly) where.push('composition_id IS NOT NULL');
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
      summary: counts(summary),
      list: list.map((row) => ({ id: String(row.id), name: String(row.name), role: String(row.role), ...counts(row) })),
      total: Number(total.total),
      page,
      pageSize,
    };
  });
}
