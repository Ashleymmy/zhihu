import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type PoolConnection } from 'mysql2/promise';
import request from 'supertest';
import type { Express } from 'express';
import type { AuthUser } from '../../src/types';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { SettlementProvider } from '../../src/core/settlement-contracts';
import { writeFile } from 'node:fs/promises';

vi.mock('../../src/modules/zhihu/queue', async (original) => ({
  ...(await original<typeof import('../../src/modules/zhihu/queue')>()),
  enqueue: vi.fn(async () => ({ id: 'isolated-settlement' })),
}));
let container: StartedMySqlContainer, c: Connection, pool: typeof import('../../src/db').db, app: Express;
let resources: typeof import('../../src/modules/zhihu/attribution/resources'),
  workbench: typeof import('../../src/modules/zhihu/attribution/workbench');
let provider: SettlementProvider,
  mapping = '',
  wordId = '',
  name = '结算业绩',
  bindingId = '';
const scope = { projectId: '1', accountId: '' },
  key = () => crypto.randomUUID();
const user = (
  sub: string,
  role: AuthUser['role'],
  adminDuty: AuthUser['adminDuty'] = 'all',
  parentId: string | null = null,
): AuthUser => ({ sub, role, adminDuty, parentId, username: 'settle' + sub, displayName: '人员' + sub, jti: key() });
const admin = user('1', 'admin'),
  leader = user('2', 'leader'),
  creator = user('3', 'creator', 'all', '2'),
  ops = user('4', 'admin', 'operations'),
  fin = user('5', 'admin', 'finance');
const actors = [admin, leader, creator, ops, fin],
  headers: Record<string, Record<string, string>> = {};
const owner = () => ({ ...scope, moduleId: 'zhihu', leaderId: leader.sub });
const selected = (from: string, to = from) => ({ ...owner(), from, to });
const q = async (sql: string, args: unknown[] = []) => (await c.query<mysql.RowDataPacket[]>(sql, args))[0];
const get = (p: string, args: object, actor = fin) =>
  request(app)
    .get('/api/v1/core/' + p)
    .set(headers[actor.sub])
    .query(args);
const post = (p: string, args: object, actor = fin) =>
  request(app)
    .post('/api/v1/core/' + p)
    .set(headers[actor.sub])
    .send(args);
const modulePost = (p: string, args: object, actor = fin) =>
  request(app)
    .post('/api/v1/modules/zhihu/' + p)
    .set(headers[actor.sub])
    .send(args);
