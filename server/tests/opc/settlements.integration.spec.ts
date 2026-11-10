import { afterAll, beforeAll, expect, it } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { Router, type Express } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';
import type { EvidenceRow, ModuleManifest } from '../../src/core/contracts';
import type { SettlementProvider } from '../../src/core/settlement-contracts';
import type { EarningSourceInput } from '../../src/core/earnings';

let container: StartedMySqlContainer, c: mysql.Connection, app: Express, pool: typeof import('../../src/db').db;
let tx: typeof import('../../src/db').withTransaction, earnings: typeof import('../../src/core/earnings');
let failingSource: string | null = null;
const base = { moduleId: 'settlement-test', projectId: '1', accountId: '1' },
  owner = { ...base, leaderId: '4' };
const scope = (day = '2026-10-01') => ({ ...owner, from: day, to: day });
const actors = [
  { id: '1', role: 'admin', adminDuty: 'all' },
  { id: '2', role: 'admin', adminDuty: 'finance' },
  { id: '3', role: 'admin', adminDuty: 'operations' },
  { id: '4', role: 'leader', adminDuty: 'all' },
  { id: '5', role: 'leader', adminDuty: 'all' },
  { id: '6', role: 'creator', adminDuty: 'all' },
  { id: '7', role: 'creator', adminDuty: 'all' },
] as const;
const headers: Record<string, Record<string, string>> = {};
const admin: AuthUser = {
  sub: '1',
  role: 'admin',
  adminDuty: 'all',
  username: 's1',
  displayName: '经办人',
  parentId: null,
  jti: 'settlement-test',
};
const manifest: ModuleManifest = {
  id: base.moduleId,
  name: '结算测试',
  version: '1',
  contractVersion: 2,
  roles: ['admin', 'leader', 'creator'],
  permissions: {},
  capabilities: [],
  entryPath: '/tasks',
};
const key = () => crypto.randomUUID();
const q = async (sql: string, args: unknown[] = []) => (await c.query<mysql.RowDataPacket[]>(sql, args))[0];
const get = (path: string, query: object, actor = '2') =>
  request(app)
    .get('/api/v1/core/' + path)
    .set(headers[actor])
    .query(query);
const post = (path: string, body: object, actor = '2') =>
  request(app)
    .post('/api/v1/core/' + path)
    .set(headers[actor])
    .send(body);
