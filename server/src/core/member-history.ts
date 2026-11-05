import { createHash } from 'node:crypto';
import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import type { AuthUser } from '../types';
import { canManageRole, effectiveDuty, isStaffRole, normalizeRole } from '../auth/roles';
import { AppError } from '../middleware/errors';
import { assertDuty } from './duties';
import type { ModuleRuntime } from './module-runtime';
import type { MemberHistoryChange, MemberHistoryContext, MemberHistoryRefresh } from './contracts';

const id = z.string().regex(/^[1-9]\d*$/);
const moment = z.string().min(10).max(40);
export const historyQuerySchema = z
  .object({
    projectId: id,
    at: moment.optional(),
    from: moment.optional(),
    to: moment.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const contextSchema = z
  .object({
    moduleId: z.string().min(1).max(64),
    accountId: id,
    sourceKind: z.string().min(1).max(64),
    sourceId: id,
    sourceVersion: z.string().min(1).max(128),
    operation: z.enum(['register_historical_keyword', 'assign_retro', 'adopt_legacy_record', 'refresh_unconfirmed']),
    selection: z.record(z.string().max(2000)).optional(),
  })
  .strict();
export const historyEvidenceSchema = z
  .object({
    projectId: id,
    effectiveFrom: moment,
    effectiveTo: moment.optional(),
    timePrecision: z.enum(['date', 'timestamp']),
    participation: z.boolean().optional(),
    historicalRole: z.enum(['creator', 'leader', 'operator', 'admin', 'developer']).optional(),
    leaderId: id.nullable().optional(),
    sourceKind: z.enum([
      'project_membership',
      'team_membership',
      'role_history',
      'operator_confirmation',
      'description',
    ]),
    sourceRef: z.string().trim().min(1).max(255).optional(),
    sourceSummary: z.string().trim().min(2).max(2000),
    confirmed: z.boolean().default(false),
    expectedVersion: z.number().int().min(0),
    requestKey: z.string().trim().min(8).max(128),
    supersedesId: id.optional(),
    context: contextSchema.optional(),
  })
  .strict()
  .refine((v) => v.participation !== undefined || v.historicalRole !== undefined || v.leaderId !== undefined, {
    message: '请填写要核实的项目参与、角色或团长',
  });
export type HistoryEvidenceInput = z.infer<typeof historyEvidenceSchema>;
export type HistoryStatus = 'matched' | 'unknown' | 'conflict';
export interface HistorySource {
  id: string;
  kind: string;
  ref: string;
  sourceRef?: string;
  from: string;
  to: string | null;
  version: number;
  origin?: string;
  priorHistoryUnknown?: boolean;
}
export interface HistoryField<T> {
  status: HistoryStatus;
  value: T | null;
  knownRange: { from: string; to: string | null }[];
  sources: HistorySource[];
}
export interface MemberHistoryResult {
  status: HistoryStatus;
  memberId: string;
  projectId: string;
  version: number;
  projectParticipation: HistoryField<boolean>;
  team: HistoryField<string | null>;
  role: HistoryField<string>;
  knownRange: { from: string; to: string };
  sources: HistorySource[];
  nextAction: null | {
    actor: string;
    label: string;
    method: 'POST';
    path: string;
    projectId: string;
    memberId: string;
  };
}
type Period = { from: number; to: number; value: unknown; source: HistorySource; trusted: boolean };
const text = (v: unknown) => (v == null ? null : String(v));
const sqlDate = (n: number) => new Date(n + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 23);
const iso = (n: number) => sqlDate(n).replace(' ', 'T') + '+08:00';
const inf = 253402185599999;
export function historyTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value))
    throw new AppError(422, 42200, '请填写有效日期或带时区的完整时间');
  const normalized =
    value.length === 10
      ? value + 'T00:00:00+08:00'
      : /[Zz]|[+-]\d{2}:\d{2}$/.test(value)
        ? value
        : value.replace(' ', 'T') + '+08:00';
  const n = Date.parse(normalized);
  const calendar = value.slice(0, 10),
    day = new Date(
      Date.UTC(Number(calendar.slice(0, 4)), Number(calendar.slice(5, 7)) - 1, Number(calendar.slice(8, 10))),
    )
      .toISOString()
      .slice(0, 10);
  if (!Number.isFinite(n) || day !== calendar) throw new AppError(422, 42200, '日期不存在，请重新选择');
  return n;
}
function range(q: { at?: string; from?: string; to?: string }) {
  if ((q.at && (q.from || q.to)) || (!q.at && (!q.from || !q.to)))
    throw new AppError(422, 42200, '请选择一个核实日期或完整日期范围');
  const from = historyTime(q.at ?? q.from!),
    last = q.at ?? q.to!;
  const to = historyTime(last) + (last.length === 10 ? 86400000 : q.at ? 1 : 0);
  if (to <= from || from > Date.now()) throw new AppError(422, 42200, '请选择已发生的日期，结束时间应晚于开始时间');
  return { from, to };
}
function field<T>(periods: Period[], from: number, to: number): HistoryField<T> {
  const matched = periods.filter((p) => p.from < to && p.to > from),
    boundaries = [...new Set([from, to, ...matched.flatMap((p) => [Math.max(from, p.from), Math.min(to, p.to)])])].sort(
      (a, b) => a - b,
    );
  let missing = false,
    conflict = false;
  const values = new Map<string, unknown>();
  for (let i = 0; i < boundaries.length - 1; i++) {
    const active = matched.filter((p) => p.from <= boundaries[i] && p.to >= boundaries[i + 1]);
    if (!active.length) {
      missing = true;
      continue;
    }
    // Reliable business records are never silently overwritten by a confirmation.
    const distinct = new Map(active.map((p) => [JSON.stringify(p.value), p.value]));
    if (distinct.size > 1) conflict = true;
    for (const [k, v] of distinct) values.set(k, v);
  }
  if (values.size > 1) conflict = true;
  return {
    status: conflict ? 'conflict' : missing || !values.size ? 'unknown' : 'matched',
    value: !conflict && !missing && values.size === 1 ? ([...values.values()][0] as T) : null,
    knownRange: matched.map((p) => ({
      from: iso(Math.max(from, p.from)),
      to: p.to === inf ? null : iso(Math.min(to, p.to)),
    })),
    sources: matched.map((p) => p.source),
  };
}
const dateColumns = (from: string, to?: string) =>
  `DATE_FORMAT(${from},'%Y-%m-%d %H:%i:%s.%f') history_from${to ? `,DATE_FORMAT(${to},'%Y-%m-%d %H:%i:%s.%f') history_to` : ''}`;