async function upload(lines: string[], filename = '结算报表.csv') {
  const buffer = Buffer.from('日期,渠道名称,关键词,搜索量,订单,收益\n' + lines.join('\n'));
  return workbench.uploadReport(fin, scope, {
    buffer,
    size: buffer.length,
    originalname: filename,
    mimetype: 'text/csv',
  });
}
async function makeWord(label: string, assign = true, submitWork = true) {
  const made = await resources.createKeyword(admin, scope, key(), {
    keyword: label,
    taskId: '1',
    mappingId: mapping,
    landingUrl: 'https://example.com/settlement',
    popularizeType: 1,
  });
  await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?", [
    'settlement-' + made.id,
    made.planId,
  ]);
  await resources.synchronizeKeywords(scope);
  if (!assign) return { ...made, bindingId: '' };
  const binding = await resources.distribute(admin, scope, made.id, key(), creator.sub);
  await resources.changeBinding(creator, scope, binding.id, key(), { action: 'activate' });
  await c.query(
    "UPDATE zh_keyword_bindings SET activated_on='2026-07-01',claimed_at='2026-07-01',assigned_at='2026-07-01',used_at='2026-07-01' WHERE id=?",
    [binding.id],
  );
  if (submitWork) {
    const submitted = await modulePost(
      'evidence',
      {
        ...scope,
        bindingId: binding.id,
        requestKey: key(),
        url: 'https://example.com/work/' + made.id,
        description: '结算历史作品',
      },
      creator,
    );
    expect(submitted.status, submitted.text).toBe(201);
  }
  return { ...made, bindingId: binding.id };
}
let measureQueries = 0;
let queryProbe: ((sql: string, run: () => Promise<unknown>) => Promise<unknown>) | undefined;
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('zhihu_settlements')
    .withUsername('test')
    .withUserPassword('isolated')
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
    DEV_DEMO_AUTH: '0',
  });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  for (const a of actors)
    await c.query(
      'INSERT INTO users(id,username,password_hash,role,admin_duty,display_name,parent_id) VALUES(?,?,?,?,?,?,?)',
      [a.sub, a.username, 'unused', a.role, a.adminDuty, a.displayName, a.parentId],
    );
  for (const a of [leader, creator]) {
    await c.query("INSERT INTO project_members(project_id,user_id,joined_at) VALUES(1,?,'2026-01-01')", [a.sub]);
    await c.query(
      "INSERT INTO project_membership_history(user_id,project_id,member_role,effective_from,source_kind,source_ref) VALUES(?,1,?,'2026-01-01','registration',?)",
      [a.sub, a.role, 'registered-' + a.sub],
    );
    await c.query(
      "INSERT INTO team_memberships(user_id,leader_id,source,effective_from) VALUES(?,?,'registration','2026-01-01')",
      [a.sub, a.parentId],
    );
    await c.query(
      "INSERT INTO member_role_history(user_id,to_role,reason,effective_at) VALUES(?,?,'registration','2026-01-01')",
      [a.sub, a.role],
    );
  }
  scope.accountId = String((await q('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
  await c.query(
    "INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'settlement-channel',1,'结算渠道')",
  );
  await c.query(
    "INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'settlement-task','结算推广活动',NOW())",
  );
  resources = await import('../../src/modules/zhihu/attribution/resources');
  workbench = await import('../../src/modules/zhihu/attribution/workbench');
  pool = (await import('../../src/db')).db;
  const getConnection = pool.getConnection.bind(pool);
  pool.getConnection = async () => {
    const conn = await getConnection(),
      original = conn.query;
    conn.query = function (this: PoolConnection, ...args: unknown[]) {
      measureQueries++;
      const run = () => Reflect.apply(original, this, args) as Promise<unknown>;
      return queryProbe ? queryProbe(String(args[0]), run) : run();
    } as typeof conn.query;
    return conn;
  };
  mapping = (
    await resources.createMapping(admin, scope, key(), { channelId: '1', name: '结算渠道', from: '2026-01-01' })
  ).id;
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    { zhihuManifest } = await import('../../src/modules/zhihu/manifest'),
    { createZhihuModule } = await import('../../src/modules/zhihu/module'),
    { createCoreApp } = await import('../../src/core/app');
  const runtime = new ModuleRuntime([zhihuManifest]),
    module = createZhihuModule();
  provider = module.settlementProvider!;
  runtime.register(module);
  app = createCoreApp(runtime);
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions'),
    { signToken } = await import('../../src/auth/jwt');
  for (const a of actors) {
    const client = 'zhihu-settlement-' + a.sub,
      session = await issueRefreshSession(a.sub, { type: 'web', id: client });
    headers[a.sub] = {
      'X-Client-Id': client,
      Authorization: 'Bearer ' + (await signToken({ ...a, id: a.sub, sessionId: session.familyId })),
    };
  }
  const made = await makeWord(name);
  wordId = made.id;
  bindingId = made.bindingId;
}, 90000);
afterAll(async () => {
  await pool?.end();
  await c?.end();
  await container?.stop({ remove: true, removeVolumes: true });
});

it('real provider distinguishes missing reports, unregistered report words and facts with no reliable recipient', async () => {
  const empty = await get('settlements/review', selected('2026-10-20'));
  expect(empty.status, empty.text).toBe(200);
  expect(empty.body.data.coverage.status).toBe('not_arrived');
  const unassigned = await makeWord('已建任务无执行人', false);
  await upload(
    [
      '2026-10-20,结算渠道,未登记报表词,10,1,20',
      '2026-10-20,结算渠道,未登记报表词,10,1,20',
      '2026-10-20,结算渠道,已建任务无执行人,10,1,20',
      `2026-10-20,结算渠道,${name},10,1,20`,
    ],
    '未归属.csv',
  );
  const facts = await q('SELECT id FROM zh_metric_facts WHERE keyword_id=?', [unassigned.id]);
  expect(facts.length).toBe(1);
  const review = await get('settlements/review', selected('2026-10-20'));
  expect(review.status, review.text).toBe(200);
  expect(review.body.data.unresolvedContext).toMatchObject({ records: 2, next: '运营：核对报表中的任务与执行人' });
  expect(review.body.data.total).toBe(1);
  const detail = await get('settlements/records/' + review.body.data.list[0].id, selected('2026-10-20'));
  expect(detail.status, detail.text).toBe(200);
  expect(detail.body.data.evidence.key.taskRef).toBe(wordId);
});

it('real report conflict invalidates a frozen preview without confirming money', async () => {
  await upload([`2026-10-21,结算渠道,${name},10,2,40`], '预览原值.csv');
  const review = await get('settlements/review', selected('2026-10-21'));
  expect(review.status, review.text).toBe(200);
  expect(review.body.data.summary.ready, JSON.stringify(review.body.data)).toBe(1);
  const preview = await post('settlements/previews', {
    ...selected('2026-10-21'),
    expectedReviewVersion: review.body.data.reviewVersion,
    requestKey: key(),
  });
  expect(preview.status, preview.text).toBe(201);
  await upload([`2026-10-21,结算渠道,${name},10,3,60`], '预览新值.csv');
  const result = await post('settlements/' + preview.body.data.id + '/confirm', {
    ...owner(),
    expectedVersion: preview.body.data.version,
    requestKey: key(),
  });
  expect(result.status, result.text).toBe(409);
  expect((await q("SELECT COUNT(*) total FROM opc_income_sources WHERE business_date='2026-10-21'"))[0].total).toBe(0);
});

it('real 105-source review, preview and confirmation preserve totals and disclose co-payees with measured queries', async () => {
  const dates = Array.from({ length: 105 }, (_, i) =>
    new Date(Date.parse('2026-07-01') + i * 86400000).toISOString().slice(0, 10),
  );
  await upload(
    dates.map((date) => `${date},结算渠道,${name},10,2,40`),
    '105日.csv',
  );
  const s = selected(dates[0], dates.at(-1)!);
  measureQueries = 0;
  let start = performance.now();
  const review = await get('settlements/review', { ...s, pageSize: 25 });
  const reviewMs = performance.now() - start,
    reviewQueries = measureQueries;
  expect(review.status, review.text).toBe(200);
  expect(review.body.data.summary.ready, JSON.stringify(review.body.data)).toBe(105);
  expect(review.body.data.total).toBe(105);
  expect(review.body.data.list).toHaveLength(25);
  measureQueries = 0;
  start = performance.now();
  const preview = await post('settlements/previews', {
    ...s,
    expectedReviewVersion: review.body.data.reviewVersion,
    requestKey: key(),
  });
  const previewMs = performance.now() - start,
    previewQueries = measureQueries;
  expect(preview.status, preview.text).toBe(201);
  expect(preview.body.data.impactSummary).toMatchObject({ records: 105, recipients: 2 });
  measureQueries = 0;
  start = performance.now();
  const confirmed = await post('settlements/' + preview.body.data.id + '/confirm', {
    ...owner(),
    expectedVersion: preview.body.data.version,
    requestKey: key(),
  });
  const confirmMs = performance.now() - start,
    confirmQueries = measureQueries;
  expect(confirmed.status, confirmed.text).toBe(200);
  expect(confirmed.body.data).toMatchObject({
    status: 'confirmed',
    summary: { confirmed: 105, ready: 0 },
    paymentStatus: 'not_initiated',
  });
  const [sum] = await q(
    'SELECT CAST(SUM(e.amount) AS CHAR) amount FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.business_date BETWEEN ? AND ? AND e.user_id=?',
    [s.from, s.to, leader.sub],
  );
  expect(sum.amount).toBe(review.body.data.summary.confirmableAmount);
  const measurement = {
    _meta: { kind: 'settlement-performance', schema: 'settlement-performance/1.0', role: 'evidence' },
    sources: 105,
    reviewMs: Math.round(reviewMs),
    reviewQueries,
    previewMs: Math.round(previewMs),
    previewQueries,
    confirmMs: Math.round(confirmMs),
    confirmQueries,
  };
  process.stdout.write('SETTLEMENT_PERFORMANCE ' + JSON.stringify(measurement) + '\n');
  if (process.env.SETTLEMENT_PERF_FILE)
    await writeFile(process.env.SETTLEMENT_PERF_FILE, JSON.stringify(measurement, null, 2));
}, 60000);

it('financial source comments cannot leak into real operations evidence threads or cross-channel records', async () => {
  const review = await get('settlements/review', selected('2026-10-20')),
    record = review.body.data.list[0];
  expect(
    (
      await post('settlements/records/' + record.id + '/comments', {
        ...selected('2026-10-20'),
        body: '仅财务查看金额核对',
        requestKey: key(),
      })
    ).status,
  ).toBe(201);
  const context = {
    ...scope,
    moduleId: 'zhihu',
    channelRef: mapping,
    taskRef: wordId,
    businessDate: '2026-10-20',
    metricType: 'new_user',
  };
  const comment = await post('record-comments', { ...context, body: '运营已核实原作品资料', requestKey: key() }, ops);
  expect(comment.status, comment.text).toBe(201);
  const notes = await get('record-comments', context, fin);
  expect(notes.body.data.list).toHaveLength(1);
  expect(notes.text).not.toContain('仅财务');
  expect((await get('record-comments', { ...context, channelRef: '999' }, ops)).status).toBe(404);
  expect((await get('settlements/records/' + record.id + '/comments', selected('2026-10-20'), ops)).status).toBe(403);
  expect((await post('record-comments', { ...context, body: '成员越权', requestKey: key() }, creator)).status).toBe(
    403,
  );
  expect(bindingId).not.toBe('');
});

it('rate and historical evidence changes invalidate a preview even while the saved amount is unchanged', async () => {
  await upload([`2026-10-22,结算渠道,${name},10,2,40`], '依据变动.csv');
  async function preview() {
    const review = await get('settlements/review', selected('2026-10-22'));
    expect(review.status, review.text).toBe(200);
    const result = await post('settlements/previews', {
      ...selected('2026-10-22'),
      expectedReviewVersion: review.body.data.reviewVersion,
      requestKey: key(),
    });
    expect(result.status, result.text).toBe(201);
    return result.body.data;
  }
  let doc = await preview();
  const [created] = await c.query<mysql.ResultSetHeader>(
    "INSERT INTO opc_rate_rules(project_id,module_id,metric_type,rule_code,unit_price,effective_from,status) VALUES(1,'zhihu','new_user','leader_override',0.6,'2026-10-22','published')",
  );
  expect(
    (await post('settlements/' + doc.id + '/confirm', { ...owner(), expectedVersion: doc.version, requestKey: key() }))
      .status,
  ).toBe(409);
  await c.query('DELETE FROM opc_rate_rules WHERE id=?', [created.insertId]);
  doc = await preview();
  await c.query(
    'INSERT INTO member_history_versions(user_id,project_id,version) VALUES(3,1,1) ON DUPLICATE KEY UPDATE version=version+1',
  );
  expect(
    (await post('settlements/' + doc.id + '/confirm', { ...owner(), expectedVersion: doc.version, requestKey: key() }))
      .status,
  ).toBe(409);
  expect((await q("SELECT COUNT(*) total FROM opc_income_sources WHERE business_date='2026-10-22'"))[0].total).toBe(0);
});

it('received pending and withdrawn reports remain distinguishable from reports that never arrived', async () => {
  const facts = await import('../../src/modules/zhihu/attribution/facts'),
    withdrawal = await import('../../src/modules/zhihu/attribution/import-withdrawal');
  const buffer = Buffer.from(`日期,渠道名称,关键词,搜索量,订单,收益\n2026-10-25,结算渠道,尚未登记的已撤回词,10,1,20`);
  const batch = await facts.previewImport(
    fin,
    scope,
    {
      buffer,
      size: buffer.length,
      originalname: '收到但未处理.csv',
      mimetype: 'text/csv',
    },
    'order',
  );
  const processing = await get('settlements/review', selected('2026-10-25'));
  expect(processing.status, processing.text).toBe(200);
  expect(processing.body.data.coverage.status).toBe('processing');
  const summary = await withdrawal.previewImportWithdrawal(fin, scope, batch.id);
  await withdrawal.withdrawImport(fin, scope, batch.id, key(), summary.reviewHash);
  const withdrawn = await get('settlements/review', selected('2026-10-25'));
  expect(withdrawn.status, withdrawn.text).toBe(200);
  expect(withdrawn.body.data.coverage.status).toBe('withdrawn');
  expect(withdrawn.body.data.unresolvedContext.records).toBe(0);
  expect(withdrawn.body.data.summary.records).toBe(0);
});

it('an actual old confirmation owning the account lock makes a waiting settlement refresh instead of duplicating money', async () => {
  const date = '2026-11-02',
    period = { from: date, to: date };
  await upload([`${date},结算渠道,${name},10,2,40`], '真实确认锁竞争.csv');
  const review = await get('settlements/review', selected(date));
  const preview = await post('settlements/previews', {
    ...selected(date),
    expectedReviewVersion: review.body.data.reviewVersion,
    requestKey: key(),
  });
  expect(preview.status, preview.text).toBe(201);
  const doc = preview.body.data,
    old = await workbench.overview(fin, scope, period);
  let releaseOld!: () => void, oldAcquired!: () => void, modernWaiting!: () => void;
  const released = new Promise<void>((resolve) => {
      releaseOld = resolve;
    }),
    acquired = new Promise<void>((resolve) => {
      oldAcquired = resolve;
    }),
    waiting = new Promise<void>((resolve) => {
      modernWaiting = resolve;
    });
  let attempts = 0;
  queryProbe = async (sql, run) => {
    if (!sql.includes('FROM integration_accounts a') || !sql.includes('FOR UPDATE')) return run();
    const attempt = ++attempts;
    if (attempt === 1) {
      const result = await run();
      oldAcquired();
      await released;
      return result;
    }
    if (attempt === 2) modernWaiting();
    return run();
  };
  const prior = workbench.confirmBills(fin, scope, period, key(), old.reviewHash);
  let modern: Promise<request.Response> | undefined;
  try {
    await acquired;
    modern = post('settlements/' + doc.id + '/confirm', {
      ...owner(),
      expectedVersion: doc.version,
      requestKey: key(),
    }).then((response) => response);
    await waiting;
    releaseOld();
    const [oldResult, result] = await Promise.all([prior, modern]);
    expect(oldResult.confirmed).toBe(1);
    expect(result.status, result.text).toBe(409);
    const values = await q(
      `SELECT CAST(e.user_id AS CHAR) user_id,COUNT(*) records,CAST(SUM(e.amount) AS CHAR) amount
      FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.business_date=? GROUP BY e.user_id`,
      [date],
    );
    expect(values).toHaveLength(2);
    for (const value of values) {
      expect(Number(value.records)).toBe(1);
      expect(value.amount).toBe(doc.impacts.find((i: { payeeId: string }) => i.payeeId === value.user_id).amount);
    }
  } finally {
    releaseOld();
    await Promise.allSettled([prior, modern]);
    queryProbe = undefined;
  }
});

it('blocked next steps follow missing historical evidence while missing work retains the actual executor action', async () => {
  const date = '2026-11-03';
  await upload([`${date},结算渠道,${name},10,2,40`], '历史依据下一步.csv');
  await c.query("UPDATE project_membership_history SET effective_from='2026-12-01' WHERE user_id=3 AND project_id=1");
  try {
    const review = await get('settlements/review', selected(date));
    expect(review.status, review.text).toBe(200);
    expect(review.body.data.list[0]).toMatchObject({
      status: 'blocked',
      next: '运营：补充历史依据',
      nextAction: { key: 'complete_member_history', requiredDuty: 'operations' },
    });
    expect(review.body.data.list[0].reason).toContain('项目参与');
  } finally {
    await c.query("UPDATE project_membership_history SET effective_from='2026-01-01' WHERE user_id=3 AND project_id=1");
  }
  const missing = await makeWord('需要达人补作品', true, false);
  await upload([`${date},结算渠道,需要达人补作品,10,2,40`], '作品下一步.csv');
  const review = await get('settlements/review', selected(date));
  expect(review.status, review.text).toBe(200);
  const record = review.body.data.list.find((row: { taskId: string }) => row.taskId === missing.id);
  expect(record).toMatchObject({ status: 'blocked', next: '达人 人员3：补登记作品' });
});

it('the route gate retains absent-table compatibility and propagates other database failures', async () => {
  const { gate } = await import('../../src/modules/zhihu/attribution/routing'),
    { withTransaction } = await import('../../src/db');
  expect(await withTransaction((conn) => gate(conn))).toBe(true);
  await c.query('RENAME TABLE zh_engine_gate TO zh_engine_gate_test_absent');
  try {
    expect(await withTransaction((conn) => gate(conn))).toBe(false);
    expect(await withTransaction((conn) => gate(conn, true))).toBe(false);
  } finally {
    await c.query('RENAME TABLE zh_engine_gate_test_absent TO zh_engine_gate');
  }
  const denied = Object.assign(new Error('table access denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
  await expect(
    gate({
      query: async () => {
        throw denied;
      },
    } as unknown as PoolConnection),
  ).rejects.toBe(denied);
});

it('mixed scope retains processing or withdrawn coverage while ready sources can still be confirmed', async () => {
  const date = '2026-11-05';
  const active = await upload([`${date},结算渠道,${name},10,2,40`], '混合范围可确认.csv');
  const facts = await import('../../src/modules/zhihu/attribution/facts'),
    withdrawal = await import('../../src/modules/zhihu/attribution/import-withdrawal');
  const buffer = Buffer.from(`日期,渠道名称,关键词,搜索量,订单,收益\n${date},结算渠道,尚在处理的未知关键词,10,1,20`);
  const pending = await facts.previewImport(
    fin,
    scope,
    {
      buffer,
      size: buffer.length,
      originalname: '混合范围处理中.csv',
      mimetype: 'text/csv',
    },
    'order',
  );
  const review = await get('settlements/review', selected(date));
  expect(review.status, review.text).toBe(200);
  expect(review.body.data).toMatchObject({
    coverage: { status: 'processing' },
    summary: { ready: 1, records: 1, amount: '1.0000' },
    unresolvedContext: { records: 0 },
  });
  const preview = await post('settlements/previews', {
    ...selected(date),
    expectedReviewVersion: review.body.data.reviewVersion,
    requestKey: key(),
  });
  expect(preview.status, preview.text).toBe(201);
  expect(preview.body.data.impactSummary.records).toBe(1);
  const confirmed = await post('settlements/' + preview.body.data.id + '/confirm', {
    ...owner(),
    expectedVersion: preview.body.data.version,
    requestKey: key(),
  });
  expect(confirmed.status, confirmed.text).toBe(200);
  expect((await get('settlements/review', selected(date))).body.data.coverage.status).toBe('processing');
  for (const batch of [active, pending]) {
    const plan = await withdrawal.previewImportWithdrawal(fin, scope, batch.id);
    await withdrawal.withdrawImport(fin, scope, batch.id, key(), plan.reviewHash);
  }
  const correction = await get('settlements/review', selected(date));
  expect(correction.status, correction.text).toBe(200);
  expect(correction.body.data).toMatchObject({
    coverage: { status: 'withdrawn' },
    summary: { ready: 1, records: 1, amount: '0.0000', confirmableAmount: '-1.0000' },
  });
});