function source(
  name: string,
  date: string,
  amount: string | null = '5.0000',
  performer = '6',
  version = '1',
): EarningSourceInput {
  return {
    sourceKey: name,
    version,
    date,
    taskId: name,
    taskName: '任务 ' + name,
    metricType: 'new_user',
    metricLabel: '拉新',
    unit: '单',
    lines: [
      {
        payeeId: '4',
        performerId: performer,
        performerName: performer === '4' ? '团长本人' : '同名成员',
        ruleCode: performer === '4' ? 'leader_self' : 'leader_override',
        quantity: '2',
        unitPrice: null,
        amount,
        internal: false,
        ready: amount !== null,
        reason: amount === null ? '缺少计价资料' : '',
        next: amount === null ? '财务：补齐计价资料' : '',
      },
      ...(performer === '4'
        ? []
        : [
            {
              payeeId: performer,
              performerId: performer,
              performerName: '同名成员',
              ruleCode: 'creator',
              quantity: '2',
              unitPrice: null,
              amount: '16.0000',
              internal: false,
              ready: true,
              reason: '',
              next: '',
            },
          ]),
    ],
  };
}
const write = (value: EarningSourceInput) => tx((conn) => earnings.writeEarningLines(conn, base, value));
async function preview(s = scope()) {
  const review = await get('settlements/review', s);
  expect(review.status, review.text).toBe(200);
  const made = await post('settlements/previews', {
    ...s,
    expectedReviewVersion: review.body.data.reviewVersion,
    requestKey: key(),
  });
  expect(made.status, made.text).toBe(201);
  return made.body.data;
}
const confirm = (doc: { id: string; version: string }, requestKey = key()) =>
  post(`settlements/${doc.id}/confirm`, { ...owner, expectedVersion: doc.version, requestKey });
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('core_settlements')
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
    NODE_ENV: 'test',
    OPC_MODULES: '',
    QUEUE_DRIVER: 'memory',
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
    DEV_DEMO_AUTH: '0',
  });
  await runOpcMigrations(target, []);
  c = await mysql.createConnection(target);
  for (const a of actors)
    await c.query('INSERT INTO users(id,username,password_hash,role,admin_duty,display_name) VALUES(?,?,?,?,?,?)', [
      a.id,
      's' + a.id,
      'unused',
      a.role,
      a.adminDuty,
      ['6', '7'].includes(a.id) ? '同名成员' : '人员' + a.id,
    ]);
  await c.query("INSERT INTO projects(id,name,slug) VALUES(1,'项目一','settlement-one'),(2,'项目二','settlement-two')");
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,4),(1,6),(1,7),(2,5)');
  await c.query("INSERT INTO module_installations(module_id,version) VALUES('settlement-test','1')");
  await c.query(
    "INSERT INTO integration_accounts(id,module_id,account_key,name) VALUES(1,'settlement-test','one','来源一'),(2,'settlement-test','two','来源二')",
  );
  await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(1,1),(2,2)');
  ({ db: pool, withTransaction: tx } = await import('../../src/db'));
  earnings = await import('../../src/core/earnings');
  const { lockFinance } = await import('../../src/core/finance'),
    { checksum } = await import('../../src/core/money');
  const provider: SettlementProvider = {
    lock: (conn, _actor, s) => lockFinance(conn, s),
    async inspect(conn, _actor, s, keys) {
      const results = [];
      for (const sourceKey of keys) {
        const [[es]] = await conn.query<mysql.RowDataPacket[]>(
          'SELECT * FROM opc_earning_sources WHERE module_id=? AND project_id=? AND account_id=? AND source_key=?',
          [s.moduleId, s.projectId, s.accountId, sourceKey],
        );
        if (!es) continue;
        const [lines] = await conn.query<mysql.RowDataPacket[]>(
          'SELECT CAST(payee_id AS CHAR) payee_id,CAST(amount AS CHAR) amount,is_ready,confirmed_at FROM opc_earning_lines WHERE source_id=? AND source_version=? ORDER BY payee_id',
          [es.id, es.current_version],
        );
        const status = lines.every((l) => l.confirmed_at)
          ? ('confirmed' as const)
          : lines.every((l) => l.is_ready && l.amount !== null)
            ? ('ready' as const)
            : ('blocked' as const);
        results.push({
          sourceKey,
          version: String(es.current_version),
          token: checksum([es.current_version, lines]),
          status,
          reason: status === 'blocked' ? '计价资料待补' : '',
          next: status === 'blocked' ? '财务：补齐资料' : '',
          nextAction: null,
          evidence: null,
          allocations: lines.map((l) => ({
            payeeId: String(l.payee_id),
            amount: l.amount === null ? null : String(l.amount),
          })),
        });
      }
      return results;
    },
    async context() {
      return {
        coverage: { status: 'no_performance', message: '所选收款人尚无可归属的业绩' },
        unresolvedContext: { records: 2, reason: '还有两行未确定归属', next: '运营：核对执行人', nextAction: null },
      };
    },
    confirm: async (conn, actor, s, sourceKey, version) => {
      if (sourceKey === failingSource) throw new Error('isolated confirmation failure');
      await earnings.confirmEarningSource(conn, actor, s, sourceKey, version);
    },
  };
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    runtime = new ModuleRuntime([manifest]);
  runtime.register({
    manifest,
    router: Router(),
    settlementProvider: provider,
    dataProvider: {
      summary: async (s) => ({ ...s, moduleId: manifest.id, status: 'empty', metrics: [], updatedAt: '' }),
      async evidenceInTransaction(_conn, s, _actor, f) {
        const check = { status: 'ready' as const, reason: '已核实', sourceRefs: [] };
        const row: EvidenceRow = {
          key: {
            projectId: s.projectId,
            accountId: s.accountId,
            channelRef: f.channelRef!,
            taskRef: f.taskRef!,
            businessDate: s.from,
            metricType: f.metricType!,
          },
          title: '真实业务上下文测试',
          official: {
            status: 'ready',
            quantity: '1',
            quantityUnit: '单',
            coverageBasis: 'observed_rows',
            coverageIsExhaustive: false,
            sourceRefs: [],
            currentRevision: '1',
            pendingConflict: [],
          },
          checks: {
            work: check,
            historicalOwnership: check,
            projectParticipation: check,
            pricing: check,
            existingCalculation: check,
          },
          result: {
            status: 'ready',
            reason: '已齐',
            responsibleRole: null,
            nextAction: null,
            evidenceVersion: 'one',
            lastChangedAt: null,
          },
          finance: { amount: '999.0000', currency: 'CNY', sourceRefs: [] },
        };
        const found = f.channelRef === '1' && f.taskRef === '11';
        return {
          ...s,
          moduleId: manifest.id,
          status: found ? 'ready' : 'empty',
          list: found ? [row] : [],
          total: found ? 1 : 0,
          page: 1,
          pageSize: 1,
          limits: { maxDays: 31, maxPageSize: 100 },
        };
      },
    },
  });
  app = (await import('../../src/core/app')).createCoreApp(runtime);
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions'),
    { signToken } = await import('../../src/auth/jwt');
  for (const a of actors) {
    const client = 'settlement-client-' + a.id,
      session = await issueRefreshSession(a.id, { type: 'web', id: client });
    headers[a.id] = {
      'X-Client-Id': client,
      Authorization:
        'Bearer ' +
        (await signToken({
          ...a,
          username: 's' + a.id,
          displayName: '人员',
          parentId: null,
          sessionId: session.familyId,
        })),
    };
  }
}, 90000);
afterAll(async () => {
  await pool?.end();
  await c?.end();
  await container?.stop({ remove: true, removeVolumes: true });
});

