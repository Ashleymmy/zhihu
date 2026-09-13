import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../../../types';
import { withTransaction } from '../../../db';
import { day, digest, fail, money, moneyText, type Scope } from './domain';
import { audit, authorize, bindingLock, insert, json, mutate, ownBinding, select, type RecordRow } from './store';
import type { AttributionSnapshot } from './facts';
import type { Obligation } from './pricing';
import { assertNewRoute } from './routing';

export async function submitEvidence(
  user: AuthUser,
  scope: Scope,
  key: string,
  input: { bindingId: string; url: string; description: string },
) {
  const url = new URL(input.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('作品地址必须是公开 HTTP 链接');
  return mutate(user, scope, 'evidence.submit', key, input, async (c) => {
    const { binding } = await bindingLock(c, scope, input.bindingId);
    ownBinding(user, binding);
    if (!binding.used_at || binding.released_at) fail('请先声明实际使用关键词');
    const id = await insert(
      c,
      'INSERT INTO zh_evidence(binding_id,work_url,description,submitted_by) VALUES(?,?,?,?)',
      [binding.id, input.url, input.description, user.sub],
    );
    await audit(c, user, 'evidence.submit', id, { bindingId: input.bindingId });
    return { id };
  });
}
export async function reviewEvidence(
  user: AuthUser,
  scope: Scope,
  id: string,
  key: string,
  accept: boolean,
  reason: string,
) {
  return mutate(user, scope, 'evidence.review', key, { id, accept, reason }, async (c) => {
    const [ref] = await select(c, 'SELECT binding_id FROM zh_evidence WHERE id=?', [id]);
    if (!ref) fail('作品不存在', 404);
    const { binding } = await bindingLock(c, scope, String(ref.binding_id));
    if (
      user.role !== 'admin' &&
      (user.role !== 'leader' || String(binding.leader_id) !== user.sub || String(binding.executor_id) === user.sub)
    )
      fail('仅管理员或非本人作品的所属团长可核验', 403);
    const [e] = await select(c, 'SELECT * FROM zh_evidence WHERE id=? FOR UPDATE', [id]);
    if (e.status !== 'pending') fail('作品已核验', 409);
    await c.query('UPDATE zh_evidence SET status=?,reviewed_by=?,reason=?,reviewed_at=NOW(3) WHERE id=?', [
      accept ? 'passed' : 'rejected',
      user.sub,
      reason,
      id,
    ]);
    if (accept && binding.verification_status !== 'disputed')
      await c.query("UPDATE zh_keyword_bindings SET verification_status='passed',version=version+1 WHERE id=?", [
        binding.id,
      ]);
    await audit(c, user, 'evidence.review', id, { accept, reason });
    return { id };
  });
}
export async function disputeBinding(
  user: AuthUser,
  scope: Scope,
  id: string,
  key: string,
  resolve: boolean,
  reason: string,
) {
  return mutate(user, scope, 'evidence.dispute', key, { id, resolve, reason }, async (c) => {
    const { binding } = await bindingLock(c, scope, id);
    ownBinding(user, binding);
    if (resolve && user.role !== 'admin') fail('争议须由管理员解除', 403);
    const passed = await select(c, "SELECT id FROM zh_evidence WHERE binding_id=? AND status='passed' LIMIT 1", [id]);
    await c.query('UPDATE zh_keyword_bindings SET verification_status=?,version=version+1 WHERE id=?', [
      resolve ? (passed.length ? 'passed' : 'pending') : 'disputed',
      id,
    ]);
    await audit(c, user, resolve ? 'evidence.resolve-dispute' : 'evidence.dispute', id, { reason });
    return { id };
  });
}
export async function listEvidence(user: AuthUser, scope: Scope, page: number, pageSize: number) {
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const args = [scope.accountId, scope.projectId, user.role, user.sub, user.sub];
    const from = `FROM zh_evidence e JOIN zh_keyword_bindings b ON b.id=e.binding_id JOIN zh_keywords k ON k.id=b.keyword_id WHERE k.account_id=? AND k.project_id=? AND (?='admin' OR b.leader_id=? OR b.executor_id=?)`;
    const [total] = await select(c, `SELECT COUNT(*) total ${from}`, args);
    const list = await select(
      c,
      `SELECT CAST(e.id AS CHAR) id,CAST(e.binding_id AS CHAR) binding_id,k.keyword,e.work_url,e.description,e.status,e.reason,b.verification_status,CAST(b.executor_id AS CHAR) executor_id ${from} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    );
    return { list, total: Number(total.total), page, pageSize };
  });
}
function ownsPayer(user: AuthUser, o: { payerKind: string; payerId: string }) {
  return o.payerKind === 'agency' ? user.role === 'admin' : user.role === 'leader' && o.payerId === user.sub;
}
async function lastConfirmed(c: PoolConnection, factId: unknown, relation: string) {
  return (
    await select(
      c,
      "SELECT id,CAST(target_amount AS CHAR) target FROM zh_statement_entries WHERE fact_id=? AND relation_type=? AND status='confirmed' ORDER BY id DESC LIMIT 1",
      [factId, relation],
    )
  )[0];
}
async function buildEntry(
  c: PoolConnection,
  scope: Scope,
  fact: RecordRow,
  resultId: string,
  snapshot: AttributionSnapshot,
  o: Obligation,
  onlyAdjustment: boolean,
) {
  const previous = await lastConfirmed(c, fact.id, o.relation);
  if (onlyAdjustment && !previous) return;
  const delta = money(o.amount) - (previous ? money(String(previous.target)) : 0n);
  if (previous && delta === 0n) return;
  const ownSnapshot = { date: snapshot.date, keyword: snapshot.keyword, orders: snapshot.orders, obligation: o };
  const hash = digest({ resultId, previous: previous ? String(previous.id) : null, ownSnapshot });
  const id = await insert(
    c,
    `INSERT INTO zh_statement_entries(account_id,project_id,fact_id,result_id,revision_id,binding_id,relation_type,payer_kind,payer_id,payee_id,entry_kind,amount,target_amount,previous_entry_id,snapshot_json,input_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
    [
      scope.accountId,
      scope.projectId,
      fact.id,
      resultId,
      fact.current_revision_id,
      snapshot.binding?.id,
      o.relation,
      o.payerKind,
      o.payerId,
      o.payeeId,
      previous ? 'adjustment' : 'initial',
      moneyText(delta),
      o.amount,
      previous?.id ?? null,
      JSON.stringify(ownSnapshot),
      hash,
    ],
  );
  return { id };
}
// 调整只生成草稿，仍须分别由付款主体确认。
export async function refreshAdjustments(
  c: PoolConnection,
  scope: Scope,
  fact: RecordRow,
  resultId: string,
  snapshot: AttributionSnapshot,
) {
  await c.query(
    "UPDATE zh_statement_entries SET status='superseded' WHERE fact_id=? AND status='draft' AND result_id<>?",
    [fact.id, resultId],
  );
  for (const o of snapshot.obligations) await buildEntry(c, scope, fact, resultId, snapshot, o, true);
}
export async function previewStatement(user: AuthUser, scope: Scope, key: string, factId: string) {
  if (user.role === 'creator') fail('仅付款主体可生成应付草稿', 403);
  return mutate(user, scope, 'statement.preview', key, { factId }, async (c) => {
    const [fact] = await select(
      c,
      'SELECT * FROM zh_metric_facts WHERE id=? AND account_id=? AND project_id=? FOR UPDATE',
      [factId, scope.accountId, scope.projectId],
    );
    if (!fact) fail('事实不存在', 404);
    const [result] = await select(c, 'SELECT * FROM zh_attribution_results WHERE id=?', [fact.current_result_id]);
    if (!result || result.reason_code) fail('来源未完成归因或缺价', 409);
    const snapshot = json<AttributionSnapshot>(result.snapshot_json);
    const entries = [];
    await assertNewRoute(c, scope, snapshot.date);
    for (const o of snapshot.obligations.filter((o) => ownsPayer(user, o))) {
      const entry = await buildEntry(c, scope, fact, String(result.id), snapshot, o, false);
      if (entry) entries.push(entry);
    }
    if (!snapshot.obligations.some((o) => ownsPayer(user, o))) fail('无权生成其他付款主体的应付', 403);
    await audit(c, user, 'statement.preview', factId);
    return { entries };
  });
}
export async function confirmStatement(user: AuthUser, scope: Scope, id: string, key: string, expectedHash: string) {
  return mutate(user, scope, 'statement.confirm', key, { id, expectedHash }, (c) =>
    confirmEntry(c, user, scope, id, expectedHash),
  );
}
async function confirmEntry(c: PoolConnection, user: AuthUser, scope: Scope, id: string, expectedHash: string) {
  const [ref] = await select(
    c,
    'SELECT fact_id FROM zh_statement_entries WHERE id=? AND account_id=? AND project_id=?',
    [id, scope.accountId, scope.projectId],
  );
  if (!ref) fail('对账记录不存在', 404);
  // 与来源修订锁定同一事实；锁顺序固定为事实、绑定、对账记录。
  const [fact] = await select(c, 'SELECT * FROM zh_metric_facts WHERE id=? FOR UPDATE', [ref.fact_id]);
  const [entry] = await select(
    c,
    'SELECT *,CAST(amount AS CHAR) amount_text,CAST(target_amount AS CHAR) target_text FROM zh_statement_entries WHERE id=? FOR UPDATE',
    [id],
  );
  if (!ownsPayer(user, { payerKind: String(entry.payer_kind), payerId: String(entry.payer_id) }))
    fail('只有付款主体可确认自己的应付', 403);
  if (entry.input_hash !== expectedHash) fail('草稿摘要不一致', 409);
  if (entry.status === 'confirmed') return { id };
  await assertNewRoute(c, scope, json<{ date: string }>(entry.snapshot_json).date, true);
  if (
    entry.status !== 'draft' ||
    String(fact.current_result_id) !== String(entry.result_id) ||
    String(fact.current_revision_id) !== String(entry.revision_id)
  )
    fail('来源已修订，请刷新草稿', 409);
  const previous = await lastConfirmed(c, fact.id, String(entry.relation_type));
  if (String(previous?.id ?? '') !== String(entry.previous_entry_id ?? '')) fail('应付基数已变化，请刷新草稿', 409);
  const [binding] = await select(c, 'SELECT * FROM zh_keyword_bindings WHERE id=? FOR SHARE', [entry.binding_id]);
  if (binding.verification_status !== 'passed') fail('首次作品尚未通过核验或绑定存在争议', 409);
  const pending = await select(c, "SELECT id FROM zh_metric_revisions WHERE fact_id=? AND status='pending' LIMIT 1", [
    fact.id,
  ]);
  if (pending.length) fail('来源修订尚待核实', 409);
  if (entry.relation_type === 'agency_leader' && binding.path_type === 'team_creator') {
    const [result] = await select(c, 'SELECT snapshot_json FROM zh_attribution_results WHERE id=?', [entry.result_id]);
    const lower = json<AttributionSnapshot>(result.snapshot_json).obligations.find(
      (o) => o.relation === 'leader_creator',
    );
    const confirmed = await lastConfirmed(c, fact.id, 'leader_creator');
    if (!lower || !confirmed || String(confirmed.target) !== lower.amount)
      fail('须先由团长确认对达人的应付或调整', 409);
  }
  await c.query("UPDATE zh_statement_entries SET status='confirmed',confirmed_by=?,confirmed_at=NOW(3) WHERE id=?", [
    user.sub,
    id,
  ]);
  await audit(c, user, 'statement.confirm', id, { factId: String(fact.id), amount: entry.amount_text });
  return { id };
}
export async function previewPeriod(user: AuthUser, scope: Scope, key: string, input: { from: string; to: string }) {
  if (user.role === 'creator') fail('仅付款主体可生成草稿', 403);
  day(input.from);
  day(input.to);
  if (input.to < input.from) fail('日期范围不合法');
  return mutate(user, scope, 'statement.preview-period', key, input, async (c) => {
    const facts = await select(
      c,
      `SELECT f.* FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id
      WHERE f.account_id=? AND f.project_id=? AND f.business_date BETWEEN ? AND ? AND (?='admin' OR b.leader_id=?) ORDER BY f.id LIMIT 501 FOR UPDATE`,
      [scope.accountId, scope.projectId, input.from, input.to, user.role, user.sub],
    );
    if (facts.length > 500) fail('单次最多预览 500 条事实，请缩小日期范围');
    const entries = [];
    for (const fact of facts) {
      const [r] = await select(c, 'SELECT * FROM zh_attribution_results WHERE id=?', [fact.current_result_id]);
      if (!r || r.reason_code) fail(`归因 ${fact.id} 未完成或缺价，不能生成本期草稿`, 409);
      const snapshot = json<AttributionSnapshot>(r.snapshot_json);
      await assertNewRoute(c, scope, snapshot.date);
      for (const o of snapshot.obligations.filter((o) => ownsPayer(user, o))) {
        const entry = await buildEntry(c, scope, fact, String(r.id), snapshot, o, false);
        if (entry) entries.push(entry);
      }
    }
    await audit(c, user, 'statement.preview-period', scope.projectId, { ...input, count: entries.length });
    return { entries };
  });
}
export async function confirmBatch(
  user: AuthUser,
  scope: Scope,
  key: string,
  entries: { id: string; expectedHash: string }[],
) {
  if (!entries.length || entries.length > 100 || new Set(entries.map((e) => e.id)).size !== entries.length)
    fail('请选择 1 至 100 条不重复的应付草稿');
  return mutate(user, scope, 'statement.confirm-batch', key, entries, async (c) => {
    const refs = await select(
      c,
      'SELECT fact_id FROM zh_statement_entries WHERE id IN (?) AND account_id=? AND project_id=?',
      [entries.map((e) => e.id), scope.accountId, scope.projectId],
    );
    if (refs.length !== entries.length) fail('包含无权操作的对账记录', 403);
    await select(c, 'SELECT id FROM zh_metric_facts WHERE id IN (?) ORDER BY id FOR UPDATE', [
      refs.map((r) => r.fact_id),
    ]);
    for (const entry of entries) await confirmEntry(c, user, scope, entry.id, entry.expectedHash);
    return { confirmed: entries.length };
  });
}
export async function listStatements(user: AuthUser, scope: Scope, page: number, pageSize: number) {
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const args = [scope.accountId, scope.projectId, user.role, user.sub, user.sub];
    const where = "account_id=? AND project_id=? AND (?='admin' OR payee_id=? OR (payer_kind='user' AND payer_id=?))";
    const [total] = await select(c, `SELECT COUNT(*) total FROM zh_statement_entries WHERE ${where}`, args);
    const list = await select(
      c,
      `SELECT CAST(id AS CHAR) id,CAST(fact_id AS CHAR) fact_id,CAST(revision_id AS CHAR) revision_id,relation_type,payer_kind,CAST(payer_id AS CHAR) payer_id,CAST(payee_id AS CHAR) payee_id,entry_kind,CAST(amount AS CHAR) amount,CAST(target_amount AS CHAR) target_amount,CAST(previous_entry_id AS CHAR) previous_entry_id,snapshot_json,input_hash,status,confirmed_at FROM zh_statement_entries WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    );
    return { list, total: Number(total.total), page, pageSize };
  });
}
