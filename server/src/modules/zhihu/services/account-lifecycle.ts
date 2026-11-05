import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { MemberHistoryChange, MemberHistoryContext, MemberHistoryContinuation, ModuleAccountLifecycle } from '../../../core/contracts';
import { AppError } from '../../../middleware/errors';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthUser } from '../../../types';
import { assertDuty } from '../../../core/duties';
import { effectiveDuty, normalizeRole } from '../../../auth/roles';
import { assertHistoryScope, historyTime, resolveMemberHistory, type MemberHistoryResult } from '../../../core/member-history';
import { businessDay, digest, fail, type Scope } from '../attribution/domain';
import type { RecordRow } from '../attribution/store';

// Lifecycle hooks are also loaded before database configuration is installed.
// Pure SQL helpers keep importing this module free of pool/config side effects.
async function select(c: PoolConnection, sql: string, values: unknown[] = []): Promise<RecordRow[]> {
  return (await c.query<RecordRow[]>(sql, values))[0];
}
function json<T>(value: unknown): T { return (typeof value === 'string' ? JSON.parse(value) : value) as T; }

const sourceId = z.string().regex(/^[1-9]\d*$/);
// A context is issued by the server for an actual record and selection. Clients
// cannot manufacture a valid continuation from a different operation or source.
const sourceVersion = async (value: unknown) => {
  const { config } = await import('../../../config');
  return 'v1:' + createHmac('sha256', config.jwt.secret).update('member-history-context:' + digest(value)).digest('hex');
};
const historyContextSchema = z.object({ moduleId: z.literal('zhihu'), accountId: sourceId,
  sourceKind: z.enum(['import_row', 'keyword']), sourceId, sourceVersion: z.string().regex(/^v1:[a-f0-9]{64}$/),
  operation: z.enum(['register_historical_keyword', 'assign_retro', 'adopt_legacy_record', 'refresh_unconfirmed']),
  selection: z.record(z.string()).default({}),
}).strict();
function historySelection(context: MemberHistoryContext) {
  const raw = context.selection ?? {};
  switch (context.operation) {
    case 'register_historical_keyword': return z.object({ executorId: sourceId, taskId: sourceId, fromDate: z.string().date().optional() }).strict().parse(raw);
    case 'assign_retro': return z.object({ executorId: sourceId, fromDate: z.string().date().optional() }).strict().parse(raw);
    case 'adopt_legacy_record': return z.object({ planId: sourceId }).strict().parse(raw);
    case 'refresh_unconfirmed': return z.object({ memberId: sourceId, from: z.string().date().optional(), to: z.string().date().optional() }).strict().refine(v => (!v.from && !v.to) || !!v.from && !!v.to && v.from <= v.to).parse(raw);
  }
}
async function historySource(c: PoolConnection, scope: Scope, context: MemberHistoryContext) {
  scope = { projectId: scope.projectId, accountId: scope.accountId };
  const { resolvedNames } = await import('../attribution/matching');
  const selection = historySelection(context);
  const sourceKind = ['register_historical_keyword', 'adopt_legacy_record'].includes(context.operation) ? 'import_row' : 'keyword';
  if (context.sourceKind !== sourceKind) fail('关联资料类型与操作不一致，请返回原记录重新核对', 422);
  const rates = await select(c, `SELECT id,metric_type,rule_code,status,effective_from,effective_to,published_at
    FROM opc_rate_rules WHERE project_id=? AND module_id='zhihu' ORDER BY id`, [scope.projectId]);
  if (sourceKind === 'import_row') {
    const [row] = await select(c, `SELECT r.id,r.batch_id,r.fact_id,r.processing_status,r.error_text,b.report_kind,b.status batch_status,
      SHA2(CAST(r.normalized_json AS CHAR),256) content_hash,
      JSON_OBJECT('date',JSON_EXTRACT(r.normalized_json,'$.date'),'channel',JSON_EXTRACT(r.normalized_json,'$.channel'),'keyword',JSON_EXTRACT(r.normalized_json,'$.keyword')) source,
      m.channel_mapping_id,m.keyword_id,m.confirmed_at FROM zh_import_rows r JOIN zh_import_batches b ON b.id=r.batch_id
      LEFT JOIN zh_import_row_matches m ON m.source_row_id=r.id WHERE r.id=? AND b.account_id=? AND b.project_id=? FOR UPDATE`, [context.sourceId, scope.accountId, scope.projectId]);
    if (!row) fail('关联报表记录不属于当前项目和来源', 403);
    if (!['committed', 'processed'].includes(String(row.batch_status)) || row.fact_id || !['exception', 'pending'].includes(String(row.processing_status)))
      fail('原报表记录已变化，请刷新后从当前记录继续办理', 409);
    const source = json<{ date: string; channel: string; keyword: string }>(row.source);
    const match = await resolvedNames(c, scope, context.sourceId, source);
    if (match.mappings.length !== 1 || String(match.mappings[0].project_id) !== scope.projectId) fail('请先核对这条记录的渠道', 409);
    const mappingId = String(match.mappings[0].stable_id);
    const plans = await select(c, `SELECT p.id,p.project_id,p.owner_id,p.status,p.sync_status,p.zhihu_plan_id,p.zhihu_task_id,p.channel_id,p.keyword,p.created_by,p.updated_at,
      DATE_FORMAT(p.created_at,'%Y-%m-%d %H:%i:%s') original_at,
      co.id work_id,co.owner_id executor_id,co.status work_status,co.sync_status work_sync_status,co.zhihu_composition_id,co.reject_reason,
      SHA2(co.promo_url,256) url_hash,SHA2(CAST(co.zhihu_status_json AS CHAR),256) upstream_hash,
      DATE_FORMAT(co.release_time,'%Y-%m-%d %H:%i:%s') published_at,co.updated_at work_changed
      FROM plans p LEFT JOIN compositions co ON co.plan_id=p.id WHERE ${'planId' in selection ? 'p.id=?' : 'BINARY p.keyword=?'} AND p.project_id=? ORDER BY p.id,co.release_time,co.id`,
      ['planId' in selection ? selection.planId : source.keyword, scope.projectId]);
    const version = await sourceVersion({ scope, operation: context.operation, selection, row, mapping: match.mappings, words: match.words, plans, rates });
    return { version, selection, source, row, mappingId, plans, keywordId: null, bindings: [] as RecordRow[] };
  }
  const [word] = await select(c, 'SELECT * FROM zh_keywords WHERE id=? AND account_id=? AND project_id=? FOR SHARE', [context.sourceId, scope.accountId, scope.projectId]);
  if (!word) fail('关联任务不属于当前项目和来源', 403);
  const bindings = await select(c, 'SELECT * FROM zh_keyword_bindings WHERE keyword_id=? ORDER BY id', [context.sourceId]);
  const from = 'from' in selection ? selection.from : undefined, to = 'to' in selection ? selection.to : undefined;
  const facts = await select(c, `SELECT id,version,current_revision_id,current_result_id,metric_type,DATE_FORMAT(business_date,'%Y-%m-%d') business_day
    FROM zh_metric_facts WHERE keyword_id=? AND account_id=? AND project_id=? ${from ? 'AND business_date BETWEEN ? AND ?' : ''} ORDER BY id`,
    [context.sourceId, scope.accountId, scope.projectId, ...(from ? [from, to] : [])]);
  const reviews = await select(c, `SELECT r.id,r.binding_id,r.status,r.policy,r.composition_id,r.evidence_id FROM zh_work_review_records r
    JOIN zh_keyword_bindings b ON b.id=r.binding_id WHERE b.keyword_id=? ORDER BY r.id`, [context.sourceId]);
  const work = await select(c, `SELECT id,owner_id,status,sync_status,zhihu_composition_id,reject_reason,release_time,updated_at,SHA2(promo_url,256) url_hash,
    SHA2(CAST(zhihu_status_json AS CHAR),256) upstream_hash FROM compositions WHERE plan_id=? ORDER BY id`, [word.plan_id]);
  const evidence = await select(c, `SELECT e.id,e.binding_id,e.submitted_by,e.status,e.reviewed_by,e.reviewed_at,
    SHA2(e.work_url,256) url_hash,SHA2(e.description,256) description_hash,e.reason FROM zh_evidence e
    JOIN zh_keyword_bindings b ON b.id=e.binding_id WHERE b.keyword_id=? ORDER BY e.id`, [context.sourceId]);
  const prices = await select(c, `SELECT v.id,v.status,v.effective_from,v.effective_to,v.published_at FROM zh_price_versions v
    JOIN zh_price_agreements a ON a.id=v.agreement_id WHERE a.account_id=? AND a.project_id=? AND a.task_id=? ORDER BY v.id`, [scope.accountId, scope.projectId, word.task_id]);
  return { version: await sourceVersion({ scope, operation: context.operation, selection, word, bindings, facts, reviews, work, evidence, rates, prices }), selection,
    source: { date: 'fromDate' in selection && selection.fromDate || from || String(facts[0]?.business_day ?? ''), channel: '', keyword: String(word.keyword) },
    row: word, mappingId: String(word.channel_mapping_id), plans: [], keywordId: String(word.id), bindings };
}
export async function createHistoryKeywordContext(c: PoolConnection, scope: Scope, keywordId: string, memberId: string, period?: { from: string; to: string }): Promise<MemberHistoryContext> {
  const context: MemberHistoryContext = { moduleId: 'zhihu', accountId: scope.accountId, sourceKind: 'keyword', sourceId: keywordId,
    sourceVersion: '', operation: 'refresh_unconfirmed', selection: { memberId, ...period } };
  context.sourceVersion = (await historySource(c, scope, context)).version;
  return context;
}
export async function createHistoryImportContext(c: PoolConnection, scope: Scope, rowId: string,
  operation: 'register_historical_keyword' | 'adopt_legacy_record', selection: Record<string, string>): Promise<MemberHistoryContext> {
  const context: MemberHistoryContext = { moduleId: 'zhihu', accountId: scope.accountId, sourceKind: 'import_row', sourceId: rowId, sourceVersion: '', operation, selection };
  context.sourceVersion = (await historySource(c, scope, context)).version;
  return context;
}
export async function createHistoryAssignmentContext(c: PoolConnection, scope: Scope, keywordId: string, selection: Record<string, string>): Promise<MemberHistoryContext> {
  // Freeze the same effective start used by assignRetroInTransaction. Import
  // insertion order and already confirmed dates must not change continuation.
  if (!selection.fromDate) {
    const { unconfirmedFactSql } = await import('../attribution/keyword-usability');
    const [earliest] = await select(c, `SELECT DATE_FORMAT(MIN(f.business_date),'%Y-%m-%d') earliest
      FROM zh_metric_facts f WHERE f.keyword_id=? AND f.account_id=? AND f.project_id=? AND ${unconfirmedFactSql()}`,
      [keywordId, scope.accountId, scope.projectId]);
    selection = { ...selection, fromDate: String(earliest?.earliest ?? businessDay()) };
  }
  const context: MemberHistoryContext = { moduleId: 'zhihu', accountId: scope.accountId, sourceKind: 'keyword', sourceId: keywordId, sourceVersion: '', operation: 'assign_retro', selection };
  context.sourceVersion = (await historySource(c, scope, context)).version;
  return context;
}

