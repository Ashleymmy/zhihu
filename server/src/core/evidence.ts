import { z } from 'zod';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db';
import type { AuthUser } from '../types';
import { effectiveDuty, normalizeRole } from '../auth/roles';
import { AppError } from '../middleware/errors';
import { dutyAllows } from './duties';
import type { DataScope, EvidenceFilter, EvidenceResult } from './contracts';
import type { ModuleRuntime } from './module-runtime';

const id = z.string().regex(/^[1-9]\d*$/);
export const evidenceQuerySchema = z.object({
  moduleId: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  projectId: id, accountId: id, from: z.string().date(), to: z.string().date(),
  channelRef: id.optional(), taskRef: id.optional(), keywordRef: id.optional(),
  metricType: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().superRefine((q, ctx) => {
  const days = (Date.parse(q.to) - Date.parse(q.from)) / 86400000 + 1;
  if (days < 1 || days > 31) ctx.addIssue({ code: 'custom', message: '请选择不超过 31 天的有效日期范围' });
  if (q.taskRef && q.keywordRef && q.taskRef !== q.keywordRef)
    ctx.addIssue({ code: 'custom', message: '请选择同一个任务记录' });
});
export type EvidenceQuery = z.infer<typeof evidenceQuerySchema>;

/** Project providers may reuse this guard in their read transaction. No module tables are accessed here. */
export async function assertEvidenceAccess(c: PoolConnection, user: AuthUser, scope: DataScope, moduleId: string): Promise<AuthUser> {
  const [[actor]] = await c.query<RowDataPacket[]>('SELECT role,admin_duty,is_active,closed_at FROM users WHERE id=? FOR SHARE', [user.sub]);
  const role = normalizeRole(actor?.role);
  if (!actor?.is_active || actor.closed_at || !role) throw new AppError(403, 40301, '账号权限已变化，请刷新后重试');
  const current: AuthUser = { ...user, role, adminDuty: effectiveDuty({ role, adminDuty: actor.admin_duty }) as AuthUser['adminDuty'] };
  if (!dutyAllows(current, 'operations') && !dutyAllows(current, 'finance'))
    throw new AppError(403, 40301, '资料核验需要运营或财务权限');
  const [[account]] = await c.query<RowDataPacket[]>(
    `SELECT a.id FROM integration_accounts a JOIN project_integrations pi ON pi.account_id=a.id
     JOIN projects p ON p.id=pi.project_id JOIN module_installations mi ON mi.module_id=a.module_id
     WHERE a.id=? AND pi.project_id=? AND a.module_id=? AND a.status='active' AND p.is_enabled=1 FOR SHARE`,
    [scope.accountId, scope.projectId, moduleId],
  );
  if (!account) throw new AppError(403, 40304, '项目或资料来源不在当前可用范围，请重新选择');
  return current;
}

const sourceRef = z.object({ kind: z.string(), id: z.string(), batchId: z.string().optional(), line: z.number().int().optional(),
  status: z.enum(['adopted','available','pending','superseded','withdrawn']).optional() });
const action = z.object({
  key: z.string(), label: z.string(), method: z.enum(['GET', 'POST']),
  path: z.string().regex(/^\/api\/v1\//), requiredDuty: z.enum(['operations', 'finance']),
  parameters: z.record(z.string()), expectedHistoryVersion: z.number().int().nonnegative().optional(),
  historyContext: z.object({ moduleId: z.string(), accountId: id, sourceKind: z.string(), sourceId: id,
    sourceVersion: z.string(), operation: z.enum(['register_historical_keyword', 'assign_retro', 'adopt_legacy_record', 'refresh_unconfirmed']),
    selection: z.record(z.string()).optional() }).optional(),
});
const check = z.object({ status: z.enum(['ready', 'missing', 'conflict', 'blocked', 'unknown', 'not_applicable']),
  reason: z.string(), sourceRefs: z.array(sourceRef), version: z.string().optional(), nextAction: action.optional() });
const row = z.object({
  key: z.object({ projectId: id, accountId: id, channelRef: id, taskRef: id, businessDate: z.string().date(), metricType: z.string() }),
  title: z.string(),
  official: z.object({ status: z.enum(['ready', 'valid_zero', 'not_arrived', 'record_missing', 'conflict', 'withdrawn', 'processing', 'unknown']),
    quantity: z.string().regex(/^\d+$/).nullable(), quantityUnit: z.string(), coverageBasis: z.enum(['observed_rows', 'none']),
    coverageIsExhaustive: z.boolean(), sourceRefs: z.array(sourceRef), withdrawnSourceRefs: z.array(sourceRef).optional(), currentRevision: z.string().nullable(),
    pendingConflict: z.array(z.object({ revisionId: z.string(), sourceRefs: z.array(sourceRef) })) }),
  checks: z.object({ work: check, historicalOwnership: check, projectParticipation: check, pricing: check, existingCalculation: check }),
  result: z.object({ status: z.enum(['ready', 'needs_input', 'processing', 'unknown']), reason: z.string(),
    responsibleRole: z.enum(['operations', 'finance']).nullable(), nextAction: action.nullable(),
    evidenceVersion: z.string().min(1), lastChangedAt: z.string().nullable() }),
  finance: z.object({ amount: z.string().regex(/^-?\d+(?:\.\d+)?$/).nullable(), currency: z.literal('CNY'), sourceRefs: z.array(sourceRef) }).optional(),
});
const resultSchema = z.object({
  moduleId: z.string(), projectId: id, accountId: id, from: z.string().date(), to: z.string().date(),
  status: z.enum(['ready', 'empty']), list: z.array(row).max(100), total: z.number().int().nonnegative(),
  page: z.number().int().positive(), pageSize: z.number().int().min(1).max(100),
  limits: z.object({ maxDays: z.literal(31), maxPageSize: z.literal(100) }),
});

export async function queryEvidence(runtime: ModuleRuntime, user: AuthUser, input: EvidenceQuery): Promise<EvidenceResult> {
  const q = evidenceQuerySchema.parse(input);
  const filter: EvidenceFilter = { channelRef: q.channelRef, taskRef: q.taskRef ?? q.keywordRef, metricType: q.metricType, page: q.page, pageSize: q.pageSize };
  const scope = { projectId: q.projectId, accountId: q.accountId, from: q.from, to: q.to };
  const actor = await withTransaction(c => assertEvidenceAccess(c, user, scope, q.moduleId));
  const module = runtime.get(q.moduleId);
  if (!module || !module.manifest.roles.includes(actor.role)) throw new AppError(503, 50300, '该项目暂不可用，请稍后重试');
  if (!module.dataProvider?.evidence) throw new AppError(503, 50300, '该项目暂未接通资料核验，请稍后重试');
  let result: EvidenceResult;
  try {
    result = resultSchema.parse(await module.dataProvider.evidence(scope, actor, filter));
    if (result.moduleId !== q.moduleId || result.projectId !== q.projectId || result.accountId !== q.accountId || result.from !== q.from || result.to !== q.to ||
      result.page !== q.page || result.pageSize !== q.pageSize || result.list.length > q.pageSize ||
      result.list.some(r => r.key.projectId !== q.projectId || r.key.accountId !== q.accountId || r.key.businessDate < q.from || r.key.businessDate > q.to ||
        filter.channelRef && r.key.channelRef !== filter.channelRef || filter.taskRef && r.key.taskRef !== filter.taskRef || filter.metricType && r.key.metricType !== filter.metricType))
      throw new Error('Evidence response scope mismatch');
    if (result.list.length !== Math.max(0, Math.min(q.pageSize, result.total - (q.page - 1) * q.pageSize)) ||
      result.status !== (result.total ? 'ready' : 'empty') ||
      new Set(result.list.map(r => JSON.stringify(r.key))).size !== result.list.length)
      throw new Error('Evidence response page mismatch');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 50002, '暂时无法读取资料核验结果，请重新查询');
  }
  if (!dutyAllows(actor, 'finance')) for (const item of result.list) delete item.finance;
  return result;
}
