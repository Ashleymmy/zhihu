import { z } from 'zod';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db';
import type { AuthUser } from '../types';
import { effectiveDuty, normalizeRole } from '../auth/roles';
import { AppError } from '../middleware/errors';
import { writeAudit } from '../services/audit.service';
import { assertDuty } from './duties';
import { cash, cashText, checksum } from './money';
import type { ModuleRuntime } from './module-runtime';
import type {
  SettlementDocument,
  SettlementGroup,
  SettlementImpact,
  SettlementProvider,
  SettlementRecipient,
  SettlementRecord,
  SettlementScope,
  SettlementSourceCheck,
  SettlementSummary,
} from './settlement-contracts';

export const settlementId = z.string().regex(/^[1-9]\d*$/);
export const settlementKey = z.string().regex(/^[\w.-]{8,128}$/);
export const settlementBaseSchema = z.object({
  moduleId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  projectId: settlementId,
  accountId: settlementId,
});
export const settlementOwnerSchema = settlementBaseSchema.extend({ leaderId: settlementId });
export const settlementScopeSchema = settlementOwnerSchema.extend({
  from: z.string().date(),
  to: z.string().date(),
  metricType: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,31}$/)
    .optional(),
});
export const settlementPage = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
type Base = z.infer<typeof settlementBaseSchema>;
type Owner = z.infer<typeof settlementOwnerSchema>;
const rows = async (c: PoolConnection, sql: string, args: unknown[] = []) =>
  (await c.query<RowDataPacket[]>(sql, args))[0];
function fail(message: string, status = 409): never {
  throw new AppError(status, status * 100, message);
}
const json = <T>(value: unknown): T => (typeof value === 'string' ? (JSON.parse(value) as T) : (value as T));
const textAmount = (value: unknown) => cashText(cash(String(value ?? '0'), true));
const add = (a: string, b: string) => cashText(cash(a, true) + cash(b, true));
function normalizedScope(input: SettlementScope): SettlementScope {
  const scope = settlementScopeSchema.strict().parse(input);
  if (scope.from > scope.to) fail('开始日期不能晚于结束日期', 422);
  return scope;
}

export async function settlementAccess(
  c: PoolConnection,
  runtime: ModuleRuntime,
  user: AuthUser,
  scope: Base,
  writeScope?: SettlementScope,
): Promise<{ actor: AuthUser; provider: SettlementProvider }> {
  const [stored] = await rows(c, 'SELECT role,admin_duty,is_active,closed_at FROM users WHERE id=? FOR SHARE', [
    user.sub,
  ]);
  const role = normalizeRole(stored?.role);
  if (!stored?.is_active || stored.closed_at || !role) fail('账号权限已变化，请刷新后重试', 403);
  const actor: AuthUser = {
    ...user,
    role,
    adminDuty: effectiveDuty({ role, adminDuty: stored.admin_duty }) as AuthUser['adminDuty'],
  };
  assertDuty(actor, 'finance');
  const module = runtime.get(scope.moduleId);
  if (!module || !module.manifest.roles.includes(actor.role) || !module.settlementProvider)
    fail('该项目暂未接通结算，请重新选择项目', 503);
  // The provider takes its normal gate/account locks before any consistent read.
  if (writeScope) await module.settlementProvider.lock(c, actor, writeScope);
  const [account] = await rows(
    c,
    `SELECT a.id FROM integration_accounts a JOIN project_integrations pi ON pi.account_id=a.id
    JOIN projects p ON p.id=pi.project_id JOIN module_installations mi ON mi.module_id=a.module_id
    WHERE a.id=? AND pi.project_id=? AND a.module_id=? AND a.status='active' AND p.is_enabled=1 FOR SHARE`,
    [scope.accountId, scope.projectId, scope.moduleId],
  );
  if (!account) fail('项目或资料来源不可查看，请重新选择', 403);
  return { actor, provider: module.settlementProvider };
}
const recipientCondition = `(u.role='leader' AND EXISTS(SELECT 1 FROM project_members pm WHERE pm.user_id=u.id AND pm.project_id=? AND pm.left_at IS NULL)
  OR EXISTS(SELECT 1 FROM opc_earning_lines el JOIN opc_earning_sources es ON es.id=el.source_id
    WHERE el.payee_id=u.id AND es.module_id=? AND es.project_id=? AND es.account_id=? AND el.rule_code IN ('leader_self','leader_override')))`;