async function memberHistoryChanged(c: PoolConnection, auth: AuthUser, change: MemberHistoryChange) {
  const { audit } = await import('../attribution/store');
  const { unconfirmedFactSql } = await import('../attribution/keyword-usability');
  const context = change.context ? historyContextSchema.parse(change.context) : undefined;
  const [actor] = await select(c, 'SELECT role,admin_duty,is_active,closed_at FROM users WHERE id=? FOR SHARE', [auth.sub]);
  const role = normalizeRole(actor?.role);
  if (!role || !actor.is_active || actor.closed_at) fail('当前账号不可办理历史核对', 403);
  const user: AuthUser = { ...auth, role, adminDuty: effectiveDuty({ role, adminDuty: actor.admin_duty }) as AuthUser['adminDuty'] };
  assertDuty(user, 'operations');
  const [evidence] = await select(c, `SELECT id FROM member_history_evidence WHERE id=? AND user_id=? AND project_id=? AND version=? AND status='verified'`,
    [change.evidenceId, change.memberId, change.projectId, change.version]);
  if (!evidence) fail('历史依据尚未核实或版本已变化', 409);
  const fromTime = historyTime(change.effectiveFrom), toTime = change.effectiveTo ? historyTime(change.effectiveTo) : fromTime + 1;
  if (toTime <= fromTime) fail('历史资料日期范围不正确');
  const dayAt = (time: number) => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
  const from = dayAt(fromTime), to = dayAt(toTime - 1);
  const accounts = await select(c, `SELECT a.id FROM integration_accounts a JOIN project_integrations pi ON pi.account_id=a.id JOIN projects p ON p.id=pi.project_id
    WHERE pi.project_id=? AND a.module_id='zhihu' AND a.status='active' AND p.is_enabled=1 ${context ? 'AND a.id=?' : ''} ORDER BY a.id FOR UPDATE`,
    [change.projectId, ...(context ? [context.accountId] : [])]);
  if (context && accounts.length !== 1) fail('关联来源已停用或不属于当前项目', 403);
  let resumed = 0, recalculated = 0;
  const nextActions: MemberHistoryContinuation[] = [];
  for (const account of accounts) {
    const scope = { projectId: change.projectId, accountId: String(account.id) };
    const [route] = await select(c, "SELECT mode,DATE_FORMAT(exclusive_from,'%Y-%m-%d') start FROM zh_engine_routes WHERE project_id=? AND account_id=?", [scope.projectId, scope.accountId]);
    if (context && (!route || route.mode === 'stopped')) fail('该项目当前暂停核算，请恢复后从原记录继续办理', 409);
    if (!route || route.mode === 'stopped') continue;
    let selectedKeyword: string | null = null;
    let actionCalculated = false;
    if (context) {
      const source = await historySource(c, scope, context), selection = source.selection;
      if (!timingSafeEqual(Buffer.from(source.version), Buffer.from(context.sourceVersion))) fail('关联资料已更新，请返回原记录重新核对', 409);
      const member = 'executorId' in selection ? selection.executorId : 'memberId' in selection ? selection.memberId : String(source.plans[0]?.executor_id ?? '');
      const originalOwner = context.operation === 'register_historical_keyword' && source.plans.length && String(source.plans[0].owner_id) !== member
        ? String(source.plans[0].owner_id) : null;
      const originalOwnerAt = originalOwner ? String(source.plans[0].original_at ?? '') : '';
      const originalOwnerChange = originalOwner === change.memberId;
      const businessAt = originalOwnerChange ? originalOwnerAt : context.operation === 'adopt_legacy_record' ? String(source.plans[0]?.published_at ?? '') :
        'fromDate' in selection && selection.fromDate || source.source.date;
      if (member !== change.memberId && !originalOwnerChange) {
        if (!businessAt) fail('原记录缺少业务日期，请先核对原始资料', 409);
        const executorHistory = await resolveMemberHistory(c, member, scope.projectId, { at: businessAt });
        if (executorHistory.team.status !== 'matched' || executorHistory.team.value !== change.memberId)
          fail('历史依据与关联记录的执行人或历史团长不一致', 403);
      }
      if (businessAt && (historyTime(businessAt) < fromTime || historyTime(businessAt) >= toTime)) fail('历史依据没有覆盖原记录的业务日期', 409);
      if (context.operation === 'refresh_unconfirmed' && !source.bindings?.some(b => String(b.executor_id) === change.memberId || String(b.leader_id) === change.memberId))
        fail('该成员与关联任务没有已保存的执行关系', 403);
      await c.query('SAVEPOINT history_resume');
      try {
        if (context.operation === 'register_historical_keyword' && 'executorId' in selection && 'taskId' in selection) {
          const { registerHistoricalKeyword } = await import('../attribution/historical-keywords');
          selectedKeyword = (await registerHistoricalKeyword(c, user, scope, source.mappingId, source.source, { executorId: selection.executorId, taskId: String(selection.taskId), fromDate: selection.fromDate })).id;
        } else if (context.operation === 'adopt_legacy_record' && 'planId' in selection) {
          const { adoptLegacyReportRecord } = await import('../attribution/legacy-report-records');
          selectedKeyword = await adoptLegacyReportRecord(c, user, scope, source.mappingId, source.source.keyword, selection.planId);
        } else if (context.operation === 'assign_retro' && 'executorId' in selection) {
          const { assignRetroInTransaction } = await import('../attribution/retro-assignment');
          const assigned = await assignRetroInTransaction(c, user, scope, context.sourceId, selection);
          selectedKeyword = context.sourceId; recalculated += assigned.recalculated; actionCalculated = true;
        } else selectedKeyword = context.sourceId;
        if (context.sourceKind === 'import_row' && selectedKeyword) {
          await c.query(`INSERT INTO zh_import_row_matches(source_row_id,channel_mapping_id,keyword_id,confirmed_by) VALUES(?,?,?,?)
            ON DUPLICATE KEY UPDATE channel_mapping_id=VALUES(channel_mapping_id),keyword_id=VALUES(keyword_id),confirmed_by=VALUES(confirmed_by),confirmed_at=NOW(3)`,
            [context.sourceId, source.mappingId, selectedKeyword, user.sub]);
          await c.query("UPDATE zh_import_rows SET processing_status='pending',error_text=NULL WHERE id=?", [context.sourceId]);
          const { processImportRow } = await import('../attribution/facts');
          await processImportRow(c, user, scope, context.sourceId); resumed++;
        }
        await c.query('RELEASE SAVEPOINT history_resume');
      } catch (error) {
        await c.query('ROLLBACK TO SAVEPOINT history_resume');
        await c.query('RELEASE SAVEPOINT history_resume');
        // Valid partial historical evidence remains saved. Only the expected
        // missing/conflicting-history outcome is retained as a business todo.
        if (!(error instanceof AppError) || !error.extras?.history) throw error;
        if (context.sourceKind === 'import_row') {
          const existing = await select(c, "SELECT id FROM zh_exceptions WHERE account_id=? AND project_id=? AND source_row_id=? AND reason_code='KEYWORD_UNKNOWN' AND status='open'", [scope.accountId, scope.projectId, context.sourceId]);
          if (!existing.length) await c.query("INSERT INTO zh_exceptions(account_id,project_id,source_row_id,reason_code) VALUES(?,?,?,'KEYWORD_UNKNOWN')", [scope.accountId, scope.projectId, context.sourceId]);
        }
        await audit(c, user, 'history.awaiting-evidence', context.sourceId, { evidenceId: change.evidenceId, operation: context.operation });
        const remaining = error.extras.history as MemberHistoryResult;
        const proposed = error.extras.nextAction as { label?: string; at?: string } | undefined;
        await assertHistoryScope(c, user, remaining.memberId, scope.projectId);
        const isOriginalOwner = remaining.memberId === originalOwner;
        const isLeader = remaining.memberId !== member && !isOriginalOwner;
        const missingFields: MemberHistoryContinuation['missingFields'] = [];
        if (!isOriginalOwner && (remaining.projectParticipation.status !== 'matched' || remaining.projectParticipation.value !== true)) missingFields.push('projectParticipation');
        if (remaining.role.status !== 'matched' || isLeader && remaining.role.value !== 'leader') missingFields.push('role');
        if (!isLeader && !isOriginalOwner && remaining.team.status !== 'matched') missingFields.push('team');
        nextActions.push({ actor: '运营', label: proposed?.label ?? '补齐历史依据', method: 'POST',
          path: `/api/v1/core/relations/members/${remaining.memberId}/history-evidence`,
          memberId: remaining.memberId, projectId: scope.projectId, at: proposed?.at ?? (isOriginalOwner ? originalOwnerAt : remaining.knownRange.from),
          reason: error.message, missingFields, expectedVersion: remaining.version,
          context: { ...context, sourceVersion: (await historySource(c, scope, context)).version },
        });
        continue;
      }
    }
    const facts = actionCalculated ? [] : await select(c, `SELECT f.*,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day FROM zh_metric_facts f
      WHERE f.project_id=? AND f.account_id=? AND f.business_date BETWEEN ? AND ? AND f.business_date>=?
      AND ${unconfirmedFactSql()} AND ${selectedKeyword ? 'f.keyword_id=?' : 'EXISTS(SELECT 1 FROM zh_keyword_bindings b WHERE b.keyword_id=f.keyword_id AND (b.executor_id=? OR b.leader_id=?))'}
      ORDER BY f.id LIMIT 1001 FOR UPDATE`, [scope.projectId, scope.accountId, from, to, route.start, ...(selectedKeyword ? [selectedKeyword] : [change.memberId, change.memberId])]);
    if (facts.length > 1000) fail('受影响资料较多，请缩小核实日期范围后继续办理');
    const { attribute } = await import('../attribution/facts');
    for (const fact of facts) { await attribute(c, scope, fact); recalculated++; }
    if (selectedKeyword) {
      const { processResolvedNames } = await import('../attribution/automatic-repair');
      resumed += await processResolvedNames(c, user, scope, { from, to, keywordIds: [selectedKeyword] });
    }
  }
  return { status: resumed || recalculated ? 'refreshed' as const : 'unchanged' as const, resumed, recalculated,
    ...(nextActions.length ? { nextActions } : {}) };
}

