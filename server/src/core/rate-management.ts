import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import type { AuthUser } from '../types';
import { withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { writeAudit } from '../services/audit.service';
import { assertDuty } from './duties';
import { cash, cashText, checksum } from './money';
import type { ModuleRuntime } from './module-runtime';

function fail(message: string, status = 422): never {
  throw new AppError(status, status * 100, message);
}
const id = z.string().regex(/^[1-9][0-9]*$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
export const rateScopeSchema = z.object({ projectId: id, moduleId: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/) });
export const ratePublishSchema = rateScopeSchema
  .extend({
    metricType: z.string().min(1).max(16),
    effectiveFrom: date,
    prices: z.record(z.string().regex(/^\d{1,14}(\.\d{1,4})?$/)),
    baseVersion: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type RateScope = z.infer<typeof rateScopeSchema>;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const nextDay = (s: string) => new Date(Date.parse(s) + 86400000).toISOString().slice(0, 10);
async function rows(c: PoolConnection, scope: RateScope, lock = false) {
  const [result] = await c.query<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) id,metric_type metricType,rule_code ruleCode,CAST(unit_price AS CHAR) unitPrice,
      DATE_FORMAT(effective_from,'%Y-%m-%d') effectiveFrom,DATE_FORMAT(effective_to,'%Y-%m-%d') effectiveTo
     FROM opc_rate_rules WHERE project_id=? AND module_id=? AND status='published'
     ORDER BY metric_type,rule_code,effective_from,id${lock ? ' FOR UPDATE' : ''}`,
    [scope.projectId, scope.moduleId],
  );
  return result;
}
async function authorize(c: PoolConnection, user: AuthUser, scope: RateScope) {
  assertDuty(user, 'finance');
  const [actors] = await c.query<RowDataPacket[]>('SELECT role,admin_duty,is_active FROM users WHERE id=? FOR SHARE', [
    user.sub,
  ]);
  if (!actors[0]?.is_active || actors[0].role !== user.role) fail('账号状态已变化，请重新登录', 403);
  assertDuty({ ...user, adminDuty: actors[0].admin_duty }, 'finance');
  const [projects] = await c.query<RowDataPacket[]>(
    `SELECT p.id FROM projects p WHERE p.id=? AND p.is_enabled=1 AND EXISTS (
      SELECT 1 FROM project_integrations pi JOIN integration_accounts a ON a.id=pi.account_id
      WHERE pi.project_id=p.id AND a.module_id=? AND a.status='active')`,
    [scope.projectId, scope.moduleId],
  );
  if (!projects.length) fail('项目不可用，请刷新后重新选择项目', 403);
}
function providerFor(runtime: ModuleRuntime, scope: RateScope) {
  const provider = runtime.get(scope.moduleId)?.rateProvider;
  if (!provider) fail('这个项目的单价设置暂时不可用，请稍后重试', 503);
  return provider;
}
export async function listRateVersions(runtime: ModuleRuntime, user: AuthUser, raw: unknown) {
  assertDuty(user, 'finance');
  const scope = rateScopeSchema.parse(raw),
    provider = providerFor(runtime, scope);
  return withTransaction(async (c) => {
    await authorize(c, user, scope);
    const versions = await rows(c, scope),
      businessDate = today();
    const earliestFrom = Object.fromEntries(
        provider.metrics.map((metric) => [
          metric.code,
          nextDay(
            versions
              .filter(
                (r) =>
                  r.metricType === metric.code &&
                  metric.rules.some((rule) => rule.code === r.ruleCode && rule.editable),
              )
              .reduce((d, r) => (r.effectiveFrom > d ? String(r.effectiveFrom) : d), businessDate),
          ),
        ]),
      );
    return {
      ...scope,
      // Keep the date next to its opaque type code; response key conversion must
      // not change how clients look up types such as new_user.
      metrics: provider.metrics.map(metric => ({...metric, earliestFrom: earliestFrom[metric.code]})),
      versions,
      baseVersion: checksum(versions),
      businessDate,
      earliestFrom,
    };
  });
}
export async function publishRateVersions(runtime: ModuleRuntime, user: AuthUser, raw: unknown) {
  assertDuty(user, 'finance');
  const input = ratePublishSchema.parse(raw),
    provider = providerFor(runtime, input);
  const metric = provider.metrics.find((m) => m.code === input.metricType);
  if (!metric) fail('请选择有效的业绩类型');
  const editable = metric.rules
    .filter((r) => r.editable)
    .map((r) => r.code)
    .sort();
  if (JSON.stringify(Object.keys(input.prices).sort()) !== JSON.stringify(editable)) fail('请填写完整的单价设置');
  if (input.effectiveFrom <= today()) fail('新单价请从明天或之后开始，已经生效的单价不能覆盖');
  return withTransaction(async (c) => {
    await authorize(c, user, input);
    await provider.lock(c, user, input.projectId);
    const previous = await rows(c, input, true);
    if (checksum(previous) !== input.baseVersion) fail('单价已更新，请刷新查看最新单价后再发布', 409);
    const prices = await provider.prepare(c, input);
    if (!Object.keys(prices).length || Object.keys(prices).some((code) => !metric.rules.some((r) => r.code === code)))
      fail('项目单价信息不完整，请刷新后重试', 503);
    for (const [code, value] of Object.entries(prices)) {
      if (!/^\d{1,14}(\.\d{1,4})?$/.test(value)) fail('单价金额无效，最多保留四位小数');
      const existing = previous.filter((r) => r.metricType === input.metricType && r.ruleCode === code);
      if (existing.some((r) => r.effectiveFrom >= input.effectiveFrom))
        fail('该日期之后已有新单价，请选择更晚的生效日期', 409);
      const overlaps = existing.filter((r) => r.effectiveTo === null || r.effectiveTo > input.effectiveFrom);
      if (overlaps.length > 1) fail('现有单价的生效时间有冲突，暂时不能发布新单价', 409);
      if (overlaps[0])
        await c.query('UPDATE opc_rate_rules SET effective_to=? WHERE id=?', [input.effectiveFrom, overlaps[0].id]);
      await c.query(
        `INSERT INTO opc_rate_rules(project_id,module_id,metric_type,rule_code,unit_price,effective_from,
        created_by,published_by,published_at,reason) VALUES(?,?,?,?,?,?,?,?,NOW(3),'发布未来单价')`,
        [
          input.projectId,
          input.moduleId,
          input.metricType,
          code,
          cashText(cash(value)),
          input.effectiveFrom,
          user.sub,
          user.sub,
        ],
      );
    }
    const result = await provider.published(c, user, { ...input, prices });
    await writeAudit(
      {
        userId: user.sub,
        action: 'rates.publish',
        resourceType: 'project',
        resourceId: input.projectId,
        detail: {
          moduleId: input.moduleId,
          metricType: input.metricType,
          effectiveFrom: input.effectiveFrom,
          prices,
          ...result,
        },
      },
      c,
    );
    return { effectiveFrom: input.effectiveFrom, ...result };
  });
}