it('all new finance routes reject operations, members, mismatched projects and document recipient guessing', async () => {
  await write(source('auth-source', '2026-10-01'));
  const review = await get('settlements/review', scope()),
    recordId = review.body.data.list[0].id,
    doc = await preview();
  const reads: [string, object][] = [
    ['settlements/recipients', base],
    ['settlements/review', scope()],
    ['settlements/records/' + recordId, scope()],
    ['settlements', owner],
    ['settlements/' + doc.id, owner],
    ['settlements/' + doc.id + '/comments', owner],
    ['settlements/records/' + recordId + '/comments', scope()],
  ];
  for (const [path, args] of reads)
    for (const actor of ['3', '4', '6']) expect((await get(path, args, actor)).status, path).toBe(403);
  const writes: [string, object][] = [
    ['settlements/previews', { ...scope(), expectedReviewVersion: review.body.data.reviewVersion, requestKey: key() }],
    ['settlements/' + doc.id + '/confirm', { ...owner, expectedVersion: doc.version, requestKey: key() }],
    ['settlements/' + doc.id + '/comments', { ...owner, body: '拒绝留言', requestKey: key() }],
    ['settlements/records/' + recordId + '/comments', { ...scope(), body: '拒绝留言', requestKey: key() }],
  ];
  for (const [path, args] of writes)
    for (const actor of ['3', '4', '6']) expect((await post(path, args, actor)).status, path).toBe(403);
  expect((await get('settlements/review', { ...scope(), accountId: '2' })).status).toBe(403);
  expect((await get('settlements/' + doc.id, { ...owner, leaderId: '5' })).status).toBe(404);
  expect(
    (await post('settlements/' + doc.id + '/comments', { ...owner, leaderId: '5', body: '越权', requestKey: key() }))
      .status,
  ).toBe(404);
  expect((await get('settlements/recipients', base)).body.data.list.map((p: { id: string }) => p.id)).toEqual(['4']);
});

it('previews disclose all actual payees while leader totals exclude creator income; blocked sources stay separate', async () => {
  await write(source('shared', '2026-10-02'));
  await write(source('self', '2026-10-02', '9.0000', '4'));
  await write(source('blocked', '2026-10-02', null));
  const s = scope('2026-10-02'),
    review = await get('settlements/review', { ...s, pageSize: 1 });
  expect(review.body.data).toMatchObject({
    total: 3,
    summary: { amount: null, knownAmount: '14.0000', confirmableAmount: '14.0000', ready: 2, blocked: 1 },
    unresolvedContext: { records: 2 },
  });
  const doc = await preview(s);
  expect(doc.impactSummary).toMatchObject({ recipients: 2, records: 2, amount: '30.0000', deltaAmount: '30.0000' });
  expect(doc.impacts.find((p: { payeeId: string }) => p.payeeId === '6').amount).toBe('16.0000');
  const result = await confirm(doc);
  expect(result.status, result.text).toBe(200);
  expect(result.body.data).toMatchObject({
    status: 'confirmed',
    paymentStatus: 'not_initiated',
    summary: { confirmedAmount: '14.0000', blocked: 1, ready: 0 },
  });
  expect((await q('SELECT COUNT(*) total FROM opc_withdrawals'))[0].total).toBe(0);
  expect(
    (
      await q(
        "SELECT CAST(SUM(e.amount) AS CHAR) amount FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.business_date='2026-10-02' AND e.user_id=6",
      )
    )[0].amount,
  ).toBe('16.0000');
});