export const zhihuAccountLifecycle: ModuleAccountLifecycle = {
  memberHistoryChanged,
  async preserveMemberAccess(c, userId) {
    const [legacy] = await c.query<RowDataPacket[]>(
      `SELECT p.id FROM plans p WHERE p.owner_id=? AND p.status<>'ended'
       AND NOT EXISTS(SELECT 1 FROM zh_keywords k WHERE k.plan_id=p.id) LIMIT 1 FOR UPDATE`,
      [userId],
    );
    if (legacy.length) throw new AppError(409, 40900, '仍有未整理归属的旧任务，请先在任务管理中核对归属，再重新预览');
    const [bindings] = await c.query<RowDataPacket[]>(
      `SELECT b.id,b.executor_id,b.path_type,k.keyword,k.project_id FROM zh_keyword_bindings b JOIN zh_keywords k ON k.id=b.keyword_id
       WHERE (b.executor_id=? OR b.leader_id=?) AND b.released_at IS NULL AND b.stop_new_use_at IS NULL ORDER BY b.id FOR UPDATE`,
      [userId, userId],
    );
    if (bindings.some((b) => !b.executor_id))
      throw new AppError(409, 40900, '仍有待分配任务，请先在任务管理中分配或退回，再重新预览');
    for (const b of bindings)
      await c.query(
        'UPDATE zh_keyword_bindings SET access_preserved_at=COALESCE(access_preserved_at,NOW(3)) WHERE id=?',
        [b.id],
      );
    return bindings.map((b) => ({ id: String(b.id), label: String(b.keyword), projectId: String(b.project_id) }));
  },
  async accessChangeBlockers(c, userId, projectId) {
    const [bindings] = await c.query<RowDataPacket[]>(
      `SELECT b.id FROM zh_keyword_bindings b JOIN zh_keywords k ON k.id=b.keyword_id
       WHERE (b.leader_id=? OR b.executor_id=?) AND b.released_at IS NULL AND b.stop_new_use_at IS NULL
       ${projectId ? 'AND k.project_id=?' : ''} LIMIT 1 FOR UPDATE`,
      projectId ? [userId, userId, projectId] : [userId, userId],
    );
    return bindings.length
      ? [
          projectId
            ? '该成员在待移除项目中仍有使用中的关键词，请先处理后再移出'
            : '该账号仍有使用中的关键词，请先结束或退回后再调整角色或团队',
        ]
      : [];
  },
  async closureBlockers(c, userId) {
    const checks: Array<[string, string, string[]]> = [
      [
        '请先完成或解除正在使用的关键词分配',
        'SELECT id FROM zh_keyword_bindings WHERE (executor_id=? OR leader_id=?) AND released_at IS NULL LIMIT 1',
        [userId, userId],
      ],
      [
        '请先处理进行中的作品和计划',
        "SELECT id FROM compositions WHERE owner_id=? AND (status IN ('pending','active') OR sync_status IN ('local','syncing')) LIMIT 1",
        [userId],
      ],
      [
        '请先处理进行中的计划',
        "SELECT id FROM plans WHERE owner_id=? AND (status IN ('pending','active','paused') OR sync_status IN ('local','syncing')) LIMIT 1",
        [userId],
      ],
      [
        '请先处理历史提现申请',
        "SELECT id FROM withdrawal_requests WHERE user_id=? AND status='pending' LIMIT 1",
        [userId],
      ],
      [
        '请先核清历史收益',
        "SELECT id FROM earnings WHERE user_id=? AND status<>'paid' AND amount<>0 LIMIT 1",
        [userId],
      ],
    ];
    const reasons: string[] = [];
    for (const [label, sql, params] of checks) {
      const [rows] = await c.query<RowDataPacket[]>(sql, params);
      if (rows.length) reasons.push(label);
    }
    return reasons;
  },
  async erasePersonalData(c, userId) {
    await c.query('UPDATE users SET zhihu_uid=NULL WHERE id=?', [userId]);
  },
};