function timeRow(v: unknown) {
  return historyTime(String(v).replace(/(\.\d{3})\d+$/, '$1'));
}
function period(
  row: RowDataPacket,
  kind: string,
  value: unknown,
  to: unknown = row.history_to,
  trusted = true,
): Period {
  const f = timeRow(row.history_from),
    t = to == null ? inf : timeRow(to);
  return {
    from: f,
    to: t,
    value,
    trusted,
    source: {
      id: `${kind}:${row.id}`,
      kind,
      ref: String(row.id),
      sourceRef: text(row.source_ref) ?? undefined,
      from: iso(f),
      to: t === inf ? null : iso(t),
      version: Number(row.version ?? 1),
      origin: text(row.source_kind ?? row.source ?? row.reason) ?? undefined,
      ...(row.prior_history_unknown || row.source === 'migration' || row.reason === 'migration'
        ? { priorHistoryUnknown: true }
        : {}),
    },
  };
}
async function loadPeriods(c: PoolConnection, memberId: string, projectId: string, excludeEvidence?: string) {
  const [projects] = await c.query<RowDataPacket[]>(
    `SELECT *,${dateColumns('effective_from', 'effective_to')} FROM project_membership_history WHERE user_id=? AND project_id=? ORDER BY effective_from,id`,
    [memberId, projectId],
  );
  const [teams] = await c.query<RowDataPacket[]>(
    `SELECT *,${dateColumns('effective_from', 'effective_to')} FROM team_memberships WHERE user_id=? ORDER BY effective_from,id`,
    [memberId],
  );
  const [roles] = await c.query<RowDataPacket[]>(
    `SELECT *,${dateColumns('effective_at')} FROM member_role_history WHERE user_id=? ORDER BY effective_at,id`,
    [memberId],
  );
  const [evidence] = await c.query<RowDataPacket[]>(
    `SELECT e.*,${dateColumns('e.effective_from', 'e.effective_to')} FROM member_history_evidence e
    WHERE e.user_id=? AND e.project_id=? AND e.status='verified' AND NOT EXISTS(SELECT 1 FROM member_history_evidence replacement WHERE replacement.supersedes_id=e.id)
    ${excludeEvidence ? 'AND e.id<>?' : ''} ORDER BY e.id`,
    [memberId, projectId, ...(excludeEvidence ? [excludeEvidence] : [])],
  );
  const participation: Period[] = projects.flatMap((p, i) => {
    const active = period(p, 'project_membership', true),
      next = projects[i + 1],
      out: Period[] = [active];
    if (p.history_to != null) {
      const end = next?.history_from ?? null;
      out.push({
        ...period({ ...p, history_from: p.history_to }, 'project_membership', false, end),
        source: { ...active.source, id: active.source.id + ':left' },
      });
    }
    return out;
  });
  const team = teams.map((t) => period(t, 'team_membership', text(t.leader_id)));
  const role = roles.map((r, i) => {
    const next = roles[i + 1]?.history_from;
    // Multiple changes recorded at the identical millisecond have no reliable
    // ordering inside that instant. Keep both possibilities visible.
    return period(
      r,
      'role_history',
      String(r.to_role),
      next != null && timeRow(next) === timeRow(r.history_from) ? sqlDate(timeRow(next) + 1) : (next ?? null),
    );
  });
  for (const e of evidence) {
    if (e.participation != null)
      participation.push(period(e, 'history_evidence', Boolean(e.participation), e.history_to, false));
    if (e.has_team) team.push(period(e, 'history_evidence', text(e.leader_id), e.history_to, false));
    if (e.historical_role) role.push(period(e, 'history_evidence', String(e.historical_role), e.history_to, false));
  }
  return { participation, team, role };
}
export async function resolveMemberHistory(
  c: PoolConnection,
  memberId: string,
  projectId: string,
  q: { at?: string; from?: string; to?: string },
): Promise<MemberHistoryResult> {
  const { from, to } = range(q),
    p = await loadPeriods(c, memberId, projectId);
  const [[v]] = await c.query<RowDataPacket[]>(
    'SELECT version FROM member_history_versions WHERE user_id=? AND project_id=?',
    [memberId, projectId],
  );
  const projectParticipation = field<boolean>(p.participation, from, to),
    team = field<string | null>(p.team, from, to),
    role = field<string>(p.role, from, to);
  const fields = [projectParticipation, team, role],
    status = fields.some((f) => f.status === 'conflict')
      ? 'conflict'
      : fields.some((f) => f.status === 'unknown')
        ? 'unknown'
        : 'matched';
  return {
    memberId,
    projectId,
    version: Number(v?.version ?? 0),
    status,
    projectParticipation,
    team,
    role,
    knownRange: { from: iso(from), to: iso(to) },
    sources: [...new Map(fields.flatMap((f) => f.sources).map((s) => [s.id, s])).values()],
    nextAction:
      status === 'matched'
        ? null
        : {
            actor: '运营',
            label: status === 'conflict' ? '核对历史依据' : '补齐历史依据',
            method: 'POST',
            path: `/api/v1/core/relations/members/${memberId}/history-evidence`,
            projectId,
            memberId,
          },
  };
}

