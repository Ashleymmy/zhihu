import type { PoolConnection } from 'mysql2/promise';
import { createHash } from 'node:crypto';
import type { AuthUser } from '../../../types';
import { withTransaction } from '../../../db';
import type { AllianceUploadFile } from '../zhihu/allianceXlsx';
import { normalizeUploadFilename } from '../services/data-import.service';
import { audit, authorize, insert, json, mutate, scopeLock, select, type RecordRow } from './store';
import { digest, fail, money, moneyText, type Scope } from './domain';
import { parseReport, REPORT_TEMPLATE_VERSION, type ReportKind, type SourceRow } from './report';
import { quote, type Obligation } from './pricing';
import { refreshAdjustments } from './statements';
import { scheduleImport } from './outbox';
import { assertNewRoute, assertEngineWritable } from './routing';
export interface FactSnapshot {
  search: string | null;
  orders: string | null;
  revenue: string | null;
  riskAssessment?: string | null;
  sources: Partial<Record<'search' | 'orders' | 'revenue' | 'riskAssessment', { kind: ReportKind; rowId: string }>>;
}
export interface AttributionSnapshot {
  date: string;
  keyword: string;
  orders: string | null;
  search: string | null;
  revenue: string | null;
  binding: Record<string, unknown> | null;
  obligations: Obligation[];
}
const empty = (): FactSnapshot => ({ search: null, orders: null, revenue: null, sources: {} });
function mergeSource(before: FactSnapshot, raw: SourceRow, kind: ReportKind, rowId: string) {
  const next: FactSnapshot = JSON.parse(JSON.stringify(before));
  const owned: ('search' | 'orders' | 'revenue')[] =
    kind === 'search' ? ['search'] : kind === 'order' ? ['orders', 'revenue'] : ['search', 'orders', 'revenue'];
  let changed = false,
    conflict = false;
  for (const metric of owned) {
    // 订单和收益属于同一报告口径；本次未提供收益时不能继承旧订单的收益。
    if (raw[metric] === null && metric !== 'revenue') continue;
    if (before[metric] !== null && before[metric] !== raw[metric]) conflict = true;
    if (before[metric] !== raw[metric]) changed = true;
    next[metric] = raw[metric];
    next.sources[metric] = { kind, rowId };
  }
  // 缺少风险列不解除已有风险；搜索分报的空值也不能替订单报告解除风险。
  if (raw.riskAssessment !== undefined && (kind !== 'search' || raw.riskAssessment !== null)) {
    if ((before.riskAssessment ?? null) !== raw.riskAssessment) {
      changed = true;
      if (before.orders !== null || before.riskAssessment) conflict = true;
    }
    next.riskAssessment = raw.riskAssessment;
    next.sources.riskAssessment = { kind, rowId };
  }
  if (kind === 'order' && raw.search !== null && before.search !== null && raw.search !== before.search)
    conflict = true;
  return { next, changed, conflict };
}
export async function previewImport(user: AuthUser, scope: Scope, file: AllianceUploadFile, kind: ReportKind) {
  if (user.role !== 'admin') fail('仅管理员可导入来源报告', 403);
  await authorize(user, scope);
  const name = normalizeUploadFilename(file.originalname);
  const parsed = await parseReport({ ...file, originalname: name }, kind);
  const hash = createHash('sha256')
    .update(file.buffer as Buffer)
    .digest('hex');
  const previewHash = digest({ scope, kind, hash, rows: parsed, template: REPORT_TEMPLATE_VERSION });
  return withTransaction(async (c) => {
    await scopeLock(c, scope, user);
    await assertEngineWritable(c, scope);
    const existing = await select(
      c,
      'SELECT id,project_id,template_version FROM zh_import_batches WHERE account_id=? AND file_sha256=? AND report_kind=? FOR UPDATE',
      [scope.accountId, hash, kind],
    );
    if (existing.some((batch) => String(batch.project_id) !== scope.projectId)) fail('相同来源已属于其他项目', 409);
    const duplicate = existing.find((batch) => batch.template_version === REPORT_TEMPLATE_VERSION);
    if (duplicate) return { id: String(duplicate.id), duplicate: true };
    const id = await insert(
      c,
      'INSERT INTO zh_import_batches(account_id,project_id,file_name,file_sha256,file_bytes,report_kind,template_version,preview_hash,created_by) VALUES(?,?,?,?,?,?,?,?,?)',
      [scope.accountId, scope.projectId, name, hash, file.buffer, kind, REPORT_TEMPLATE_VERSION, previewHash, user.sub],
    );
    for (const row of parsed)
      await insert(
        c,
        'INSERT INTO zh_import_rows(batch_id,line_number,normalized_json,raw_json,error_text,processing_status) VALUES(?,?,?,?,?,?)',
        [
          id,
          row.rowNumber,
          JSON.stringify(row.value),
          JSON.stringify(row.raw),
          row.error,
          row.error ? 'invalid' : 'pending',
        ],
      );
    await audit(c, user, 'report.preview', id, { ...scope, hash, kind });
    return { id, duplicate: false };
  });
}
export async function importDetail(user: AuthUser, scope: Scope, id: string, page: number, pageSize: number) {
  if (user.role !== 'admin') fail('原始报告仅管理员可见', 403);
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const [batch] = await select(
      c,
      'SELECT CAST(id AS CHAR) id,file_name,file_sha256,report_kind,template_version,preview_hash,status,created_at FROM zh_import_batches WHERE id=? AND account_id=? AND project_id=?',
      [id, scope.accountId, scope.projectId],
    );
    if (!batch) fail('批次不存在', 404);
    const counts = await select(
      c,
      'SELECT processing_status,COUNT(*) total FROM zh_import_rows WHERE batch_id=? GROUP BY processing_status',
      [id],
    );
    const rows = await select(
      c,
      'SELECT CAST(id AS CHAR) id,line_number,normalized_json,raw_json,error_text,processing_status,CAST(fact_id AS CHAR) fact_id FROM zh_import_rows WHERE batch_id=? ORDER BY line_number LIMIT ? OFFSET ?',
      [id, pageSize, (page - 1) * pageSize],
    );
    return {
      ...batch,
      id: String(batch.id),
      template_version: String(batch.template_version),
      preview_hash: String(batch.preview_hash),
      counts: counts.map((r) => ({ processing_status: String(r.processing_status), total: Number(r.total) })),
      rows,
      page,
      pageSize,
    };
  });
}
export async function listImports(user: AuthUser, scope: Scope, page: number, pageSize: number) {
  if (user.role !== 'admin') fail('原始报告仅管理员可见', 403);
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const list = await select(
      c,
      'SELECT CAST(b.id AS CHAR) id,file_name,report_kind,b.status,b.created_at,j.status job_status,j.attempts,j.last_error FROM zh_import_batches b LEFT JOIN zh_processing_jobs j ON j.batch_id=b.id WHERE b.account_id=? AND b.project_id=? ORDER BY b.id DESC LIMIT ? OFFSET ?',
      [scope.accountId, scope.projectId, pageSize, (page - 1) * pageSize],
    );
    const [total] = await select(
      c,
      'SELECT COUNT(*) total FROM zh_import_batches WHERE account_id=? AND project_id=?',
      [scope.accountId, scope.projectId],
    );
    return { list, total: Number(total.total), page, pageSize };
  });
}
export async function originalFile(user: AuthUser, scope: Scope, id: string) {
  if (user.role !== 'admin') fail('原始报告仅管理员可见', 403);
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const [file] = await select(
      c,
      'SELECT file_name,file_bytes FROM zh_import_batches WHERE id=? AND account_id=? AND project_id=?',
      [id, scope.accountId, scope.projectId],
    );
    if (!file) fail('原文件不存在', 404);
    return { name: String(file.file_name), bytes: file.file_bytes as Buffer };
  });
}
export async function requeueImport(user: AuthUser, scope: Scope, id: string, key: string) {
  if (user.role !== 'admin') fail('仅管理员可补投任务', 403);
  return mutate(user, scope, 'report.requeue', key, { id }, async (c) => {
    const [batch] = await select(
      c,
      "SELECT id FROM zh_import_batches WHERE id=? AND account_id=? AND project_id=? AND status<>'preview' FOR UPDATE",
      [id, scope.accountId, scope.projectId],
    );
    if (!batch) fail('批次尚未确认', 409);
    await scheduleImport(c, scope, id, user.sub);
    await audit(c, user, 'report.requeue', id);
    return { id };
  });
}
export async function commitImport(user: AuthUser, scope: Scope, id: string, key: string, previewHash: string) {
  if (user.role !== 'admin') fail('仅管理员可确认导入', 403);
  return mutate(user, scope, 'report.commit', key, { id, previewHash }, async (c) => {
    const [batch] = await select(
      c,
      'SELECT * FROM zh_import_batches WHERE id=? AND account_id=? AND project_id=? FOR UPDATE',
      [id, scope.accountId, scope.projectId],
    );
    if (!batch) fail('批次不存在', 404);
    if (batch.status === 'preview' && batch.template_version !== REPORT_TEMPLATE_VERSION)
      fail('报告解析规则已更新，请重新上传并核对预览', 409);
    if (batch.preview_hash !== previewHash) fail('预览已变化，请重新核对', 409);
    const dates = await select(
      c,
      "SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(normalized_json,'$.date')) day FROM zh_import_rows WHERE batch_id=? AND processing_status<>'invalid'",
      [id],
    );
    if (!dates.length) fail('批次没有有效行');
    for (const date of dates) await assertNewRoute(c, scope, String(date.day));
    await c.query(
      "UPDATE zh_import_batches SET status='committed',committed_by=?,committed_at=COALESCE(committed_at,NOW(3)) WHERE id=? AND status='preview'",
      [user.sub, id],
    );
    await scheduleImport(c, scope, id, user.sub);
    await audit(c, user, 'report.commit', id);
    return { id };
  });
}
async function exception(c: PoolConnection, scope: Scope, rowId: string | null, factId: string | null, code: string) {
  const exists = await select(
    c,
    "SELECT id FROM zh_exceptions WHERE source_row_id<=>? AND fact_id<=>? AND reason_code=? AND status='open'",
    [rowId, factId, code],
  );
  if (!exists.length)
    await insert(
      c,
      'INSERT INTO zh_exceptions(account_id,project_id,source_row_id,fact_id,reason_code) VALUES(?,?,?,?,?)',
      [scope.accountId, scope.projectId, rowId, factId, code],
    );
}
export async function attribute(c: PoolConnection, scope: Scope, fact: RecordRow) {
  await assertNewRoute(c, scope, String(fact.business_day));
  const [revision] = await select(c, 'SELECT * FROM zh_metric_revisions WHERE id=?', [fact.current_revision_id]);
  if (!revision) return;
  const source = json<FactSnapshot>(revision.snapshot_json);
  const [word] = await select(c, 'SELECT * FROM zh_keywords WHERE id=?', [fact.keyword_id]);
  const [binding] = await select(
    c,
    "SELECT *,DATE_FORMAT(activated_on,'%Y-%m-%d') AS activated_day FROM zh_keyword_bindings WHERE keyword_id=? AND used_at IS NOT NULL AND released_at IS NULL",
    [word.id],
  );
  const date = String(fact.business_day);
  let code: string | null = null;
  const snapshot: AttributionSnapshot = {
    date,
    keyword: String(word.keyword),
    orders: source.orders,
    search: source.search,
    revenue: source.revenue,
    binding: binding
      ? {
          id: String(binding.id),
          leader_id: binding.leader_id === null ? null : String(binding.leader_id),
          executor_id: String(binding.executor_id),
          path_type: binding.path_type,
          version: binding.version,
          verification_status: binding.verification_status,
          relation: json(binding.relation_snapshot),
        }
      : null,
    obligations: [],
  };
  if (word.legacy_mode === 'shared_unresolved') code = 'LEGACY_SHARED';
  else if (!binding) code = 'BINDING_MISSING';
  else if (!binding.activated_day || String(binding.activated_day) > date) code = 'PERIOD_AMBIGUOUS';
  else if (source.riskAssessment) code = 'RISK_REVIEW_REQUIRED';
  else if (source.orders === null) code = 'REPORT_INCOMPLETE';
  else {
    await select(c, 'SELECT id FROM tasks WHERE id=? FOR SHARE', [word.task_id]);
    try {
      snapshot.obligations = await quote(c, scope, String(word.task_id), binding, date, source.orders);
    } catch (e) {
      if (e instanceof Error && ['PRICE_MISSING', 'PRICE_OVERLAP'].includes(e.message)) code = e.message;
      else throw e;
    }
  }
  const state = code
    ? code === 'REPORT_INCOMPLETE' || code.startsWith('PRICE_')
      ? 'matched'
      : 'unmatched'
    : 'matched';
  const hash = digest({ revision: String(revision.id), snapshot, code });
  const id = await insert(
    c,
    'INSERT INTO zh_attribution_results(fact_id,revision_id,binding_id,input_hash,status,reason_code,snapshot_json) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',
    [fact.id, revision.id, binding?.id ?? null, hash, state, code, JSON.stringify(snapshot)],
  );
  await c.query('UPDATE zh_metric_facts SET current_result_id=? WHERE id=?', [id, fact.id]);
  if (source.riskAssessment) {
    await exception(
      c,
      scope,
      source.sources.riskAssessment?.rowId ?? String(revision.source_row_id),
      String(fact.id),
      'RISK_REVIEW_REQUIRED',
    );
  } else if (source.riskAssessment === null) {
    await c.query(
      "UPDATE zh_exceptions SET status='resolved',resolution='已接受的订单来源风险判定为空',resolved_at=NOW(3) WHERE fact_id=? AND reason_code='RISK_REVIEW_REQUIRED' AND status='open'",
      [fact.id],
    );
  }
  await refreshAdjustments(c, scope, fact, id, snapshot);
  return { id, snapshot, code, binding, source };
}
export async function processBatch(user: AuthUser, scope: Scope, id: string, limit = 200) {
  if (user.role !== 'admin') fail('仅管理员可处理报告', 403);
  await authorize(user, scope);
  const ids = await withTransaction(async (c) => {
    await scopeLock(c, scope, user);
    const [batch] = await select(
      c,
      "SELECT id FROM zh_import_batches WHERE id=? AND account_id=? AND project_id=? AND status IN ('committed','processed')",
      [id, scope.accountId, scope.projectId],
    );
    if (!batch) fail('批次尚未确认', 409);
    return select(
      c,
      "SELECT id FROM zh_import_rows WHERE batch_id=? AND processing_status='pending' ORDER BY id LIMIT ?",
      [id, limit],
    );
  });
  for (const selected of ids)
    await withTransaction(async (c) => {
      await scopeLock(c, scope, user);
      const [row] = await select(
        c,
        'SELECT r.*,b.report_kind FROM zh_import_rows r JOIN zh_import_batches b ON b.id=r.batch_id WHERE r.id=? FOR UPDATE',
        [selected.id],
      );
      if (row.processing_status !== 'pending') return;
      const raw = json<SourceRow>(row.normalized_json),
        kind = row.report_kind as ReportKind;
      await assertNewRoute(c, scope, raw.date);
      const mappings = await select(
        c,
        `SELECT COALESCE(canonical_id,id) stable_id,project_id FROM zh_channel_mappings
      WHERE account_id=? AND channel_name=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)`,
        [scope.accountId, raw.channel, raw.date, raw.date],
      );
      let code =
        mappings.length === 0
          ? 'CHANNEL_UNMAPPED'
          : mappings.length > 1
            ? 'CHANNEL_AMBIGUOUS'
            : String(mappings[0].project_id) !== scope.projectId
              ? 'PROJECT_MISMATCH'
              : null;
      const words = code
        ? []
        : await select(
            c,
            'SELECT id FROM zh_keywords WHERE account_id=? AND project_id=? AND channel_mapping_id=? AND keyword=?',
            [scope.accountId, scope.projectId, mappings[0].stable_id, raw.keyword],
          );
      if (!code && words.length !== 1) code = 'KEYWORD_UNKNOWN';
      if (code) {
        await exception(c, scope, String(row.id), null, code);
        await c.query("UPDATE zh_import_rows SET processing_status='exception',error_text=? WHERE id=?", [
          code,
          row.id,
        ]);
        return;
      }
      const factId = await insert(
        c,
        'INSERT INTO zh_metric_facts(account_id,project_id,channel_mapping_id,keyword_id,business_date) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',
        [scope.accountId, scope.projectId, mappings[0].stable_id, words[0].id, raw.date],
      );
      const [fact] = await select(
        c,
        "SELECT *,DATE_FORMAT(business_date,'%Y-%m-%d') business_day FROM zh_metric_facts WHERE id=? FOR UPDATE",
        [factId],
      );
      const [current] = fact.current_revision_id
        ? await select(c, 'SELECT snapshot_json FROM zh_metric_revisions WHERE id=?', [fact.current_revision_id])
        : [];
      const before = current ? json<FactSnapshot>(current.snapshot_json) : empty();
      const { next, changed, conflict } = mergeSource(before, raw, kind, String(row.id));
      if (!changed && !conflict) {
        await c.query("UPDATE zh_import_rows SET processing_status='duplicate',fact_id=? WHERE id=?", [factId, row.id]);
        return;
      }
      const revisionId = await insert(
        c,
        'INSERT INTO zh_metric_revisions(fact_id,source_row_id,parent_revision_id,snapshot_json,status,accepted_by) VALUES(?,?,?,?,?,?)',
        [
          factId,
          row.id,
          fact.current_revision_id,
          JSON.stringify(next),
          conflict ? 'pending' : 'accepted',
          conflict ? null : user.sub,
        ],
      );
      if (conflict) await exception(c, scope, String(row.id), factId, 'SOURCE_REVISION_PENDING');
      else {
        await c.query('UPDATE zh_metric_facts SET current_revision_id=?,version=version+1 WHERE id=?', [
          revisionId,
          factId,
        ]);
        fact.current_revision_id = revisionId;
        await attribute(c, scope, fact);
      }
      await c.query("UPDATE zh_import_rows SET processing_status='processed',fact_id=? WHERE id=?", [factId, row.id]);
    });
  const remaining = await withTransaction(async (c) => {
    const [r] = await select(
      c,
      "SELECT COUNT(*) total FROM zh_import_rows WHERE batch_id=? AND processing_status='pending'",
      [id],
    );
    if (!Number(r.total)) await c.query("UPDATE zh_import_batches SET status='processed' WHERE id=?", [id]);
    return Number(r.total);
  });
  return { id, processed: ids.length, remaining };
}
export async function acceptRevision(
  user: AuthUser,
  scope: Scope,
  id: string,
  key: string,
  expected: string | null,
  reason: string,
  accept = true,
) {
  if (user.role !== 'admin') fail('仅管理员可确认来源修订', 403);
  return mutate(user, scope, 'revision.resolve', key, { id, expected, reason, accept }, async (c) => {
    const [ref] = await select(
      c,
      'SELECT f.id FROM zh_metric_revisions r JOIN zh_metric_facts f ON f.id=r.fact_id WHERE r.id=? AND f.account_id=? AND f.project_id=?',
      [id, scope.accountId, scope.projectId],
    );
    if (!ref) fail('来源版本不存在', 404);
    const [fact] = await select(
      c,
      "SELECT *,DATE_FORMAT(business_date,'%Y-%m-%d') business_day FROM zh_metric_facts WHERE id=? FOR UPDATE",
      [ref.id],
    );
    const [revision] = await select(c, 'SELECT * FROM zh_metric_revisions WHERE id=? FOR UPDATE', [id]);
    await assertNewRoute(c, scope, String(fact.business_day));
    if (
      revision.status !== 'pending' ||
      String(fact.current_revision_id ?? '') !== String(expected ?? '') ||
      (accept && String(revision.parent_revision_id ?? '') !== String(expected ?? ''))
    )
      fail('当前事实已变化，请重新核对修订；过期候选可驳回', 409);
    await c.query('UPDATE zh_metric_revisions SET status=?,accepted_by=?,reason=? WHERE id=?', [
      accept ? 'accepted' : 'rejected',
      user.sub,
      reason,
      id,
    ]);
    if (accept) {
      await c.query('UPDATE zh_metric_facts SET current_revision_id=?,version=version+1 WHERE id=?', [id, fact.id]);
      fact.current_revision_id = id;
      await attribute(c, scope, fact);
    }
    await c.query(
      "UPDATE zh_exceptions SET status='resolved',resolution=?,resolved_at=NOW(3) WHERE source_row_id=? AND reason_code='SOURCE_REVISION_PENDING'",
      [reason, revision.source_row_id],
    );
    await audit(c, user, 'revision.resolve', id, { reason, accept });
    return { id };
  });
}
export async function rebaseRevision(
  user: AuthUser,
  scope: Scope,
  id: string,
  key: string,
  expected: string,
  reason: string,
) {
  if (user.role !== 'admin') fail('仅管理员可重建修订候选', 403);
  return mutate(user, scope, 'revision.rebase', key, { id, expected, reason }, async (c) => {
    const [ref] = await select(
      c,
      'SELECT f.id FROM zh_metric_revisions r JOIN zh_metric_facts f ON f.id=r.fact_id WHERE r.id=? AND f.account_id=? AND f.project_id=?',
      [id, scope.accountId, scope.projectId],
    );
    if (!ref) fail('修订候选不存在', 404);
    const [fact] = await select(
      c,
      "SELECT *,DATE_FORMAT(business_date,'%Y-%m-%d') business_day FROM zh_metric_facts WHERE id=? FOR UPDATE",
      [ref.id],
    );
    await assertNewRoute(c, scope, String(fact.business_day));
    const [candidate] = await select(c, 'SELECT * FROM zh_metric_revisions WHERE id=? FOR UPDATE', [id]);
    if (candidate.status !== 'pending' || String(fact.current_revision_id) !== expected)
      fail('当前事实已变化，请重新查看', 409);
    const [current] = await select(c, 'SELECT snapshot_json FROM zh_metric_revisions WHERE id=?', [expected]);
    const [row] = await select(
      c,
      'SELECT r.normalized_json,b.report_kind FROM zh_import_rows r JOIN zh_import_batches b ON b.id=r.batch_id WHERE r.id=?',
      [candidate.source_row_id],
    );
    const source = json<SourceRow>(row.normalized_json),
      before = json<FactSnapshot>(current.snapshot_json),
      kind = row.report_kind as ReportKind;
    const { next } = mergeSource(before, source, kind, String(candidate.source_row_id));
    const revisionId = await insert(
      c,
      "INSERT INTO zh_metric_revisions(fact_id,source_row_id,parent_revision_id,snapshot_json,status,reason,candidate_generation,supersedes_candidate_id) VALUES(?,?,?,?,'pending',?,?,?)",
      [
        fact.id,
        candidate.source_row_id,
        expected,
        JSON.stringify(next),
        reason,
        Number(candidate.candidate_generation) + 1,
        id,
      ],
    );
    await c.query("UPDATE zh_metric_revisions SET status='superseded' WHERE id=?", [id]);
    await audit(c, user, 'revision.rebase', revisionId, { supersedes: id, reason });
    return { id: revisionId };
  });
}
export async function listExceptions(user: AuthUser, scope: Scope, page: number, pageSize: number) {
  if (user.role !== 'admin') fail('来源异常仅管理员可处理', 403);
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const list = await select(
      c,
      `SELECT CAST(e.id AS CHAR) id,e.reason_code,e.status,e.resolution,CAST(e.source_row_id AS CHAR) source_row_id,
      CAST(e.fact_id AS CHAR) fact_id,CAST(f.current_revision_id AS CHAR) expected_revision_id,CAST(v.id AS CHAR) revision_id,v.snapshot_json,r.normalized_json
      FROM zh_exceptions e LEFT JOIN zh_metric_facts f ON f.id=e.fact_id LEFT JOIN zh_import_rows r ON r.id=e.source_row_id
      LEFT JOIN zh_metric_revisions v ON v.source_row_id=e.source_row_id AND v.status='pending'
      WHERE e.account_id=? AND e.project_id=? ORDER BY e.id DESC LIMIT ? OFFSET ?`,
      [scope.accountId, scope.projectId, pageSize, (page - 1) * pageSize],
    );
    const [total] = await select(c, 'SELECT COUNT(*) total FROM zh_exceptions WHERE account_id=? AND project_id=?', [
      scope.accountId,
      scope.projectId,
    ]);
    return { list, total: Number(total.total), page, pageSize };
  });
}
export async function retryException(user: AuthUser, scope: Scope, id: string, key: string, reason: string) {
  if (user.role !== 'admin') fail('仅管理员可重试异常', 403);
  return mutate(user, scope, 'exception.retry', key, { id, reason }, async (c) => {
    const [e] = await select(
      c,
      "SELECT * FROM zh_exceptions WHERE id=? AND account_id=? AND project_id=? AND status='open' FOR UPDATE",
      [id, scope.accountId, scope.projectId],
    );
    if (!e || e.reason_code === 'SOURCE_REVISION_PENDING') fail('请通过来源修订处理此异常');
    if (e.reason_code === 'RISK_REVIEW_REQUIRED') fail('风险判定含义待核实；需提供上游更正报告，不能通过重试解除');
    await c.query(
      "UPDATE zh_import_rows SET processing_status='pending',error_text=NULL WHERE id=? AND processing_status='exception'",
      [e.source_row_id],
    );
    await c.query("UPDATE zh_exceptions SET status='resolved',resolution=?,resolved_at=NOW(3) WHERE id=?", [
      reason,
      id,
    ]);
    const [row] = await select(c, 'SELECT batch_id FROM zh_import_rows WHERE id=?', [e.source_row_id]);
    await scheduleImport(c, scope, String(row.batch_id), user.sub);
    await audit(c, user, 'exception.retry', id, { reason });
    return { batchId: String(row.batch_id) };
  });
}
export async function trace(user: AuthUser, scope: Scope, id: string) {
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const [fact] = await select(
      c,
      `SELECT f.*,k.keyword,b.executor_id,b.leader_id FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id
      LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id WHERE f.id=? AND f.account_id=? AND f.project_id=?`,
      [id, scope.accountId, scope.projectId],
    );
    if (
      !fact ||
      (user.role !== 'admin' && String(fact.executor_id) !== user.sub && String(fact.leader_id) !== user.sub)
    )
      fail('无权查看归因来源', 403);
    const results = await select(
      c,
      'SELECT id,revision_id,status,reason_code,snapshot_json,created_at FROM zh_attribution_results WHERE fact_id=? ORDER BY id DESC LIMIT 100',
      [id],
    );
    const revisions =
      user.role === 'admin'
        ? await select(
            c,
            `SELECT v.*,r.raw_json,r.normalized_json,r.line_number,b.file_name,b.file_sha256,b.template_version FROM zh_metric_revisions v JOIN zh_import_rows r ON r.id=v.source_row_id JOIN zh_import_batches b ON b.id=r.batch_id WHERE v.fact_id=? ORDER BY v.id DESC LIMIT 100`,
            [id],
          )
        : [];
    return {
      id,
      keyword: fact.keyword,
      results: results.map(({ snapshot_json, ...r }) => ({
        ...r,
        ...projectSnapshot(user, json<AttributionSnapshot>(snapshot_json)),
      })),
      revisions,
    };
  });
}
export async function recompute(user: AuthUser, scope: Scope, id: string) {
  if (user.role !== 'admin') fail('仅管理员可重算', 403);
  await authorize(user, scope);
  return withTransaction(async (c) => {
    await scopeLock(c, scope, user);
    const [fact] = await select(
      c,
      "SELECT *,DATE_FORMAT(business_date,'%Y-%m-%d') business_day FROM zh_metric_facts WHERE id=? AND account_id=? AND project_id=? FOR UPDATE",
      [id, scope.accountId, scope.projectId],
    );
    if (!fact) fail('事实不存在', 404);
    await attribute(c, scope, fact);
    await audit(c, user, 'attribution.recompute', id);
    return { id };
  });
}
export function projectSnapshot(user: AuthUser, snapshot: AttributionSnapshot) {
  const obligations = snapshot.obligations.filter(
    (o) => user.role === 'admin' || o.payeeId === user.sub || (o.payerKind === 'user' && o.payerId === user.sub),
  );
  const result: Record<string, unknown> = {
    date: snapshot.date,
    keyword: snapshot.keyword,
    orders: snapshot.orders,
    search: snapshot.search,
    obligations,
  };
  if (user.role === 'admin') {
    result.revenue = snapshot.revenue;
    result.agencyMargin =
      snapshot.revenue === null || !snapshot.obligations.length
        ? null
        : moneyText(
            money(snapshot.revenue) -
              obligations.filter((x) => x.payerKind === 'agency').reduce((n, o) => n + money(o.amount), 0n),
          );
  }
  if (user.role === 'leader')
    result.teamMargin = snapshot.obligations.length
      ? moneyText(
          obligations.filter((o) => o.payeeId === user.sub).reduce((n, o) => n + money(o.amount), 0n) -
            obligations
              .filter((o) => o.payerKind === 'user' && o.payerId === user.sub)
              .reduce((n, o) => n + money(o.amount), 0n),
        )
      : null;
  return result;
}
export async function listAttributions(user: AuthUser, scope: Scope, page: number, pageSize: number) {
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const where = `f.account_id=? AND f.project_id=? AND (?='admin' OR b.executor_id=? OR b.leader_id=?)`;
    const args = [scope.accountId, scope.projectId, user.role, user.sub, user.sub];
    const joins = `FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id`;
    const [count] = await select(c, `SELECT COUNT(*) total ${joins} WHERE ${where}`, args);
    const records = await select(
      c,
      `SELECT CAST(f.id AS CHAR) id,CAST(f.current_revision_id AS CHAR) revision_id,k.keyword,b.verification_status,r.status,r.reason_code,r.snapshot_json
      ${joins} LEFT JOIN zh_attribution_results r ON r.id=f.current_result_id
      WHERE ${where} ORDER BY f.id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    );
    return {
      list: records.map(({ snapshot_json, ...r }) => ({
        ...r,
        ...(snapshot_json ? projectSnapshot(user, json<AttributionSnapshot>(snapshot_json)) : {}),
      })),
      total: Number(count.total),
      page,
      pageSize,
    };
  });
}
