import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection } from 'mysql2/promise';
import request from 'supertest';
import * as XLSX from 'xlsx';
import type { Express } from 'express';
import type { AuthUser } from '../../src/types';
import { runOpcMigrations } from '../../scripts/opcMigrations';
vi.mock('../../src/modules/zhihu/queue', async (original) => ({
  ...(await original<typeof import('../../src/modules/zhihu/queue')>()),
  enqueue: vi.fn(async () => ({ id: 'test' })),
}));
let container: StartedMySqlContainer, c: Connection, app: Express, pool: typeof import('../../src/db').db;
let resource: typeof import('../../src/modules/zhihu/attribution/resources'),
  statements: typeof import('../../src/modules/zhihu/attribution/statements'),
  workbench: typeof import('../../src/modules/zhihu/attribution/workbench'),
  finance: typeof import('../../src/core/finance'),
  facts: typeof import('../../src/modules/zhihu/attribution/facts');
const key = () => crypto.randomUUID();
const u = (
  id: string,
  role: AuthUser['role'],
  parentId: string | null = null,
  adminDuty: AuthUser['adminDuty'] = 'all',
): AuthUser => ({ sub: id, username: 'u' + id, displayName: '测试' + id, role, parentId, adminDuty, jti: key() });
const admin = u('1', 'admin'),
  leader = u('2', 'leader'),
  a = u('3', 'creator', '2'),
  b = u('4', 'creator', '2'),
  solo = u('5', 'creator'),
  other = u('6', 'leader'),
  ops = u('7', 'admin', null, 'operations'),
  fin = u('8', 'admin', null, 'finance');
const developer = u('9', 'developer');
const users = [admin, leader, a, b, solo, other, ops, fin, developer],
  tokens: Record<string, string> = {};
let scope = { projectId: '1', accountId: '' },
  day = '',
  mapping = '',
  bindingA = '';
const q = async (sql: string, params: unknown[] = []) => (await c.query<mysql.RowDataPacket[]>(sql, params))[0];
const common = () => ({ ...scope, moduleId: 'zhihu' });
const path = (p: string) => '/api/v1/modules/zhihu' + p;
const get = (actor: AuthUser, p: string, query: object = {}) =>
  request(app)
    .get(p)
    .set('X-Client-Id', 'workbench-client-' + actor.sub)
    .set('Authorization', 'Bearer ' + tokens[actor.sub])
    .query(query);
const post = (actor: AuthUser, p: string, body: object = {}) =>
  request(app)
    .post(p)
    .set('X-Client-Id', 'workbench-client-' + actor.sub)
    .set('Authorization', 'Bearer ' + tokens[actor.sub])
    .send(body);