it('stale source versions, allocation changes and duty changes cannot confirm an old preview', async () => {
  const value = source('stale', '2026-10-03');
  await write(value);
  const doc = await preview(scope('2026-10-03'));
  await write({
    ...value,
    version: '2',
    lines: value.lines.map((l) => (l.payeeId === '4' ? { ...l, amount: '7.0000' } : l)),
  });
  expect((await confirm(doc)).status).toBe(409);
  expect((await q("SELECT COUNT(*) total FROM opc_income_sources WHERE source_key='stale'"))[0].total).toBe(0);
  const fresh = await preview(scope('2026-10-03'));
  await c.query("UPDATE users SET admin_duty='operations' WHERE id=2");
  expect((await confirm(fresh)).status).toBe(403);
  await c.query("UPDATE users SET admin_duty='finance' WHERE id=2");
  expect((await confirm(fresh)).status).toBe(200);
});

it('full-range aggregates retain 107 rows, same-name performers, historical transfers and both metric types', async () => {
  for (let i = 0; i < 107; i++) {
    const value = source('many-' + i, '2026-10-04', '1.0000', i % 2 ? '6' : '7');
    if (i === 106) {
      value.metricType = 'activation';
      value.metricLabel = '拉活';
      value.unit = '个';
    }
    await write(value);
  }
  await c.query('UPDATE users SET parent_id=5 WHERE id IN (6,7)');
  const first = await get('settlements/review', { ...scope('2026-10-04'), pageSize: 100 });
  expect(first.body.data).toMatchObject({ total: 107, summary: { knownAmount: '107.0000', ready: 107 } });
  expect(first.body.data.summary.groups).toHaveLength(2);
  expect(first.body.data.list).toHaveLength(100);
  const next = await get('settlements/review', { ...scope('2026-10-04'), pageSize: 100, page: 2 });
  expect(next.body.data.list).toHaveLength(7);
  expect(next.body.data.summary.knownAmount).toBe('107.0000');
  expect(new Set(first.body.data.list.map((r: { performerId: string }) => r.performerId)).size).toBe(2);
  expect((await get('settlements/review', { ...scope('2026-10-04'), leaderId: '5' })).status).toBe(404);
});

it('same request retry and parallel confirmation produce one ledger change, while another preview becomes stale', async () => {
  await write(source('race', '2026-10-05'));
  const doc = await preview(scope('2026-10-05')),
    other = await preview(scope('2026-10-05')),
    requestKey = key();
  const results = await Promise.all([confirm(doc, requestKey), confirm(doc, requestKey)]);
  for (const result of results) expect(result.status, result.text).toBe(200);
  expect(results[0].body.data).toEqual(results[1].body.data);
  expect(
    (
      await q(
        "SELECT COUNT(*) total FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.source_key='race'",
      )
    )[0].total,
  ).toBe(2);
  expect((await confirm(other)).status).toBe(409);
  const changed = await post('settlements/' + doc.id + '/confirm', {
    ...owner,
    expectedVersion: '0'.repeat(64),
    requestKey,
  });
  expect(changed.status).toBe(409);
});

it('a removed previous payee appears as a zero-target correction, preserving all original ledger rows', async () => {
  const initial = source('correction', '2026-10-06');
  await write(initial);
  expect((await confirm(await preview(scope('2026-10-06')))).status).toBe(200);
  const before = await q(
    "SELECT e.* FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.source_key='correction' ORDER BY e.id",
  );
  await write({ ...initial, version: '2', lines: [{ ...initial.lines[0], amount: '9.0000' }] });
  const doc = await preview(scope('2026-10-06'));
  expect(doc.impacts.find((p: { payeeId: string }) => p.payeeId === '6')).toMatchObject({
    amount: '0.0000',
    confirmedAmount: '16.0000',
    deltaAmount: '-16.0000',
  });
  expect((await confirm(doc)).status).toBe(200);
  const after = await q(
    "SELECT e.* FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.source_key='correction' ORDER BY e.id",
  );
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after.length).toBeGreaterThan(before.length);
});

