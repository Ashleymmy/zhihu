import { z } from 'zod';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { AuthUser } from '../types';
import { AppError } from '../middleware/errors';
import { isStaffRole } from '../auth/roles';
import type { ModuleRuntime } from './module-runtime';
import { serviceProjects } from './project-scopes';

const id = z.string().regex(/^[1-9]\d*$/);
const input = z.object({
  projectId: id.optional(), accountId: id.optional(),
  moduleId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(),
  from: z.string().date().optional(), to: z.string().date().optional(),
  days: z.coerce.number().int().min(1).max(366).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type InsightFilter = ReturnType<typeof insightFilter>;
export interface InsightScope { moduleId: string; projectId: string; accountId: string; projectName: string }
export const todayInShanghai = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
export function insightFilter(query: unknown) {
  const value = input.parse(query), today = todayInShanghai();
  const to = value.to ?? today;
  const from = value.from ?? (value.days ? new Date(Date.parse(to) - (value.days - 1) * 86400000).toISOString().slice(0, 10) : to.slice(0, 8) + '01');
  if (from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000)
    throw new AppError(422, 42200, '请选择一年以内的有效日期范围');
  if (value.accountId && !value.projectId) throw new AppError(422, 42200, '请先选择项目');
  return { ...value, from, to };
}
export function assertInsightStaff(user: AuthUser) {
  if (!isStaffRole(user.role)) throw new AppError(403, 40301, '此页面仅供获准管理人员查看');
}
export async function insightScopes(runtime: ModuleRuntime, user: AuthUser, filter: InsightFilter): Promise<InsightScope[]> {
  const projects = await serviceProjects(runtime, user);
  const list = projects.flatMap(p => p.accounts.map(a => ({ moduleId: a.moduleId, projectId: p.id, accountId: a.id, projectName: p.name })))
    .filter(s => (!filter.projectId || s.projectId === filter.projectId) && (!filter.accountId || s.accountId === filter.accountId) && (!filter.moduleId || s.moduleId === filter.moduleId));
  if ((filter.projectId || filter.accountId || filter.moduleId) && !list.length)
    throw new AppError(403, 40304, '此项目或资料来源暂不可查看');
  return list;
}
export function scopedSql(alias: string, scopes: InsightScope[]) {
  // Every aggregate applies the authorized project/account/module tuples in SQL.
  return scopes.length ? {
    sql: '(' + scopes.map(() => `(${alias}.module_id=? AND ${alias}.project_id=? AND ${alias}.account_id=?)`).join(' OR ') + ')',
    args: scopes.flatMap(s => [s.moduleId, s.projectId, s.accountId]),
  } : { sql: '0=1', args: [] };
}
export const queryRows = async (c: PoolConnection, sql: string, args: unknown[] = []) => (await c.query<RowDataPacket[]>(sql, args))[0];
export function insightContext(filter: InsightFilter, scopes: InsightScope[], basis = 'business_date') {
  return { scope: { projectId: filter.projectId ?? null, accountId: filter.accountId ?? null, moduleId: filter.moduleId ?? null, from: filter.from, to: filter.to, scopes }, timeBasis: basis, observedAt: new Date().toISOString() };
}
export const sourceDetail = (row: RowDataPacket) => ({
  endpoint: '/api/v1/core/activity',
  query: { moduleId: String(row.module_id), projectId: String(row.project_id), accountId: String(row.account_id), from: String(row.business_date), to: String(row.business_date), view: 'all', metricType: String(row.metric_type) },
  sourceId: String(row.id), taskId: String(row.task_id), sourceKey: String(row.source_key),
});
export const eachDay = (from: string, to: string) => Array.from({ length: Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 }, (_, i) => new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10));