function report(count = 30) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['日期', '渠道名称', '关键词', '搜索量', '订单', '收益'],
      ...[
        [0, count],
        [1, 20],
        [2, 10],
        [3, 5],
        [4, 0],
      ].map(([n, orders]) => [day, '联测渠道', '联测词' + n, 100, orders, orders * 20]),
    ]),
    '日报',
  );
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    originalname: '联测.xlsx',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
    size: buffer.length,
  };
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('workbench_test')
    .withUsername('test')
    .withUserPassword('isolated_test')
    .start();
  const target = {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getUserPassword(),
  };
  Object.assign(process.env, {
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
    OPC_MODULES: 'zhihu',
  });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  for (const actor of users)
    await c.query(
      'INSERT INTO users(id,username,password_hash,role,display_name,parent_id,admin_duty) VALUES(?,?,?,?,?,?,?)',
      [actor.sub, actor.username, 'unused', actor.role, actor.displayName, actor.parentId, actor.adminDuty],
    );
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,4),(1,5),(1,6)');
  scope.accountId = String((await q('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
  await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'ch1',1,'联测渠道')");
  await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'task1','联测任务',NOW())");
  resource = await import('../../src/modules/zhihu/attribution/resources');
  statements = await import('../../src/modules/zhihu/attribution/statements');
  workbench = await import('../../src/modules/zhihu/attribution/workbench');
  finance = await import('../../src/core/finance');
  facts = await import('../../src/modules/zhihu/attribution/facts');
  pool = (await import('../../src/db')).db;
  day = (await import('../../src/modules/zhihu/attribution/domain')).businessDay();
  mapping = (await resource.createMapping(admin, scope, key(), { channelId: '1', name: '联测渠道', from: day })).id;
  const pricing = await import('../../src/modules/zhihu/attribution/pricing');
  for (const [payer, payee, price] of [
    [admin, leader, '15'],
    [leader, a, '13'],
    [leader, b, '12'],
    [admin, solo, '14'],
  ] as const) {
    const v = await pricing.draftPrice(payer, scope, key(), {
      taskId: '1',
      payeeId: payee.sub,
      unitPrice: price,
      from: day,
      reason: '仅用于测试',
    });
    await pricing.publishPrice(payer, scope, v.id, key());
  }
  for (const [n, actor] of [a, b, solo, leader, a].entries()) {
    const word = await resource.createKeyword(admin, scope, key(), {
      keyword: '联测词' + n,
      taskId: '1',
      mappingId: mapping,
      landingUrl: 'https://www.zhihu.com/market/test',
      popularizeType: 1,
    });
    await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?", [
      'external' + n,
      word.planId,
    ]);
    await resource.synchronizeKeywords(scope);
    const bind = await resource.distribute(admin, scope, word.id, key(), actor.sub);
    if (actor === leader)
      await resource.changeBinding(leader, scope, bind.id, key(), { action: 'assign', executorId: leader.sub });
    await resource.changeBinding(actor, scope, bind.id, key(), { action: 'activate' });
    await statements.submitEvidence(actor, scope, key(), {
      bindingId: bind.id,
      url: 'https://example.com/work/' + n,
      description: '隔离测试作品',
    });
    if (n === 0) bindingA = bind.id;
  }
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    { zhihuManifest } = await import('../../src/modules/zhihu/manifest'),
    { createZhihuModule } = await import('../../src/modules/zhihu/module'),
    { createCoreApp } = await import('../../src/core/app');
  const runtime = new ModuleRuntime([zhihuManifest]);
  runtime.register(createZhihuModule());
  app = createCoreApp(runtime);
  const { signToken } = await import('../../src/auth/jwt');
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions');
  for (const actor of users) {
    const session = await issueRefreshSession(actor.sub, { type: 'web', id: 'workbench-client-' + actor.sub });
    tokens[actor.sub] = await signToken({ ...actor, id: actor.sub, adminDuty: 'all', sessionId: session.familyId });
  }
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

let previewId = '',
  previewHash = '',
  factId = '',
  lineId = '';