/** Recheck current database identity even when invoked outside HTTP middleware. */
export async function assertHistoryScope(
  c: PoolConnection,
  auth: AuthUser,
  memberId: string,
  projectId: string,
  write = false,
) {
  const [users] = await c.query<RowDataPacket[]>(
    'SELECT * FROM users WHERE id IN (?,?) ORDER BY id ' + (write ? 'FOR UPDATE' : 'FOR SHARE'),
    [auth.sub, memberId],
  );
  const actor = users.find((u) => String(u.id) === auth.sub),
    member = users.find((u) => String(u.id) === memberId),
    role = normalizeRole(actor?.role);
  if (!actor?.is_active || actor.closed_at || !role) throw new AppError(403, 40301, '账号权限已变化，请刷新后重试');
  const current: AuthUser = {
    ...auth,
    role,
    adminDuty: effectiveDuty({ role, adminDuty: actor.admin_duty }) as AuthUser['adminDuty'],
  };
  assertDuty(current, 'operations');
  if (!member) throw new AppError(404, 40400, '成员不存在，请重新选择');
  if (
    String(member.id) !== auth.sub &&
    ((isStaffRole(String(member.role)) && effectiveDuty(current) !== 'all') ||
      !canManageRole(current.role, normalizeRole(member.role)!))
  )
    throw new AppError(403, 40301, '无权核对该成员的历史，请由有管理权限的运营办理');
  const [[project]] = await c.query<RowDataPacket[]>('SELECT is_enabled FROM projects WHERE id=? FOR SHARE', [
    projectId,
  ]);
  if (!project?.is_enabled) throw new AppError(403, 40301, '项目已停用或不在可办理范围，请重新选择');
  const [[scope]] = await c.query<RowDataPacket[]>(
    `SELECT EXISTS(SELECT 1 FROM project_members WHERE user_id=? AND project_id=?) OR
    EXISTS(SELECT 1 FROM project_membership_history WHERE user_id=? AND project_id=?) OR EXISTS(SELECT 1 FROM member_history_evidence WHERE user_id=? AND project_id=?) present`,
    [memberId, projectId, memberId, projectId, memberId, projectId],
  );
  if (!Number(scope.present) && !isStaffRole(String(member.role)))
    throw new AppError(403, 40301, '该成员没有此项目的参与记录，请先核对成员与项目');
  return current;
}