it('valid zero differs from unresolved calculation, and repair automatically changes the next review', async () => {
  await write(source('valid-zero', '2026-10-07', '0.0000', '4'));
  const missing = source('repair', '2026-10-07', null);
  await write(missing);
  let review = await get('settlements/review', scope('2026-10-07'));
  expect(review.body.data.summary).toMatchObject({
    amount: null,
    knownAmount: '0.0000',
    pendingCalculations: 1,
    ready: 1,
    blocked: 1,
  });
  expect(review.body.data.list.find((r: { sourceKey: string }) => r.sourceKey === 'valid-zero').amount).toBe('0.0000');
  await write({
    ...missing,
    version: '2',
    lines: missing.lines.map((l) => ({
      ...l,
      amount: l.payeeId === '4' ? '4.0000' : l.amount,
      ready: true,
      reason: '',
      next: '',
    })),
  });
  review = await get('settlements/review', scope('2026-10-07'));
  expect(review.body.data.summary).toMatchObject({ amount: '4.0000', ready: 2, blocked: 0 });
});

it('financial and nonfinancial threads stay separate, keep full business keys, and never mutate accounts', async () => {
  const doc = await preview(scope('2026-10-07')),
    requestKey = key();
  const finance = await post('settlements/' + doc.id + '/comments', { ...owner, body: '财务核对记录', requestKey });
  expect(finance.status, finance.text).toBe(201);
  expect(
    (await post('settlements/' + doc.id + '/comments', { ...owner, body: '财务核对记录', requestKey })).body.data,
  ).toEqual(finance.body.data);
  const sourceId = doc.items[0].record.id;
  expect(
    (
      await post('settlements/records/' + sourceId + '/comments', {
        ...scope('2026-10-07'),
        body: '来源记录',
        requestKey: key(),
      })
    ).status,
  ).toBe(201);
  expect((await get('settlements/records/' + sourceId + '/comments', scope('2026-10-07'))).body.data.total).toBe(1);
  const context = { ...base, channelRef: '1', taskRef: '11', businessDate: '2026-10-07', metricType: 'new_user' };
  const business = await post('record-comments', { ...context, body: '已补充原作品资料', requestKey: key() }, '3');
  expect(business.status, business.text).toBe(201);
  const visible = await get('record-comments', context, '2');
  expect(visible.body.data.total).toBe(1);
  expect(visible.text).not.toContain('999.0000');
  expect(visible.text).not.toContain('财务核对记录');
  for (const actor of ['4', '6']) {
    expect((await get('record-comments', context, actor)).status).toBe(403);
    expect((await post('record-comments', { ...context, body: '越权', requestKey: key() }, actor)).status).toBe(403);
  }
  expect((await get('record-comments', { ...context, channelRef: '2' }, '3')).status).toBe(404);
  expect(
    (await post('record-comments', { ...context, accountId: '2', body: '越权来源', requestKey: key() }, '3')).status,
  ).toBe(403);
  expect((await get('record-comments', { ...context, businessDate: '2026-10-08' }, '3')).body.data.total).toBe(0);
  expect((await get('settlements/' + doc.id, owner)).body.data.status).toBe('preview');
});

it('a mid-confirmation failure rolls back every write and permits the identical request to retry', async () => {
  await write(source('rollback-first', '2026-10-08'));
  await write(source('rollback-last', '2026-10-08'));
  const doc = await preview(scope('2026-10-08')),
    requestKey = key();
  failingSource = 'rollback-last';
  expect((await confirm(doc, requestKey)).status).toBe(500);
  expect((await q("SELECT COUNT(*) total FROM opc_income_sources WHERE business_date='2026-10-08'"))[0].total).toBe(0);
  expect((await get('settlements/' + doc.id, owner)).body.data.status).toBe('preview');
  failingSource = null;
  expect((await confirm(doc, requestKey)).status).toBe(200);
  expect(
    (
      await q(
        "SELECT COUNT(*) total FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.business_date='2026-10-08'",
      )
    )[0].total,
  ).toBe(4);
});

it('overlapping existing source confirmation and a new settlement cannot duplicate credits', async () => {
  const value = source('existing-path-race', '2026-10-09');
  await write(value);
  const doc = await preview(scope('2026-10-09'));
  const [result] = await Promise.all([
    confirm(doc),
    tx((conn) => earnings.confirmEarningSource(conn, admin, base, value.sourceKey, value.version)),
  ]);
  expect([200, 409]).toContain(result.status);
  expect(
    (
      await q(
        "SELECT COUNT(*) total FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.source_key='existing-path-race'",
      )
    )[0].total,
  ).toBe(2);
});