it('两步预览幂等、限制岗位且不提前建账或锁定日期', async () => {
  const upload = async (actor: AuthUser, k: string) =>
    request(app)
      .post(path('/workbench/import/preview'))
      .set('X-Client-Id', 'workbench-client-' + actor.sub)
      .set('Authorization', 'Bearer ' + tokens[actor.sub])
      .field('projectId', scope.projectId)
      .field('accountId', scope.accountId)
      .field('reportType', 'new_user')
      .field('requestKey', k)
      .attach('file', report().buffer, 'preview.xlsx');
  expect((await upload(ops, key())).status).toBe(403);
  expect((await upload(a, key())).status).toBe(403);
  const k = key(),
    first = await upload(fin, k);
  expect(first.status, first.text).toBe(200);
  const r = first.body.data;
  expect(r.rows).toHaveLength(5);
  expect(r.reportType).toBe('new_user');
  expect(r.status).toBe('preview');
  previewId = r.id;
  previewHash = r.previewHash;
  expect((await upload(fin, k)).body.data).toEqual(r);
  expect((await q('SELECT COUNT(*) n FROM zh_metric_facts'))[0].n).toBe(0);
  expect((await q('SELECT COUNT(*) n FROM zh_engine_routes'))[0].n).toBe(0);
  const commit = path('/workbench/import/' + previewId + '/commit'),
    k2 = key();
  expect((await post(fin, commit, { ...scope, requestKey: k2, previewHash: '0'.repeat(64) })).status).toBe(409);
  const accepted = await post(fin, commit, { ...scope, requestKey: k2, previewHash });
  expect(accepted.status, accepted.text).toBe(202);
  expect((await post(fin, commit, { ...scope, requestKey: k2, previewHash })).body.data).toEqual(accepted.body.data);
  expect((await q('SELECT COUNT(*) n FROM zh_processing_jobs'))[0].n).toBe(1);
  await facts.processBatch(fin, scope, previewId);
  factId = String(
    (await q("SELECT f.id FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id WHERE k.keyword='联测词0'"))[0]
      .id,
  );
});
it('全部阻塞时确认不启用、不写启用审计，并缓存零确认回执', async () => {
  const period = { from: day, to: day },
    v = await workbench.overview(fin, scope, period),
    k = key();
  const first = await workbench.confirmBills(fin, scope, period, k, v.reviewHash);
  expect(first).toMatchObject({ confirmed: 0, jobId: null, status: 'done' });
  expect((await q('SELECT mode FROM zh_engine_routes'))[0].mode).toBe('trial');
  expect(await workbench.confirmBills(fin, scope, period, k, v.reviewHash)).toEqual(first);
  await expect(workbench.confirmBills(fin, scope, period, k, '0'.repeat(64))).rejects.toThrow('同一幂等键');
  for (const e of (await statements.listEvidence(admin, scope, 1, 100)).list)
    await statements.reviewEvidence(ops, scope, String(e.id), key(), true, '测试核验');
});
it('金额异议归属于收益本人，公共确认不能绕过，允许多轮回复', async () => {
  const mine = await get(a, '/api/v1/core/earnings/mine', { ...scope, from: day, to: day });
  expect(mine.status, mine.text).toBe(200);
  lineId = mine.body.data.list.find((e: { taskName: string }) => e.taskName === '联测词0').id;
  const body = { ...scope, earningLineId: lineId, detail: '金额需要核对', requestKey: key() };
  expect((await post(b, path('/objections'), body)).status).toBe(403);
  const raised = await post(a, path('/objections'), body);
  expect(raised.status, raised.text).toBe(201);
  const id = raised.body.data.id;
  expect((await post(a, path('/objections'), body)).body.data).toEqual({ id });
  expect((await post(a, path('/objections'), { ...body, requestKey: key() })).status).toBe(409);
  expect((await get(ops, path('/objections'), scope)).status).toBe(403);
  expect((await get(b, path('/objections/mine'), scope)).body.data.total).toBe(0);
  const v = await workbench.overview(fin, scope, { from: day, to: day }),
    entry = v.entries.find((e) => e.factId === factId)!;
  expect(entry).toMatchObject({ ready: false, reasonCode: 'MEMBER_OBJECTION' });
  const draft = await statements.previewStatement(fin, scope, key(), factId);
  const saved = (
    await q(
      "SELECT CAST(id AS CHAR) id,input_hash FROM zh_statement_entries WHERE fact_id=? AND payer_kind='agency' LIMIT 1",
      [factId],
    )
  )[0];
  expect(draft.entries.length).toBeGreaterThan(0);
  await expect(statements.confirmStatement(fin, scope, saved.id, key(), saved.input_hash)).rejects.toThrow(
    '金额异议待回复',
  );
  await expect(
    statements.confirmBatch(fin, scope, key(), [{ id: saved.id, expectedHash: saved.input_hash }]),
  ).rejects.toThrow('金额异议待回复');
  const { withTransaction } = await import('../../src/db');
  await expect(
    withTransaction((c) => statements.confirmFinancialFact(c, fin, scope, factId, entry.resultId, entry.revisionId)),
  ).rejects.toThrow('金额异议待回复');
  expect(
    (await post(ops, path('/objections/' + id + '/reply'), { ...scope, reply: '已核对', requestKey: key() })).status,
  ).toBe(403);
  for (let n = 0; n < 2; n++) {
    const current = n === 0 ? id : (await post(a, path('/objections'), { ...body, requestKey: key() })).body.data.id;
    const rb = { ...scope, reply: '已经核对计算依据', requestKey: key() };
    expect((await post(fin, path('/objections/' + current + '/reply'), rb)).status).toBe(200);
    expect((await post(fin, path('/objections/' + current + '/reply'), rb)).status).toBe(200);
  }
  expect((await get(a, path('/objections/mine'), scope)).body.data.total).toBe(2);
});
it('确认幂等、来源指标定位，确认后的异议不冻结钱包', async () => {
  const p = { from: day, to: day },
    v = await workbench.overview(fin, scope, p),
    k = key();
  const first = await workbench.confirmBills(fin, scope, p, k, v.reviewHash);
  expect(first.confirmed).toBe(5);
  const count = (await q('SELECT COUNT(*) n FROM opc_income_entries'))[0].n;
  expect(await workbench.confirmBills(fin, scope, p, k, v.reviewHash)).toEqual(first);
  expect((await q('SELECT COUNT(*) n FROM opc_income_entries'))[0].n).toBe(count);
  const trace = await get(fin, path('/attributions/' + factId + '/trace'), scope);
  expect(trace.status, trace.text).toBe(200);
  expect(trace.body.data.currentSource[0]).toMatchObject({
    batchId: previewId,
    lineNumber: 2,
    metrics: expect.arrayContaining(['orders', 'search']),
  });
  expect((await get(a, path('/attributions/' + factId + '/trace'), scope)).body.data.currentSource).toBeUndefined();
  expect((await get(ops, path('/attributions/' + factId + '/trace'), scope)).status).toBe(403);
  const before = (await finance.financeOverview(a, common())).balance;
  await post(a, path('/objections'), { ...scope, factId, detail: '补充询问', requestKey: key() });
  expect((await finance.financeOverview(a, common())).balance).toEqual(before);
  expect((await workbench.overview(fin, scope, p)).entries.find((e) => e.factId === factId)?.status).toBe('confirmed');
});
it('无收款资料申请、无凭证直接登记和更正均可安全重试', async () => {
  const fv = await finance.financeOverview(fin, common()),
    fk = key();
  const released = await finance.releaseFunding(fin, common(), fv.funding.hash, '', fk);
  expect(await finance.releaseFunding(fin, common(), fv.funding.hash, '', fk)).toEqual(released);
  const applied = await post(a, '/api/v1/core/finance/withdrawals', {
    ...common(),
    amount: '1.00',
    payMethod: 'wechat',
    requestKey: key(),
  });
  expect(applied.status, applied.text).toBe(201);
  const id = applied.body.data.id;
  const pay = { ...common(), paidOn: day, acknowledged: true, requestKey: key(), payMethod: 'wechat' };
  const route = '/api/v1/core/finance/withdrawals/' + id;
  expect((await post(ops, route + '/pay', pay)).status).toBe(403);
  const done = await post(fin, route + '/pay', pay);
  expect(done.status, done.text).toBe(200);
  expect((await post(fin, route + '/pay', pay)).body.data).toEqual(done.body.data);
  expect(
    (await q('SELECT payment_reference,proof_hash,status FROM opc_withdrawals WHERE id=?', [id]))[0],
  ).toMatchObject({ payment_reference: null, proof_hash: null, status: 'paid' });
  const row = (await finance.financeOverview(fin, common())).withdrawals.find((w) => String(w.id) === id)!;
  const correction = {
    ...common(),
    expectedVersion: row.payment_version,
    action: 'amend',
    reason: '更正登记备注',
    remark: '微信已发',
    requestKey: key(),
  };
  const changed = await post(fin, route + '/correct', correction);
  expect(changed.status, changed.text).toBe(200);
  expect((await post(fin, route + '/correct', correction)).body.data).toEqual(changed.body.data);
  expect((await post(fin, route + '/correct', { ...correction, requestKey: key() })).status).toBe(409);
  expect(
    (
      await post(fin, route + '/correct', {
        ...correction,
        requestKey: key(),
        expectedVersion: changed.body.data.paymentVersion,
        action: 'void',
      })
    ).status,
  ).toBe(200);
  expect((await get(fin, route + '/history', common())).body.data.list).toHaveLength(2);
  expect((await get(b, route + '/history', common())).status).toBe(403);
  expect((await post(fin, route + '/pay', { ...pay, requestKey: key() })).status).toBe(200);
  const another = await finance.applyWithdrawal(a, common(), key(), { amount: '1.00', payMethod: 'alipay' });
  await finance.recordPayment(fin, common(), another.id, { paidOn: day });
  expect(
    (await q("SELECT COUNT(*) n FROM opc_withdrawals WHERE status='paid' AND payment_reference IS NULL"))[0].n,
  ).toBe(2);
});
it('新迁移重复执行且历史金额不变', async () => {
  const { readFile } = await import('node:fs/promises');
  const before = await q('SELECT * FROM opc_income_entries ORDER BY id');
  const sql = await readFile('schema/extensions/017_offline_payment_records.sql', 'utf8');
  for (const part of sql
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean))
    await c.query(part);
  const sql2 = await readFile('schema/zhihu/039_finance_workflow.sql', 'utf8');
  for (const part of sql2
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean))
    await c.query(part);
  expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(before);
});