async function sourceProof(c: PoolConnection, memberId: string, input: HistoryEvidenceInput, from: number, to: number) {
  if (input.sourceKind === 'description')
    return { status: 'pending' as const, snapshot: { description: input.sourceSummary } };
  if (input.sourceKind === 'operator_confirmation') {
    if (!input.confirmed || !input.sourceRef)
      throw new AppError(422, 42200, '人工核实需要填写依据引用，并明确确认已核对原始资料');
    return {
      status: 'verified' as const,
      snapshot: { sourceRef: input.sourceRef, sourceSummary: input.sourceSummary, confirmed: true },
    };
  }
  if (!input.sourceRef || !/^\d+$/.test(input.sourceRef)) throw new AppError(422, 42200, '请选择可核对的历史记录');
  const p = await loadPeriods(c, memberId, input.projectId),
    all = [...p.participation, ...p.team, ...p.role];
  const matched = all.filter(
    (p) => p.source.id === `${input.sourceKind}:${input.sourceRef}` && p.from <= from && p.to >= to,
  );
  if (!matched.length) throw new AppError(403, 40301, '依据不属于该成员、项目或时间范围，请重新选择');
  const expected =
    input.sourceKind === 'project_membership'
      ? input.participation
      : input.sourceKind === 'team_membership'
        ? input.leaderId
        : input.historicalRole;
  if (
    expected === undefined ||
    !matched.some((p) => p.value === expected) ||
    (input.sourceKind !== 'project_membership' && input.participation !== undefined) ||
    (input.sourceKind !== 'team_membership' && input.leaderId !== undefined) ||
    (input.sourceKind !== 'role_history' && input.historicalRole !== undefined)
  )
    throw new AppError(409, 40900, '填写内容与所选依据不一致，请核对原始资料');
  return { status: 'verified' as const, snapshot: matched.map((p) => ({ ...p.source, value: p.value })) };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
export async function saveMemberHistoryEvidence(
  c: PoolConnection,
  auth: AuthUser,
  memberId: string,
  raw: HistoryEvidenceInput,
  runtime: ModuleRuntime,
) {
  const input = historyEvidenceSchema.parse(raw);
  // Lock module accounts before users, matching business and account-closure lock order.
  await c.query(
    'SELECT a.id FROM integration_accounts a JOIN project_integrations pi ON pi.account_id=a.id WHERE pi.project_id=? ORDER BY a.id FOR UPDATE',
    [input.projectId],
  );
  const actor = await assertHistoryScope(c, auth, memberId, input.projectId, true);
  const hash = createHash('sha256')
    .update(JSON.stringify(canonical(input)))
    .digest('hex');
  const [[replay]] = await c.query<RowDataPacket[]>(
    'SELECT input_hash,result_json FROM member_history_evidence WHERE user_id=? AND project_id=? AND actor_id=? AND request_key=?',
    [memberId, input.projectId, actor.sub, input.requestKey],
  );
  if (replay) {
    if (replay.input_hash !== hash) throw new AppError(409, 40900, '这次提交的内容已变化，请刷新后重新核对');
    return json(replay.result_json);
  }
  await c.query('INSERT IGNORE INTO member_history_versions(user_id,project_id) VALUES(?,?)', [
    memberId,
    input.projectId,
  ]);
  const [[state]] = await c.query<RowDataPacket[]>(
    'SELECT version FROM member_history_versions WHERE user_id=? AND project_id=? FOR UPDATE',
    [memberId, input.projectId],
  );
  if (Number(state.version) !== input.expectedVersion)
    throw new AppError(409, 40900, '历史依据已更新，请刷新后核对最新内容');
  const from = historyTime(input.effectiveFrom),
    to = input.effectiveTo ? historyTime(input.effectiveTo) : from + (input.timePrecision === 'date' ? 86400000 : 1);
  const latestKnown =
    input.timePrecision === 'date' ? historyTime(sqlDate(Date.now()).slice(0, 10)) + 86400000 : Date.now() + 1;
  if (
    (input.timePrecision === 'date' &&
      (input.effectiveFrom.length !== 10 || (input.effectiveTo && input.effectiveTo.length !== 10))) ||
    (input.timePrecision === 'timestamp' && input.effectiveFrom.length === 10) ||
    to <= from ||
    from > Date.now() ||
    to > latestKnown
  )
    throw new AppError(422, 42200, '请按已核实的时间精度填写有效起止时间；未核实结束时间时只确认所填日期或时点');
  if (input.leaderId === memberId) throw new AppError(422, 42200, '成员不能作为自己的所属团长');
  if (input.leaderId) {
    const [[leader]] = await c.query<RowDataPacket[]>('SELECT id FROM users WHERE id=?', [input.leaderId]);
    if (!leader) throw new AppError(422, 42200, '团长记录不存在，请重新核对');
  }
  let replaced: RowDataPacket | undefined;
  if (input.supersedesId) {
    const [[old]] = await c.query<RowDataPacket[]>(
      `SELECT *,${dateColumns('effective_from', 'effective_to')} FROM member_history_evidence WHERE id=? AND user_id=? AND project_id=? AND NOT EXISTS(SELECT 1 FROM member_history_evidence r WHERE r.supersedes_id=?)`,
      [input.supersedesId, memberId, input.projectId, input.supersedesId],
    );
    if (!old) throw new AppError(409, 40900, '原依据已变化，请刷新后选择要更正的记录');
    if (
      (old.participation != null && input.participation === undefined) ||
      (old.historical_role != null && input.historicalRole === undefined) ||
      (old.has_team && input.leaderId === undefined)
    )
      throw new AppError(422, 42200, '更正时请一并核对原依据中的项目参与、角色和团长，避免遗漏原记录');
    replaced = old;
  }
  const proof = await sourceProof(c, memberId, input, from, to),
    previous = await resolveMemberHistory(c, memberId, input.projectId, { from: iso(from), to: iso(to) });
  if (replaced?.status === 'verified' && proof.status !== 'verified')
    throw new AppError(409, 40900, '已核实依据只能用新的已核实资料更正，请先核实原始资料');
  const p = await loadPeriods(c, memberId, input.projectId, input.supersedesId);
  if (proof.status === 'verified')
    for (const [periods, value] of [
      [p.participation, input.participation],
      [p.team, input.leaderId],
      [p.role, input.historicalRole],
    ] as const) {
      if (value === undefined) continue;
      if (periods.some((p) => p.from < to && p.to > from && p.value !== value))
        throw new AppError(409, 40900, '填写内容与已有历史依据冲突，请核对双方来源后更正原依据', {
          history: previous,
          proposed: {
            sourceKind: input.sourceKind,
            sourceRef: input.sourceRef,
            sourceSummary: input.sourceSummary,
            participation: input.participation,
            historicalRole: input.historicalRole,
            leaderId: input.leaderId,
          },
          nextAction: {
            actor: '运营',
            label: '核对双方依据',
            method: 'POST',
            path: `/api/v1/core/relations/members/${memberId}/history-evidence`,
          },
        });
    }
  let provider: ReturnType<ModuleRuntime['get']> | undefined;
  if (input.context) {
    const ctx = input.context;
    const [[account]] = await c.query<RowDataPacket[]>(
      `SELECT a.id FROM integration_accounts a JOIN project_integrations pi ON pi.account_id=a.id JOIN module_installations mi ON mi.module_id=a.module_id
      WHERE pi.project_id=? AND a.id=? AND a.module_id=? AND a.status='active'`,
      [input.projectId, ctx.accountId, ctx.moduleId],
    );
    provider = runtime.get(ctx.moduleId);
    if (!account || !provider?.accountLifecycle?.memberHistoryChanged)
      throw new AppError(403, 40301, '关联业务不在当前项目可办理范围，请返回原记录重新核对');
    if (proof.status !== 'verified') throw new AppError(422, 42200, '这份说明尚未核实，请先核实依据再继续处理原记录');
  }
  const version = Number(state.version) + 1;
  const [created] = await c.query<ResultSetHeader>(
    `INSERT INTO member_history_evidence(user_id,project_id,effective_from,effective_to,time_precision,participation,historical_role,has_team,leader_id,
    source_kind,source_ref,source_summary,source_snapshot,status,actor_id,request_key,input_hash,version,supersedes_id,context_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      memberId,
      input.projectId,
      sqlDate(from),
      sqlDate(to),
      input.timePrecision,
      input.participation ?? null,
      input.historicalRole ?? null,
      input.leaderId !== undefined,
      input.leaderId ?? null,
      input.sourceKind,
      input.sourceRef ?? null,
      input.sourceSummary,
      JSON.stringify({
        proof: proof.snapshot,
        previous,
        confirmation: {
          participation: input.participation,
          historicalRole: input.historicalRole,
          leaderId: input.leaderId,
        },
      }),
      proof.status,
      actor.sub,
      input.requestKey,
      hash,
      version,
      input.supersedesId ?? null,
      input.context ? JSON.stringify(input.context) : null,
    ],
  );
  await c.query('UPDATE member_history_versions SET version=? WHERE user_id=? AND project_id=?', [
    version,
    memberId,
    input.projectId,
  ]);
  const change: MemberHistoryChange = {
    memberId,
    projectId: input.projectId,
    effectiveFrom: iso(replaced ? Math.min(from, timeRow(replaced.history_from)) : from),
    effectiveTo: iso(replaced ? Math.max(to, timeRow(replaced.history_to)) : to),
    timePrecision: input.timePrecision,
    evidenceId: String(created.insertId),
    version,
    context: input.context as MemberHistoryContext | undefined,
  };
  const refresh: MemberHistoryRefresh = { status: 'unchanged', recalculated: 0, resumed: 0 };
  if (proof.status === 'verified') {
    const [installed] = await c.query<RowDataPacket[]>(
      `SELECT DISTINCT a.module_id FROM integration_accounts a JOIN project_integrations pi ON pi.account_id=a.id JOIN module_installations mi ON mi.module_id=a.module_id WHERE pi.project_id=? ORDER BY a.module_id`,
      [input.projectId],
    );
    for (const row of installed) {
      const module = runtime.get(String(row.module_id));
      if (!module) throw new AppError(503, 50300, '项目服务暂时无法更新，请恢复后重试，本次资料未保存');
      if (module.accountLifecycle?.memberHistoryChanged) {
        const result = await module.accountLifecycle.memberHistoryChanged(c, actor, {
          ...change,
          context: change.context?.moduleId === row.module_id ? change.context : undefined,
        });
        refresh.recalculated += result.recalculated;
        refresh.resumed += result.resumed;
        if (result.nextActions?.length) (refresh.nextActions ??= []).push(...result.nextActions);
        if (result.status === 'refreshed') refresh.status = 'refreshed';
      }
    }
  }
  const result = {
    status: proof.status,
    evidenceId: change.evidenceId,
    version,
    affectedScope: { memberId, projectId: input.projectId, from: change.effectiveFrom, to: change.effectiveTo },
    refreshStatus: refresh,
    nextAction:
      proof.status === 'pending'
        ? {
            actor: '运营',
            label: '核实原始资料后确认',
            method: 'POST',
            path: `/api/v1/core/relations/members/${memberId}/history-evidence`,
          }
        : refresh.nextActions?.[0] ?? null,
  };
  await c.query('UPDATE member_history_evidence SET result_json=? WHERE id=?', [
    JSON.stringify(result),
    change.evidenceId,
  ]);
  return result;
}

export async function listMemberHistoryEvidence(
  c: PoolConnection,
  auth: AuthUser,
  memberId: string,
  input: z.infer<typeof historyQuerySchema>,
) {
  await assertHistoryScope(c, auth, memberId, input.projectId);
  const result = await resolveMemberHistory(c, memberId, input.projectId, input);
  const [records] = await c.query<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) id,time_precision timePrecision,participation,historical_role historicalRole,has_team hasTeam,CAST(leader_id AS CHAR) leaderId,
    source_kind sourceKind,source_ref sourceRef,source_summary sourceSummary,status,version,CAST(actor_id AS CHAR) actorId,created_at createdAt,
    CAST(supersedes_id AS CHAR) supersedesId,${dateColumns('effective_from', 'effective_to')} FROM member_history_evidence WHERE user_id=? AND project_id=? ORDER BY version DESC LIMIT ? OFFSET ?`,
    [memberId, input.projectId, input.pageSize, (input.page - 1) * input.pageSize],
  );
  return { ...result, records, page: input.page, pageSize: input.pageSize };
}