const recipientArgs = (s: Base) => [s.projectId, s.moduleId, s.projectId, s.accountId];
const person = (r: RowDataPacket): SettlementRecipient => ({
  id: String(r.id),
  name: String(r.display_name),
  role: String(r.role),
  active: Number(r.is_active) === 1,
});
async function recipient(c: PoolConnection, scope: Owner) {
  const [r] = await rows(
    c,
    `SELECT CAST(u.id AS CHAR) id,u.display_name,u.role,u.is_active FROM users u WHERE u.id=? AND ${recipientCondition}`,
    [scope.leaderId, ...recipientArgs(scope)],
  );
  if (!r) fail('这个收款人不在所选项目范围，请重新选择', 404);
  return person(r);
}
export async function settlementRecipients(
  runtime: ModuleRuntime,
  user: AuthUser,
  scope: Base,
  search: string,
  page: number,
  pageSize: number,
) {
  return withTransaction(async (c) => {
    await settlementAccess(c, runtime, user, scope);
    const where = `${recipientCondition} AND (u.display_name LIKE ? OR u.username LIKE ?)`,
      args = [...recipientArgs(scope), `%${search}%`, `%${search}%`];
    const [count] = await rows(c, `SELECT COUNT(*) total FROM users u WHERE ${where}`, args);
    const list = await rows(
      c,
      `SELECT CAST(u.id AS CHAR) id,u.display_name,u.role,u.is_active FROM users u WHERE ${where} ORDER BY u.display_name,u.id LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    );
    return { list: list.map(person), total: Number(count.total), page, pageSize };
  });
}
interface Loaded {
  record: SettlementRecord;
  impacts: SettlementImpact[];
  check: SettlementSourceCheck | null;
  fingerprint: string;
}
async function loadRecords(
  c: PoolConnection,
  actor: AuthUser,
  provider: SettlementProvider,
  scope: SettlementScope,
): Promise<Loaded[]> {
  const sources = await rows(
    c,
    `SELECT CAST(s.id AS CHAR) id,s.source_key,s.current_version,s.task_id,s.task_name,
    DATE_FORMAT(s.business_date,'%Y-%m-%d') business_date,s.metric_type,s.metric_label,s.quantity_unit,s.blocked_reason
    FROM opc_earning_sources s WHERE s.module_id=? AND s.project_id=? AND s.account_id=? AND s.business_date BETWEEN ? AND ?
    ${scope.metricType ? 'AND s.metric_type=?' : ''}
    AND (EXISTS(SELECT 1 FROM opc_earning_lines chosen WHERE chosen.source_id=s.id AND chosen.source_version=s.current_version AND chosen.payee_id=? AND chosen.is_internal=0)
      OR EXISTS(SELECT 1 FROM opc_income_sources prior JOIN opc_income_entries e ON e.source_id=prior.id
        WHERE prior.module_id=s.module_id AND prior.project_id=s.project_id AND prior.account_id=s.account_id AND prior.source_key=s.source_key AND e.user_id=?)) ORDER BY s.id`,
    [
      scope.moduleId,
      scope.projectId,
      scope.accountId,
      scope.from,
      scope.to,
      ...(scope.metricType ? [scope.metricType] : []),
      scope.leaderId,
      scope.leaderId,
    ],
  );
  if (!sources.length) return [];
  const ids = sources.map((s) => String(s.id));
  const lines = await rows(
    c,
    `SELECT CAST(l.source_id AS CHAR) source_id,CAST(l.payee_id AS CHAR) payee_id,
    CAST(l.performer_id AS CHAR) performer_id,l.performer_name,l.rule_code,CAST(l.quantity AS CHAR) quantity,CAST(l.amount AS CHAR) amount,
    l.is_ready,l.is_internal,l.blocked_reason,l.next_action,l.confirmed_at,u.display_name
    FROM opc_earning_lines l JOIN opc_earning_sources s ON s.id=l.source_id JOIN users u ON u.id=l.payee_id
    WHERE s.id IN (?) AND l.source_version=s.current_version ORDER BY l.source_id,l.payee_id`,
    [ids],
  );
  const prior = await rows(
    c,
    `SELECT CAST(es.id AS CHAR) source_id,CAST(e.user_id AS CHAR) payee_id,CAST(SUM(e.amount) AS CHAR) amount,u.display_name
    FROM opc_earning_sources es JOIN opc_income_sources inc ON inc.module_id=es.module_id AND inc.project_id=es.project_id AND inc.account_id=es.account_id AND inc.source_key=es.source_key
    JOIN opc_income_entries e ON e.source_id=inc.id JOIN users u ON u.id=e.user_id WHERE es.id IN (?) GROUP BY es.id,e.user_id,u.display_name`,
    [ids],
  );
  const old = await rows(
    c,
    `SELECT CAST(source_id AS CHAR) source_id,CAST(payee_id AS CHAR) payee_id,CAST(performer_id AS CHAR) performer_id,performer_name,rule_code
    FROM opc_earning_lines WHERE source_id IN (?) AND confirmed_at IS NOT NULL ORDER BY id DESC`,
    [ids],
  );
  const checks = await provider.inspect(
    c,
    actor,
    scope,
    sources.map((s) => String(s.source_key)),
  );
  if (
    new Set(checks.map((v) => v.sourceKey)).size !== checks.length ||
    checks.some((v) => !sources.some((s) => s.source_key === v.sourceKey))
  )
    fail('暂时无法核对收益来源，请重试', 502);
  return sources.map((source) => {
    const sourceLines = lines.filter((l) => l.source_id === source.id),
      balances = prior.filter((p) => p.source_id === source.id);
    const selected = sourceLines.find((l) => l.payee_id === scope.leaderId);
    const historical = old.find((l) => l.source_id === source.id && l.payee_id === scope.leaderId);
    const metadata = selected ?? historical;
    const before = textAmount(balances.find((l) => l.payee_id === scope.leaderId)?.amount);
    const amount = selected ? (selected.amount === null ? null : textAmount(selected.amount)) : '0.0000';
    const check = checks.find((v) => v.sourceKey === source.source_key) ?? null;
    const targets = new Map(sourceLines.filter((l) => !Number(l.is_internal)).map((l) => [String(l.payee_id), l]));
    const payees = [...new Set([...targets.keys(), ...balances.map((b) => String(b.payee_id))])].sort((a, b) =>
      BigInt(a) < BigInt(b) ? -1 : 1,
    );
    const impacts: SettlementImpact[] = payees.map((payeeId) => {
      const line = targets.get(payeeId),
        balance = balances.find((b) => b.payee_id === payeeId);
      const target = line?.amount === null ? '0.0000' : textAmount(line?.amount),
        confirmedAmount = textAmount(balance?.amount);
      return {
        payeeId,
        payeeName: String(line?.display_name ?? balance?.display_name ?? '收款人'),
        selectedRecipient: payeeId === scope.leaderId,
        amount: target,
        confirmedAmount,
        deltaAmount: cashText(cash(target, true) - cash(confirmedAmount, true)),
      };
    });
    const allocationMatches =
      !!check &&
      check.version === source.current_version &&
      check.allocations.length === targets.size &&
      check.allocations.every(
        (a) =>
          targets.has(a.payeeId) &&
          (a.amount === null
            ? targets.get(a.payeeId)!.amount === null
            : targets.get(a.payeeId)!.amount !== null &&
              cash(a.amount, true) === cash(String(targets.get(a.payeeId)!.amount), true)),
      );
    const complete =
      sourceLines.length > 0 &&
      sourceLines.every((l) => !Number(l.is_internal) && Number(l.is_ready) === 1 && l.amount !== null);
    const status =
      check?.status === 'confirmed' && allocationMatches
        ? 'confirmed'
        : check?.status === 'ready' && allocationMatches && complete && !source.blocked_reason
          ? 'ready'
          : 'blocked';
    const reason =
      status === 'confirmed'
        ? '金额已确认'
        : status === 'ready'
          ? '可核对并确认'
          : !allocationMatches
            ? '收益资料已变化，等待核对来源后自动更新'
            : String(
                source.blocked_reason ||
                  check?.reason ||
                  sourceLines.find((l) => l.blocked_reason)?.blocked_reason ||
                  '资料尚未齐备',
              );
    const record: SettlementRecord = {
      id: String(source.id),
      sourceKey: String(source.source_key),
      sourceVersion: String(source.current_version),
      taskId: String(source.task_id),
      taskName: String(source.task_name),
      businessDate: String(source.business_date),
      performerId: metadata?.performer_id ? String(metadata.performer_id) : null,
      performerName: String(metadata?.performer_name ?? '原执行人'),
      group:
        metadata?.rule_code === 'leader_override' ||
        (metadata?.performer_id && String(metadata.performer_id) !== scope.leaderId)
          ? 'team'
          : 'self',
      metricType: String(source.metric_type),
      metricLabel: String(source.metric_label),
      quantityUnit: String(source.quantity_unit),
      quantity: selected?.quantity == null ? null : String(selected.quantity),
      amount,
      confirmedAmount: before,
      deltaAmount: amount === null ? null : cashText(cash(amount, true) - cash(before, true)),
      status,
      reason,
      next:
        status === 'confirmed'
          ? ''
          : status === 'ready'
            ? '财务：预览本次确认范围'
            : check?.next || '财务：核对来源资料',
      nextAction: check?.nextAction ?? null,
    };
    const disclosedImpacts = sourceLines.some((l) => l.amount === null) ? [] : impacts;
    return {
      record,
      impacts: disclosedImpacts,
      check,
      fingerprint: checksum({
        record,
        impacts: disclosedImpacts,
        token: check?.token,
        allocations: check?.allocations,
      }),
    };
  });
}
export function summarizeSettlement(records: SettlementRecord[]): SettlementSummary {
  const groups = new Map<string, SettlementGroup>();
  for (const r of records) {
    const key = `${r.group}:${r.metricType}`;
    const group = groups.get(key) ?? {
      group: r.group,
      metricType: r.metricType,
      metricLabel: r.metricLabel,
      quantityUnit: r.quantityUnit,
      quantity: '0',
      amount: '0.0000',
      knownAmount: '0.0000',
      confirmedAmount: '0.0000',
      confirmableAmount: '0.0000',
      records: 0,
      pendingCalculations: 0,
    };
    group.records++;
    group.quantity =
      group.quantity === null || r.quantity === null ? null : String(BigInt(group.quantity) + BigInt(r.quantity));
    if (r.amount === null) group.pendingCalculations++;
    else group.knownAmount = add(group.knownAmount, r.amount);
    group.amount = group.pendingCalculations ? null : group.knownAmount;
    group.confirmedAmount = add(group.confirmedAmount, r.confirmedAmount);
    if (r.status === 'ready' && r.deltaAmount !== null)
      group.confirmableAmount = add(group.confirmableAmount, r.deltaAmount);
    groups.set(key, group);
  }
  const list = [...groups.values()],
    sum = (field: 'knownAmount' | 'confirmedAmount' | 'confirmableAmount') =>
      cashText(list.reduce((n, g) => n + cash(g[field], true), 0n));
  const pendingCalculations = list.reduce((n, g) => n + g.pendingCalculations, 0);
  return {
    amount: pendingCalculations ? null : sum('knownAmount'),
    knownAmount: sum('knownAmount'),
    confirmedAmount: sum('confirmedAmount'),
    confirmableAmount: sum('confirmableAmount'),
    pendingCalculations,
    records: records.length,
    ready: records.filter((r) => r.status === 'ready').length,
    blocked: records.filter((r) => r.status === 'blocked').length,
    confirmed: records.filter((r) => r.status === 'confirmed').length,
    groups: list,
  };
}
const versionOf = (scope: SettlementScope, loaded: Loaded[]) =>
  checksum({ scope, records: loaded.map((l) => [l.record.id, l.fingerprint]) });
export async function settlementReview(
  runtime: ModuleRuntime,
  user: AuthUser,
  input: SettlementScope,
  page = 1,
  pageSize = 25,
  status = 'all',
) {
  const scope = normalizedScope(input);
  return withTransaction(async (c) => {
    const { actor, provider } = await settlementAccess(c, runtime, user, scope);
    const selected = await recipient(c, scope),
      loaded = await loadRecords(c, actor, provider, scope);
    const filtered = loaded.filter((l) => status === 'all' || l.record.status === status),
      context = await provider.context(c, actor, scope);
    return {
      scope,
      recipient: selected,
      reviewVersion: versionOf(scope, loaded),
      summary: summarizeSettlement(loaded.map((l) => l.record)),
      ...context,
      coverage: loaded.length
        ? { status: 'observed' as const, message: '按已保存的应得归属核对，未齐资料保留下一步' }
        : context.coverage,
      list: filtered.slice((page - 1) * pageSize, page * pageSize).map((l) => l.record),
      total: filtered.length,
      page,
      pageSize,
    };
  });
}
export async function settlementRecord(runtime: ModuleRuntime, user: AuthUser, input: SettlementScope, id: string) {
  const scope = normalizedScope(input);
  return withTransaction(async (c) => {
    const { actor, provider } = await settlementAccess(c, runtime, user, scope);
    await recipient(c, scope);
    const found = (await loadRecords(c, actor, provider, scope)).find((l) => l.record.id === id);
    if (!found) fail('这条记录不在当前结算范围', 404);
    return { record: found.record, impacts: found.impacts, evidence: found.check?.evidence ?? null };
  });
}
export async function settlementReceipt<T>(
  c: PoolConnection,
  actor: AuthUser,
  operation: string,
  key: string,
  input: unknown,
  work: () => Promise<T>,
): Promise<T> {
  settlementKey.parse(key);
  const hash = checksum(input);
  await c.query(
    'INSERT INTO opc_settlement_requests(actor_id,operation,request_key,request_hash) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE id=id',
    [actor.sub, operation, key, hash],
  );
  const [receipt] = await rows(
    c,
    'SELECT * FROM opc_settlement_requests WHERE actor_id=? AND operation=? AND request_key=? FOR UPDATE',
    [actor.sub, operation, key],
  );
  if (receipt.request_hash !== hash) fail('这次提交的内容已变化，请重新核对后提交');
  if (receipt.response_json !== null) return json<T>(receipt.response_json);
  const result = await work();
  await c.query('UPDATE opc_settlement_requests SET response_json=? WHERE id=?', [JSON.stringify(result), receipt.id]);
  return result;
}
function aggregateImpacts(loaded: Loaded[]) {
  const map = new Map<string, SettlementImpact>();
  for (const l of loaded)
    for (const impact of l.impacts) {
      const prior = map.get(impact.payeeId);
      map.set(
        impact.payeeId,
        prior
          ? {
              ...prior,
              amount: add(prior.amount, impact.amount),
              confirmedAmount: add(prior.confirmedAmount, impact.confirmedAmount),
              deltaAmount: add(prior.deltaAmount, impact.deltaAmount),
            }
          : { ...impact },
      );
    }
  return [...map.values()];
}
function documentPage(doc: SettlementDocument, page = 1, pageSize = 25): SettlementDocument {
  return {
    ...doc,
    items: doc.items.slice((page - 1) * pageSize, page * pageSize),
    total: doc.items.length,
    page,
    pageSize,
  };
}
async function storedDocument(c: PoolConnection, id: string, owner: Owner, lock = false) {
  const [stored] = await rows(
    c,
    `SELECT *,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') created_text,
    DATE_FORMAT(confirmed_at,'%Y-%m-%d %H:%i:%s') confirmed_text FROM opc_settlements
    WHERE id=? AND module_id=? AND project_id=? AND account_id=? AND leader_id=? ${lock ? 'FOR UPDATE' : ''}`,
    [id, owner.moduleId, owner.projectId, owner.accountId, owner.leaderId],
  );
  if (!stored) fail('这份结算记录不可查看，请重新选择范围', 404);
  const doc = json<SettlementDocument>(stored.document_json);
  doc.createdAt = String(stored.created_text);
  doc.confirmedAt = stored.confirmed_text ? String(stored.confirmed_text) : null;
  return { stored, doc };
}
export async function previewSettlement(
  runtime: ModuleRuntime,
  user: AuthUser,
  input: SettlementScope,
  expectedReviewVersion: string,
  requestKey: string,
) {
  const scope = normalizedScope(input);
  return withTransaction(async (c) => {
    const { actor, provider } = await settlementAccess(c, runtime, user, scope, scope);
    const selected = await recipient(c, scope);
    const id = await settlementReceipt(c, actor, 'preview', requestKey, { scope, expectedReviewVersion }, async () => {
      const loaded = await loadRecords(c, actor, provider, scope),
        version = versionOf(scope, loaded);
      if (version !== expectedReviewVersion) fail('数据或处理状态已变化，请刷新后重新预览');
      const ready = loaded.filter((l) => l.record.status === 'ready');
      if (!ready.length) fail('当前没有可确认记录，请先处理待办或查看已确认结果', 422);
      const impacts = aggregateImpacts(ready);
      const doc: SettlementDocument = {
        id: '',
        version,
        status: 'preview',
        scope,
        recipient: selected,
        summary: summarizeSettlement(loaded.map((l) => l.record)),
        impacts,
        impactSummary: {
          recipients: impacts.length,
          records: ready.length,
          amount: cashText(impacts.reduce((n, p) => n + cash(p.amount, true), 0n)),
          deltaAmount: cashText(impacts.reduce((n, p) => n + cash(p.deltaAmount, true), 0n)),
        },
        items: loaded.map((l) => ({
          record: l.record,
          status: l.record.status,
          impacts: l.record.status === 'ready' ? l.impacts : [],
          reason: l.record.reason,
        })),
        createdAt: '',
        confirmedAt: null,
        total: loaded.length,
        page: 1,
        pageSize: 25,
        paymentStatus: 'not_initiated',
      };
      const [inserted] = await c.query<ResultSetHeader>(
        `INSERT INTO opc_settlements(module_id,project_id,account_id,leader_id,business_from,business_to,metric_type,preview_version,document_json,selection_json,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        [
          scope.moduleId,
          scope.projectId,
          scope.accountId,
          scope.leaderId,
          scope.from,
          scope.to,
          scope.metricType ?? null,
          version,
          JSON.stringify(doc),
          JSON.stringify(
            ready.map((l) => ({
              id: l.record.id,
              sourceKey: l.record.sourceKey,
              version: l.record.sourceVersion,
              fingerprint: l.fingerprint,
            })),
          ),
          actor.sub,
        ],
      );
      doc.id = String(inserted.insertId);
      await c.query('UPDATE opc_settlements SET document_json=? WHERE id=?', [JSON.stringify(doc), doc.id]);
      await writeAudit(
        {
          userId: actor.sub,
          action: 'settlement.preview',
          resourceType: 'settlement',
          resourceId: doc.id,
          detail: { scope, sources: ready.length, recipients: impacts.length },
        },
        c,
      );
      return doc.id;
    });
    return documentPage((await storedDocument(c, id, scope)).doc);
  });
}
export async function confirmSettlement(
  runtime: ModuleRuntime,
  user: AuthUser,
  owner: Owner,
  id: string,
  expectedVersion: string,
  requestKey: string,
) {
  return withTransaction(async (c) => {
    // Lock the account before any consistent read, so a concurrent confirmation cannot leave a stale read view.
    // Provider lock uses project/account only; the actual business dates always come from the stored document.
    const scope: SettlementScope = { ...owner, from: '2000-01-01', to: '2000-01-01' };
    const { actor, provider } = await settlementAccess(c, runtime, user, scope, scope);
    const { doc } = await storedDocument(c, id, owner, true);
    return settlementReceipt(c, actor, 'confirm', requestKey, { owner, id, expectedVersion }, async () => {
      if (doc.version !== expectedVersion) fail('这份预览已变化，请刷新后重新核对');
      if (doc.status === 'confirmed') return documentPage(doc);
      const { stored } = await storedDocument(c, id, owner, true);
      const selected = json<{ id: string; sourceKey: string; version: string; fingerprint: string }[]>(
        stored.selection_json,
      );
      const current = await loadRecords(c, actor, provider, doc.scope);
      for (const item of selected) {
        const fresh = current.find((l) => l.record.id === item.id);
        if (!fresh || fresh.record.status !== 'ready' || fresh.fingerprint !== item.fingerprint)
          fail('资料、金额或确认状态已变化，请刷新后重新预览');
      }
      if (provider.confirmMany) await provider.confirmMany(c, actor, doc.scope, selected);
      else for (const item of selected) await provider.confirm(c, actor, doc.scope, item.sourceKey, item.version);
      doc.status = 'confirmed';
      for (const item of doc.items)
        if (selected.some((s) => s.id === item.record.id)) {
          item.status = 'confirmed';
          item.reason = '金额已确认';
          item.record = {
            ...item.record,
            status: 'confirmed',
            confirmedAmount: item.record.amount!,
            deltaAmount: '0.0000',
            reason: '金额已确认',
            next: '',
            nextAction: null,
          };
        }
      doc.summary = summarizeSettlement(doc.items.map((i) => i.record));
      await c.query(
        "UPDATE opc_settlements SET status='confirmed',document_json=?,confirmed_by=?,confirmed_at=NOW(3) WHERE id=? AND status='preview'",
        [JSON.stringify(doc), actor.sub, id],
      );
      await writeAudit(
        {
          userId: actor.sub,
          action: 'settlement.confirm',
          resourceType: 'settlement',
          resourceId: id,
          detail: {
            scope: doc.scope,
            sources: selected.length,
            recipients: doc.impacts.length,
            deltaAmount: doc.impactSummary.deltaAmount,
          },
        },
        c,
      );
      return documentPage((await storedDocument(c, id, owner)).doc);
    });
  });
}
export async function settlementDetail(
  runtime: ModuleRuntime,
  user: AuthUser,
  owner: Owner,
  id: string,
  page = 1,
  pageSize = 25,
) {
  return withTransaction(async (c) => {
    await settlementAccess(c, runtime, user, owner);
    return documentPage((await storedDocument(c, id, owner)).doc, page, pageSize);
  });
}
export async function settlementList(
  runtime: ModuleRuntime,
  user: AuthUser,
  scope: Base & { leaderId?: string },
  page = 1,
  pageSize = 25,
) {
  return withTransaction(async (c) => {
    await settlementAccess(c, runtime, user, scope);
    const where = 'module_id=? AND project_id=? AND account_id=?' + (scope.leaderId ? ' AND leader_id=?' : ''),
      args = [scope.moduleId, scope.projectId, scope.accountId, ...(scope.leaderId ? [scope.leaderId] : [])];
    const [count] = await rows(c, `SELECT COUNT(*) total FROM opc_settlements WHERE ${where}`, args);
    const list = await rows(
      c,
      `SELECT document_json,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') created_text,DATE_FORMAT(confirmed_at,'%Y-%m-%d %H:%i:%s') confirmed_text FROM opc_settlements WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    );
    return {
      list: list.map((r) => {
        const {
          items,
          impacts,
          total,
          page: unusedPage,
          pageSize: unusedSize,
          ...doc
        } = json<SettlementDocument>(r.document_json);
        return {
          ...doc,
          createdAt: String(r.created_text),
          confirmedAt: r.confirmed_text ? String(r.confirmed_text) : null,
        };
      }),
      total: Number(count.total),
      page,
      pageSize,
    };
  });
}

export async function financeRecordComments(
  runtime: ModuleRuntime,
  user: AuthUser,
  owner: Owner,
  kind: 'settlement' | 'earning_source',
  id: string,
  options: { scope?: SettlementScope; page?: number; pageSize?: number; body?: string; requestKey?: string },
) {
  return withTransaction(async (c) => {
    const write = options.body !== undefined,
      lockScope: SettlementScope = options.scope ?? { ...owner, from: '2000-01-01', to: '2000-01-01' };
    const { actor, provider } = await settlementAccess(c, runtime, user, owner, write ? lockScope : undefined);
    if (kind === 'settlement') await storedDocument(c, id, owner);
    else {
      if (!options.scope) fail('请选择记录的业绩日期', 422);
      await recipient(c, owner);
      if (!(await loadRecords(c, actor, provider, normalizedScope(options.scope))).some((r) => r.record.id === id))
        fail('这条记录不在当前结算范围', 404);
    }
    const where = 'module_id=? AND project_id=? AND account_id=? AND leader_id=? AND context_kind=? AND context_id=?',
      args = [owner.moduleId, owner.projectId, owner.accountId, owner.leaderId, kind, id];
    if (write)
      return settlementReceipt(
        c,
        actor,
        'finance_comment',
        options.requestKey!,
        { owner, kind, id, body: options.body },
        async () => {
          const [r] = await c.query<ResultSetHeader>(
            'INSERT INTO opc_record_comments(module_id,project_id,account_id,leader_id,context_kind,context_id,author_id,body) VALUES(?,?,?,?,?,?,?,?)',
            [...args, actor.sub, options.body],
          );
          return commentView(
            (
              await rows(
                c,
                `SELECT CAST(cm.id AS CHAR) id,CAST(cm.author_id AS CHAR) author_id,u.display_name,cm.body,DATE_FORMAT(cm.created_at,'%Y-%m-%d %H:%i:%s') created_at FROM opc_record_comments cm JOIN users u ON u.id=cm.author_id WHERE cm.id=?`,
                [String(r.insertId)],
              )
            )[0],
          );
        },
      );
    const page = options.page ?? 1,
      pageSize = options.pageSize ?? 25;
    const [count] = await rows(c, `SELECT COUNT(*) total FROM opc_record_comments WHERE ${where}`, args);
    const list = await rows(
      c,
      `SELECT CAST(cm.id AS CHAR) id,CAST(cm.author_id AS CHAR) author_id,u.display_name,cm.body,DATE_FORMAT(cm.created_at,'%Y-%m-%d %H:%i:%s') created_at FROM opc_record_comments cm JOIN users u ON u.id=cm.author_id WHERE ${where
        .split(/\b(module_id|project_id|account_id|leader_id|context_kind|context_id)\b/)
        .map((v, i) => (i % 2 ? 'cm.' + v : v))
        .join('')} ORDER BY cm.id LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    );
    return { list: list.map(commentView), total: Number(count.total), page, pageSize };
  });
}
export const commentView = (r: RowDataPacket) => ({
  id: String(r.id),
  authorId: String(r.author_id),
  authorName: String(r.display_name),
  body: String(r.body),
  createdAt: String(r.created_at),
});