it('同日501条一次发起，后台分段，撤权停止、恢复不重记、变更行跳过', async () => {
  const jobs = await import('../../src/modules/zhihu/attribution/confirmation-jobs');
  const originalFact = (await q('SELECT * FROM zh_metric_facts WHERE id=?', [factId]))[0];
  const originalWord = (await q('SELECT * FROM zh_keywords WHERE id=?', [originalFact.keyword_id]))[0];
  const originalPlan = (await q('SELECT * FROM plans WHERE id=?', [originalWord.plan_id]))[0];
  const originalBinding = (
    await q('SELECT * FROM zh_keyword_bindings WHERE id=?', [originalWord.current_binding_id])
  )[0];
  const originalRevision = (
    await q('SELECT * FROM zh_metric_revisions WHERE id=?', [originalFact.current_revision_id])
  )[0];
  const originalResult = (
    await q('SELECT * FROM zh_attribution_results WHERE id=?', [originalFact.current_result_id])
  )[0];
  const originalRow = (await q('SELECT * FROM zh_import_rows WHERE id=?', [originalRevision.source_row_id]))[0];
  const clone = async (table: string, row: Record<string, unknown>, changes: Record<string, unknown>) => {
    const copy = { ...row, ...changes };
    delete copy.id;
    delete copy.occupied_keyword_id;
    const columns = Object.keys(copy),
      values = columns.map((k) =>
        typeof copy[k] === 'object' && copy[k] !== null && !Buffer.isBuffer(copy[k]) && !(copy[k] instanceof Date)
          ? JSON.stringify(copy[k])
          : copy[k],
      );
    const [r] = await c.query<mysql.ResultSetHeader>(
      'INSERT INTO ' +
        table +
        ' (' +
        columns.map((x) => '\x60' + x + '\x60').join(',') +
        ') VALUES (' +
        columns.map(() => '?').join(',') +
        ')',
      values,
    );
    return String(r.insertId);
  };
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : JSON.parse(JSON.stringify(v)));
  const ids: string[] = [],
    bindings: string[] = [];
  for (let n = 0; n < 501; n++) {
    const keyword = '批量确认' + n,
      planId = await clone('plans', originalPlan, { keyword, zhihu_plan_id: 'bulk-' + n });
    const keywordId = await clone('zh_keywords', originalWord, { keyword, plan_id: planId, current_binding_id: null });
    const bindingId = await clone('zh_keyword_bindings', originalBinding, { keyword_id: keywordId });
    bindings.push(bindingId);
    await c.query('UPDATE zh_keywords SET current_binding_id=? WHERE id=?', [bindingId, keywordId]);
    const id = await clone('zh_metric_facts', originalFact, {
      keyword_id: keywordId,
      current_revision_id: null,
      current_result_id: null,
    });
    ids.push(id);
    const normalized = parse(originalRow.normalized_json);
    normalized.keyword = keyword;
    const rowId = await clone('zh_import_rows', originalRow, {
      line_number: n + 100,
      normalized_json: normalized,
      fact_id: id,
    });
    const source = parse(originalRevision.snapshot_json);
    for (const entry of Object.values(source.sources) as { rowId: string }[]) entry.rowId = rowId;
    const revisionId = await clone('zh_metric_revisions', originalRevision, {
      fact_id: id,
      source_row_id: rowId,
      snapshot_json: source,
    });
    const snapshot = parse(originalResult.snapshot_json);
    snapshot.keyword = keyword;
    snapshot.binding.id = bindingId;
    snapshot.binding.keyword_id = keywordId;
    const resultId = await clone('zh_attribution_results', originalResult, {
      fact_id: id,
      revision_id: revisionId,
      binding_id: bindingId,
      snapshot_json: snapshot,
    });
    await c.query('UPDATE zh_metric_facts SET current_revision_id=?,current_result_id=? WHERE id=?', [
      revisionId,
      resultId,
      id,
    ]);
  }
  const period = { from: day, to: day },
    view = await workbench.overview(fin, scope, period),
    k = key();
  const started = await workbench.confirmBills(fin, scope, period, k, view.reviewHash);
  expect(started).toMatchObject({ total: 501, confirmed: 100, remaining: 401, status: 'pending' });
  expect(await workbench.confirmBills(fin, scope, period, k, view.reviewHash)).toEqual(started);
  const jobId = started.jobId!;
  await c.query("UPDATE users SET admin_duty='operations' WHERE id=?", [fin.sub]);
  await expect(jobs.processConfirmation(scope, jobId)).rejects.toThrow('财务权限');
  expect((await jobs.confirmationStatus(fin, scope, jobId)).status).toBe('failed');
  await c.query("UPDATE users SET admin_duty='finance' WHERE id=?", [fin.sub]);
  const actualConfirm = statements.confirmFinancialFact;
  let attempted = 0;
  const spy = vi.spyOn(statements, 'confirmFinancialFact').mockImplementation(async (...args) => {
    if (++attempted === 5) throw new Error('模拟分段处理中断');
    return actualConfirm(...args);
  });
  try {
    await expect(jobs.retryConfirmation(fin, scope, jobId, key())).rejects.toThrow('模拟分段处理中断');
  } finally {
    spy.mockRestore();
  }
  expect(await jobs.confirmationStatus(fin, scope, jobId)).toMatchObject({
    status: 'failed',
    confirmed: 100,
    remaining: 401,
  });
  expect(
    (await q('SELECT COUNT(*) n FROM opc_income_sources WHERE source_key IN (?)', [ids.map((id) => 'fact:' + id)]))[0]
      .n,
  ).toBe(100);
  await statements.disputeBinding(a, scope, bindings[150], key(), false, '处理中发现作品争议');
  let state = await jobs.retryConfirmation(fin, scope, jobId, key());
  for (let n = 0; n < 8 && state.status === 'pending'; n++) {
    await Promise.all([jobs.recoverConfirmations(), jobs.recoverConfirmations()]);
    state = await jobs.confirmationStatus(fin, scope, jobId);
  }
  expect(state).toMatchObject({ status: 'done', confirmed: 500, skipped: 1, remaining: 0 });
  const count = (
    await q('SELECT COUNT(*) n FROM opc_income_sources WHERE source_key IN (?)', [ids.map((id) => 'fact:' + id)])
  )[0].n;
  expect(count).toBe(500);
  expect(await jobs.processConfirmation(scope, jobId)).toEqual(state);
  expect((await get(ops, path('/workbench/confirm/' + jobId), scope)).status).toBe(403);
  expect((await get(a, path('/workbench/confirm/' + jobId), scope)).status).toBe(403);
}, 120000);
it('拉活两步上传、指标来源定位和撤销后重传不影响已确认拉新', async () => {
  const { previewWorkbenchImport, commitWorkbenchImport } =
    await import('../../src/modules/zhihu/attribution/workbench-import');
  const { previewImportWithdrawal, withdrawImport } =
    await import('../../src/modules/zhihu/attribution/import-withdrawal');
  const before = await q('SELECT * FROM opc_income_entries ORDER BY id');
  const buffer = Buffer.from(`日期,渠道名称,关键词,拉活量,结算金额,代理名称\n${day},联测渠道,联测词0,5,10,测试代理`),
    file = { originalname: '拉活.csv', buffer, size: buffer.length, mimetype: 'text/csv' };
  const previous = process.env.ZHIHU_ACTIVATION_ENABLED;
  process.env.ZHIHU_ACTIVATION_ENABLED = 'true';
  try {
    const preview = await previewWorkbenchImport(fin, scope, file, 'activation', key());
    expect(preview.rows[0]).toMatchObject({
      activations: '5',
      settlement: '10.0000',
      agency: '测试代理',
      orders: null,
    });
    expect((await q("SELECT COUNT(*) n FROM zh_metric_facts WHERE metric_type='activation'"))[0].n).toBe(0);
    expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(before);
    expect((await previewWorkbenchImport(fin, scope, file, 'activation', key())).id).toBe(preview.id);
    await expect(previewWorkbenchImport(fin, scope, file, 'new_user', key())).rejects.toThrow();
    await commitWorkbenchImport(fin, scope, preview.id, key(), preview.previewHash);
    await facts.processBatch(fin, scope, preview.id);
    const af = (await q("SELECT CAST(id AS CHAR) id FROM zh_metric_facts WHERE metric_type='activation'"))[0].id;
    const trace = await facts.trace(fin, scope, af);
    expect(trace.currentSource?.[0]).toMatchObject({
      batchId: preview.id,
      lineNumber: 2,
      metrics: expect.arrayContaining(['activations', 'settlement', 'agency']),
    });
    const plan = await previewImportWithdrawal(fin, scope, preview.id);
    await withdrawImport(fin, scope, preview.id, key(), plan.reviewHash);
    await expect(commitWorkbenchImport(fin, scope, preview.id, key(), preview.previewHash)).rejects.toThrow('撤销');
    const again = await previewWorkbenchImport(fin, scope, file, 'activation', key());
    expect(again.status).toBe('preview');
    expect(again.id).not.toBe(preview.id);
    expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(before);
  } finally {
    if (previous === undefined) delete process.env.ZHIHU_ACTIVATION_ENABLED;
    else process.env.ZHIHU_ACTIVATION_ENABLED = previous;
  }
});
it('并发金额异议只产生一条待回复，跨范围及岗位请求不能读写', async () => {
  const history = (await get(a, path('/objections/mine'), { ...scope, status: 'open' })).body.data.list;
  for (const item of history)
    expect(
      (await post(fin, path('/objections/' + item.id + '/reply'), { ...scope, reply: '已处理', requestKey: key() }))
        .status,
    ).toBe(200);
  const attempts = await Promise.all(
    [1, 2].map(() => post(a, path('/objections'), { ...scope, factId, detail: '并发询问', requestKey: key() })),
  );
  expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
  const id = attempts.find((r) => r.status === 201)!.body.data.id;
  const foreign = { ...scope, accountId: '999999' };
  expect((await get(fin, path('/objections'), foreign)).status).toBe(403);
  expect(
    (await post(fin, path('/objections/' + id + '/reply'), { ...foreign, reply: '无权限', requestKey: key() })).status,
  ).toBe(403);
  expect(
    (await post(a, path('/objections/' + id + '/reply'), { ...scope, reply: '无权限', requestKey: key() })).status,
  ).toBe(403);
  expect(
    (await post(ops, path('/workbench/import/' + previewId + '/commit'), { ...scope, previewHash, requestKey: key() }))
      .status,
  ).toBe(403);
  expect(
    (
      await post(fin, path('/workbench/import/' + previewId + '/commit'), {
        ...foreign,
        previewHash,
        requestKey: key(),
      })
    ).status,
  ).toBe(403);
  expect((await post(ops, path('/workbench/confirm/1/retry'), { ...scope, requestKey: key() })).status).toBe(403);
  expect((await get(fin, path('/workbench/confirm/1'), foreign)).status).toBe(403);
  const own = (await finance.financeOverview(a, common())).withdrawals[0];
  expect(
    (
      await post(ops, '/api/v1/core/finance/withdrawals/' + own.id + '/correct', {
        ...common(),
        expectedVersion: own.payment_version,
        action: 'void',
        reason: '越权请求',
        requestKey: key(),
      })
    ).status,
  ).toBe(403);
  expect((await get(ops, '/api/v1/core/finance/withdrawals/' + own.id + '/history', common())).status).toBe(403);
});
