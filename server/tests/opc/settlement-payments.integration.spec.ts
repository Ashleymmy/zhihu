import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
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
    .withDatabase('core_settlement_payments')
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
    OPC_WITHDRAWAL_POLICY_ENABLED: '1',
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

afterEach(async () => {
  await c.query("UPDATE opc_withdrawals SET status='cancelled'");
  await c.query("UPDATE opc_income_entries SET availability='held'");
});
let sequence = 0;
async function setup(amount = '100.00', extra?: { amount: string; name?: string }) {
  const date = '2026-10-' + String(++sequence).padStart(2, '0');
  await write(source('payment-' + sequence, date, amount, '4'));
  if (extra) await write(source(extra.name ?? 'payment-extra-' + sequence, date, extra.amount, '4'));
  const doc = await preview(scope(date));
  const result = await confirm(doc);
  expect(result.status, result.text).toBe(200);
  return result.body.data as { id: string; version: string; items: Array<{ record: { id: string } }> };
}
const overview = async (id: string) => {
  const r = await get(`settlements/${id}/payments`, owner);
  expect(r.status, r.text).toBe(200);
  return r.body.data;
};
async function open(id: string) {
  const view = await overview(id);
  if (view.funding.amount !== '0.0000') {
    const r = await post(`settlements/${id}/funding`, {
      ...owner,
      expectedVersion: view.version,
      requestKey: key(),
      reference: '仅隔离测试核实款项到账',
    });
    expect(r.status, r.text).toBe(200);
  }
}
async function quote(id: string, value: string) {
  const view = await overview(id);
  const r = await post(`settlements/${id}/payment-quote`, { ...owner, amount: value, expectedVersion: view.version });
  expect(r.status, r.text).toBe(200);
  return r.body.data;
}
async function create(id: string, value: string) {
  const quoted = await quote(id, value);
  const body = {
    ...owner,
    ...quoted,
    receiverName: '测试收款人',
    payMethod: 'bank',
    payAccount: 'TEST-ONLY',
    requestKey: key(),
  };
  delete body.settlementId;
  delete body.feeAmount;
  delete body.netAmount;
  delete body.reviewDeadline;
  delete body.settlementDeadline;
  delete body.invoiceRequired;
  delete body.allocations;
  const r = await post(`settlements/${id}/payments`, body);
  expect(r.status, r.text).toBe(201);
  return { id: r.body.data.withdrawalId, body, quoted };
}
async function action(id: string, wid: string, command: 'cancel' | 'failed' | 'retry') {
  const view = await overview(id);
  const r = await post(`settlements/${id}/payments/${wid}/action`, {
    ...owner,
    action: command,
    expectedVersion: view.version,
    requestKey: key(),
    reason: '隔离测试核实',
  });
  expect(r.status, r.text).toBe(200);
  return r;
}
async function pay(wid: string, quoted: { netAmount: string; policyVersion: string }) {
  const r = await post(`finance/withdrawals/${wid}/review`, { ...base, action: 'approve' });
  expect(r.status, r.text).toBe(200);
  const paid = await post(`finance/withdrawals/${wid}/pay`, {
    ...base,
    paidOn: '2026-10-01',
    acknowledged: true,
    netAmount: quoted.netAmount,
    policyVersion: quoted.policyVersion,
    requestKey: key(),
    reference: 'TEST-' + key(),
  });
  expect(paid.status, paid.text).toBe(200);
  return paid;
}

it('reserves selected recipient only, shares existing approval/payment and preserves confirmation', async () => {
  const doc = await setup('123.4567');
  const [before] = await q('SELECT document_json FROM opc_settlements WHERE id=?', [doc.id]);
  let v = await overview(doc.id);
  expect(v.totals.availableAmount).toBe('0.0000');
  expect(v.funding.amount).toBe('123.4567');
  await open(doc.id);
  const made = await create(doc.id, '123.45');
  expect(made.quoted.feeAmount).toBe('1.2300');
  expect(made.quoted.netAmount).toBe('122.2200');
  const [w] = await q('SELECT CAST(user_id AS CHAR) user_id FROM opc_withdrawals WHERE id=?', [made.id]);
  expect(w.user_id).toBe('4');
  v = await overview(doc.id);
  expect(v.totals.processingAmount).toBe('123.4500');
  expect(v.totals.residualAmount).toBe('0.0067');
  await pay(made.id, made.quoted);
  v = await overview(doc.id);
  expect(v.totals.paidGrossAmount).toBe('123.4500');
  expect(v.totals.paidNetAmount).toBe('122.2200');
  expect(v.paymentStatus).toBe('partially_paid');
  const detail = await get(`settlements/${doc.id}`, owner);
  expect(detail.body.data.paymentStatus).toBe('partially_paid');
  const [after] = await q('SELECT document_json FROM opc_settlements WHERE id=?', [doc.id]);
  expect(after.document_json).toEqual(before.document_json);
  const retry = await post(`settlements/${doc.id}/payments`, made.body);
  expect(retry.status, retry.text).toBe(201);
  expect(retry.body.data.withdrawalId).toBe(made.id);
  const changed = await post(`settlements/${doc.id}/payments`, { ...made.body, amount: '1.00' });
  expect(changed.status).toBe(409);
});

it('funding accepts an omitted or empty note with one audited release and retains version checks', async () => {
  const doc = await setup('12.3456');
  const view = await overview(doc.id);
  const body = { ...owner, expectedVersion: view.version, requestKey: key() };
  const path = `settlements/${doc.id}/funding`;
  const denied = await post(path, body, '3');
  expect(denied.status).toBe(403);
  const released = await post(path, body);
  expect(released.status, released.text).toBe(200);
  expect(released.body.data.amount).toBe('12.3456');
  const repeated = await post(path, { ...body, reference: '   ' });
  expect(repeated.status, repeated.text).toBe(200);
  expect(repeated.body.data).toEqual(released.body.data);
  const [audit] = await q(
    "SELECT COUNT(*) count, MAX(JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.reference'))) reference FROM audit_logs WHERE action='settlement.funding_release' AND resource_id=?",
    [doc.id],
  );
  expect(Number(audit.count)).toBe(1);
  expect(audit.reference).toBe('财务已核实所选款项到账');
  const references = await q(
    "SELECT DISTINCT release_reference FROM opc_income_entries WHERE released_by=2 AND availability='available'",
  );
  expect(references.map((row) => row.release_reference)).toEqual(['财务已核实所选款项到账']);
  expect((await overview(doc.id)).funding.amount).toBe('0.0000');
  const stale = await post(path, { ...body, requestKey: key(), reference: '' });
  expect(stale.status).toBe(409);
  const second = await setup('7');
  const secondView = await overview(second.id);
  const blank = await post(`settlements/${second.id}/funding`, {
    ...owner,
    requestKey: key(),
    expectedVersion: secondView.version,
    reference: '',
  });
  expect(blank.status, blank.text).toBe(200);
  expect(blank.body.data.amount).toBe('7.0000');
});

it('all new endpoints reject operations, members and forged recipient scopes', async () => {
  const doc = await setup();
  await open(doc.id);
  const made = await create(doc.id, '10');
  const v = await overview(doc.id),
    sourceId = doc.items[0].record.id;
  const reads = [
    `settlements/${doc.id}/payments`,
    `settlements/${doc.id}/legacy-payments`,
    `settlements/${doc.id}/export`,
    `settlements/${doc.id}/payments/${made.id}/comments`,
  ];
  const writes: Array<[string, object]> = [
    [`settlements/${doc.id}/payment-quote`, { amount: '1', expectedVersion: v.version }],
    [`settlements/${doc.id}/payments`, made.body],
    [`settlements/${doc.id}/funding`, { requestKey: key(), expectedVersion: v.version, reference: '核实' }],
    [
      `settlements/${doc.id}/payments/${made.id}/action`,
      { requestKey: key(), expectedVersion: v.version, action: 'cancel', reason: '测试' },
    ],
    [
      `settlements/${doc.id}/payment-links/preview`,
      { withdrawalId: made.id, allocations: [{ sourceId, amount: '1' }] },
    ],
    [
      `settlements/${doc.id}/payment-links`,
      {
        withdrawalId: made.id,
        allocations: [{ sourceId, amount: '1' }],
        expectedVersion: v.version,
        requestKey: key(),
      },
    ],
    [`settlements/${doc.id}/payments/${made.id}/comments`, { body: '测试留言', requestKey: key() }],
  ];
  for (const actor of ['3', '4', '6']) {
    for (const path of reads) expect((await get(path, owner, actor)).status, path).toBe(403);
    for (const [path, body] of writes) expect((await post(path, { ...owner, ...body }, actor)).status, path).toBe(403);
  }
  for (const path of reads) expect((await get(path, { ...owner, leaderId: '5' })).status, path).toBe(404);
  expect((await get(reads[0], { ...owner, projectId: '2' })).status).toBe(403);
});

it('cancellation releases funds and quota; failure retries preserve one reservation', async () => {
  const doc = await setup('500');
  await open(doc.id);
  const made = await create(doc.id, '500');
  await action(doc.id, made.id, 'failed');
  let view = await overview(doc.id);
  expect(view.totals.processingAmount).toBe('500.0000');
  expect(view.policy.remainingAmount).toBe('0.0000');
  expect(view.paymentStatus).toBe('needs_review');
  expect((await post(`finance/withdrawals/${made.id}/review`, { ...base, action: 'approve' })).status).toBe(409);
  await action(doc.id, made.id, 'retry');
  await action(doc.id, made.id, 'cancel');
  view = await overview(doc.id);
  expect(view.totals.availableAmount).toBe('500.0000');
  expect(view.policy.remainingAmount).toBe('500.0000');
  const replacement = await create(doc.id, '500');
  await pay(replacement.id, replacement.quoted);
  expect(
    (
      await post(`settlements/${doc.id}/payments/${replacement.id}/action`, {
        ...owner,
        action: 'cancel',
        expectedVersion: (await overview(doc.id)).version,
        requestKey: key(),
        reason: '不可取消已付款',
      })
    ).status,
  ).toBe(409);
  const row = (await overview(doc.id)).payments.find(
    (w: { withdrawalId: string }) => w.withdrawalId === replacement.id,
  );
  const voided = await post(`finance/withdrawals/${replacement.id}/correct`, {
    ...base,
    action: 'void',
    expectedVersion: row.paymentVersion,
    requestKey: key(),
    reason: '已核实原付款登记错误',
  });
  expect(voided.status, voided.text).toBe(200);
  view = await overview(doc.id);
  expect(view.totals.processingAmount).toBe('500.0000');
  expect(view.totals.paidGrossAmount).toBe('0.0000');
});

it('serializes new staff payments against member withdrawal and overlapping settlements', async () => {
  const doc = await setup('100');
  await open(doc.id);
  const quoted = await quote(doc.id, '100');
  const oldQuote = await get('finance/withdrawal-quote', { ...base, amount: '100' }, '4');
  expect(oldQuote.status, oldQuote.text).toBe(200);
  const staff = {
    ...owner,
    requestKey: key(),
    amount: '100',
    expectedVersion: quoted.expectedVersion,
    quoteToken: quoted.quoteToken,
    policyVersion: quoted.policyVersion,
    receiverName: '测试',
    payMethod: 'bank',
    payAccount: 'TEST',
  };
  const member = {
    ...base,
    requestKey: key(),
    amount: '100',
    quoteToken: oldQuote.body.data.quoteToken,
    policyVersion: oldQuote.body.data.policyVersion,
    receiverName: '测试',
    payMethod: 'bank',
    payAccount: 'TEST',
  };
  const responses = await Promise.all([
    post(`settlements/${doc.id}/payments`, staff),
    post('finance/withdrawals', member, '4'),
  ]);
  expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  expect(responses.every((r) => [201, 409, 422].includes(r.status))).toBe(true);
  const [sum] = await q(
    "SELECT CAST(SUM(amount) AS CHAR) amount FROM opc_withdrawals WHERE user_id=4 AND status IN ('pending','approved','paid')",
  );
  expect(sum.amount).toBe('100.0000');
  if (responses[0].status === 201) {
    const [stored] = await q('SELECT * FROM opc_settlements WHERE id=?', [doc.id]);
    const duplicate = await c.query<mysql.ResultSetHeader>(
      `INSERT INTO opc_settlements(module_id,project_id,account_id,leader_id,business_from,business_to,metric_type,preview_version,status,document_json,selection_json,created_by,confirmed_by,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(3))`,
      [
        stored.module_id,
        stored.project_id,
        stored.account_id,
        stored.leader_id,
        stored.business_from,
        stored.business_to,
        stored.metric_type,
        stored.preview_version,
        stored.status,
        JSON.stringify({ ...stored.document_json, id: 'temp' }),
        JSON.stringify(stored.selection_json),
        stored.created_by,
        stored.confirmed_by,
      ],
    );
    const did = String(duplicate[0].insertId);
    await c.query("UPDATE opc_settlements SET document_json=JSON_SET(document_json,'$.id',?) WHERE id=?", [did, did]);
    expect((await overview(did)).totals.availableAmount).toBe('0.0000');
  }
});

it('explicitly links legacy payment, saves exact net allocations and audits a corrected link', async () => {
  const doc = await setup('60', { amount: '40' });
  await open(doc.id);
  const oldQuote = await get('finance/withdrawal-quote', { ...base, amount: '80' }, '4');
  const old = await post(
    'finance/withdrawals',
    {
      ...base,
      amount: '80',
      requestKey: key(),
      policyVersion: oldQuote.body.data.policyVersion,
      quoteToken: oldQuote.body.data.quoteToken,
      receiverName: '测试',
      payMethod: 'bank',
      payAccount: 'TEST',
    },
    '4',
  );
  expect(old.status, old.text).toBe(201);
  const wid = old.body.data.id;
  await pay(wid, oldQuote.body.data);
  let view = await overview(doc.id);
  expect(view.totals.legacyUnallocatedAmount).toBe('80.0000');
  expect(view.totals.paidGrossAmount).toBe('0.0000');
  expect(view.totals.availableAmount).toBe('0.0000');
  const sources = view.sources;
  const allocations = [
    { sourceId: sources[0].sourceId, amount: '60' },
    { sourceId: sources[1].sourceId, amount: '20' },
  ];
  const p = await post(`settlements/${doc.id}/payment-links/preview`, { ...owner, withdrawalId: wid, allocations });
  expect(p.status, p.text).toBe(200);
  const input = { ...owner, withdrawalId: wid, allocations, expectedVersion: p.body.data.version, requestKey: key() };
  expect((await post(`settlements/${doc.id}/payment-links`, input)).status).toBe(200);
  expect((await post(`settlements/${doc.id}/payment-links`, input)).status).toBe(200);
  view = await overview(doc.id);
  expect(view.totals.paidGrossAmount).toBe('80.0000');
  expect(view.totals.paidNetAmount).toBe('79.2000');
  expect(view.totals.availableAmount).toBe('20.0000');
  const corrected = [
    { sourceId: sources[0].sourceId, amount: '40' },
    { sourceId: sources[1].sourceId, amount: '40' },
  ];
  const p2 = await post(`settlements/${doc.id}/payment-links/preview`, {
    ...owner,
    withdrawalId: wid,
    allocations: corrected,
  });
  expect(p2.status, p2.text).toBe(200);
  expect(
    (
      await post(`settlements/${doc.id}/payment-links`, {
        ...owner,
        withdrawalId: wid,
        allocations: corrected,
        expectedVersion: p2.body.data.version,
        requestKey: key(),
      })
    ).status,
  ).toBe(200);
  const events = await q('SELECT event_type FROM opc_settlement_payment_events WHERE withdrawal_id=?', [wid]);
  expect(events).toHaveLength(2);
  const history = await get(`finance/withdrawals/${wid}/history`, base);
  expect(history.status, history.text).toBe(200);
  expect(history.body.data.settlementEvents.map((e: { action: string }) => e.action)).toEqual(['link', 'link']);
  expect((await get(`finance/withdrawals/${wid}/history`, base, '4')).body.data.settlementEvents).toEqual([]);
  expect(
    (await q('SELECT status,CAST(amount AS CHAR) amount FROM opc_withdrawals WHERE id=?', [wid]))[0],
  ).toMatchObject({ status: 'paid', amount: '80.0000' });
});

it('blocks approval and payment when a linked source changes even if other balances cover it', async () => {
  const doc = await setup('100');
  await open(doc.id);
  const made = await create(doc.id, '100');
  await post(`finance/withdrawals/${made.id}/review`, { ...base, action: 'approve' });
  const date = '2026-10-' + String(sequence).padStart(2, '0');
  await write(source('payment-' + sequence, date, '10', '4', '2'));
  await tx((conn) => earnings.confirmEarningSource(conn, admin, base, 'payment-' + sequence, '2'));
  const other = await setup('1000');
  await open(other.id);
  const refused = await post(`finance/withdrawals/${made.id}/pay`, {
    ...base,
    paidOn: '2026-10-01',
    acknowledged: true,
    netAmount: made.quoted.netAmount,
    policyVersion: made.quoted.policyVersion,
    requestKey: key(),
  });
  expect(refused.status, refused.text).toBe(409);
  const view = await overview(doc.id);
  expect(view.paymentStatus).toBe('needs_review');
  expect(view.sources[0].originalConfirmedAmount).toBe('100.0000');
  expect(view.sources[0].currentConfirmedAmount).toBe('10.0000');
  expect(view.sources[0].correctionAmount).toBe('-90.0000');
});

it('exports all scope rows including blocked and neutralizes spreadsheet formulas', async () => {
  const date = '2026-10-' + String(++sequence).padStart(2, '0');
  await write(source('export-ready', date, '10', '4'));
  await write({ ...source('export-blocked', date, null, '4'), taskName: '=HYPERLINK("malicious")' });
  for (let i = 1; i <= 28; i++) await write(source('export-row-' + i, date, '1', '4'));
  const doc = await preview(scope(date));
  expect((await confirm(doc)).status).toBe(200);
  const exported = await get(`settlements/${doc.id}/export`, owner);
  expect(exported.status, exported.text).toBe(200);
  expect(exported.text).toContain('export-ready');
  expect(exported.text).toContain('export-row-28');
  expect(exported.text).toContain("'=HYPERLINK");
  expect(exported.text).toContain('待处理');
  expect(exported.text).toContain('计价资料待补');
});

it('keeps payment comments finance-only, persistent and idempotent, and locates deep links', async () => {
  const doc = await setup('10');
  await open(doc.id);
  const first = await create(doc.id, '1'),
    second = await create(doc.id, '1');
  const input = { ...owner, body: '已核对收款资料', requestKey: key() };
  const path = `settlements/${doc.id}/payments/${second.id}/comments`;
  const added = await post(path, input),
    again = await post(path, input);
  expect(added.status, added.text).toBe(201);
  expect(again.body.data.id).toBe(added.body.data.id);
  expect((await get(path, owner)).body.data.total).toBe(1);
  const deep = await get(`settlements/${doc.id}/payments`, { ...owner, withdrawalId: second.id, pageSize: 1 });
  expect(deep.status, deep.text).toBe(200);
  expect(deep.body.data.page).toBe(2);
  expect(deep.body.data.payments[0].withdrawalId).toBe(second.id);
  expect((await get(`settlements/${doc.id}/payments`, { ...owner, withdrawalId: '999999' })).status).toBe(404);
  expect(first.id).not.toBe(second.id);
});

it('serializes account-wide quota across projects for staff and member applications', async () => {
  const doc = await setup('500');
  await open(doc.id);
  const quoted = await quote(doc.id, '500');
  const second = { ...base, projectId: '2', accountId: '2' };
  await c.query('INSERT IGNORE INTO project_members(project_id,user_id) VALUES(2,4)');
  const finance = await import('../../src/core/finance');
  await tx((conn) =>
    finance.syncIncome(conn, admin, second, {
      sourceKey: 'second-project-income',
      version: '1',
      date: '2026-10-01',
      description: '第二项目收入',
      allocations: [{ userId: '4', amount: '500' }],
      total: '500',
    }),
  );
  const f = await get('finance', second);
  expect(f.status, f.text).toBe(200);
  const release = await post('finance/funding', { ...second, hash: f.body.data.funding.hash, reference: '测试到款' });
  expect(release.status, release.text).toBe(200);
  const oldQuote = await get('finance/withdrawal-quote', { ...second, amount: '500' }, '4');
  expect(oldQuote.status, oldQuote.text).toBe(200);
  const responses = await Promise.all([
    post(`settlements/${doc.id}/payments`, {
      ...owner,
      requestKey: key(),
      amount: '500',
      expectedVersion: quoted.expectedVersion,
      quoteToken: quoted.quoteToken,
      policyVersion: quoted.policyVersion,
      receiverName: '测试',
      payMethod: 'bank',
      payAccount: 'TEST',
    }),
    post(
      'finance/withdrawals',
      {
        ...second,
        requestKey: key(),
        amount: '500',
        policyVersion: oldQuote.body.data.policyVersion,
        quoteToken: oldQuote.body.data.quoteToken,
        receiverName: '测试',
        payMethod: 'bank',
        payAccount: 'TEST',
      },
      '4',
    ),
  ]);
  expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  expect(responses.every((r) => [201, 409, 422].includes(r.status))).toBe(true);
  expect((await overview(doc.id)).policy.todayAmount).toBe('500.0000');
});

it('rejects stale quote, ineligible recipient and sub-cent application without reserving money', async () => {
  const doc = await setup('50');
  await open(doc.id);
  const quoted = await quote(doc.id, '20');
  await create(doc.id, '1');
  const stale = await post(`settlements/${doc.id}/payments`, {
    ...owner,
    requestKey: key(),
    amount: '20',
    expectedVersion: quoted.expectedVersion,
    quoteToken: quoted.quoteToken,
    policyVersion: quoted.policyVersion,
    receiverName: '测试',
    payMethod: 'bank',
    payAccount: 'TEST',
  });
  expect(stale.status, stale.text).toBe(409);
  const v = await overview(doc.id);
  expect(
    (await post(`settlements/${doc.id}/payment-quote`, { ...owner, amount: '0.001', expectedVersion: v.version }))
      .status,
  ).toBe(422);
  await c.query('UPDATE users SET is_active=0 WHERE id=4');
  const inactive = await overview(doc.id);
  expect(inactive.totals.availableAmount).toBe('0.0000');
  expect(inactive.blockers.some((b: { kind: string }) => b.kind === 'recipient')).toBe(true);
  expect(
    (await post(`settlements/${doc.id}/payment-quote`, { ...owner, amount: '1', expectedVersion: inactive.version }))
      .status,
  ).toBe(409);
  await c.query('UPDATE users SET is_active=1 WHERE id=4');
  expect((await overview(doc.id)).totals.processingAmount).toBe('1.0000');
});

it('retains historical fee, invoice obligation and deadlines when associating an old payment', async () => {
  const doc = await setup('600');
  await open(doc.id);
  const [insert] = await c.query<mysql.ResultSetHeader>(
    `INSERT INTO opc_withdrawals(module_id,project_id,account_id,user_id,amount,request_key,request_hash,receiver_name,pay_method,pay_account) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [base.moduleId, base.projectId, base.accountId, '4', '600', key(), 'a'.repeat(64), '测试', 'bank', 'TEST'],
  );
  const wid = String(insert.insertId);
  await c.query(
    `INSERT INTO opc_withdrawal_terms(withdrawal_id,user_id,applied_day,policy_version,applicant_role,fee_amount,net_amount,tier,review_deadline,settlement_deadline,settlement_month,invoice_required,terms_json) VALUES(?,4,'2026-10-01','historic-v1','leader',6,594,'large','2026-10-23','2026-11-30','2026-11',1,?)`,
    [wid, JSON.stringify({ historic: true })],
  );
  const before = await q('SELECT * FROM opc_withdrawal_terms WHERE withdrawal_id=?', [wid]);
  const allocations = [{ sourceId: doc.items[0].record.id, amount: '600' }];
  const pre = await post(`settlements/${doc.id}/payment-links/preview`, { ...owner, withdrawalId: wid, allocations });
  expect(pre.status, pre.text).toBe(200);
  const linked = await post(`settlements/${doc.id}/payment-links`, {
    ...owner,
    withdrawalId: wid,
    allocations,
    expectedVersion: pre.body.data.version,
    requestKey: key(),
  });
  expect(linked.status, linked.text).toBe(200);
  expect(await q('SELECT * FROM opc_withdrawal_terms WHERE withdrawal_id=?', [wid])).toEqual(before);
  const review = await post(`finance/withdrawals/${wid}/review`, { ...base, action: 'approve' });
  expect(review.status, review.text).toBe(200);
  const refused = await post(`finance/withdrawals/${wid}/pay`, {
    ...base,
    acknowledged: true,
    paidOn: '2026-10-01',
    netAmount: '594',
    policyVersion: 'historic-v1',
    requestKey: key(),
  });
  expect(refused.status, refused.text).toBe(409);
  expect(refused.body.message).toContain('发票');
  const row = (await overview(doc.id)).payments[0];
  expect(row.invoiceRequired).toBe(true);
  expect(row.policyVersion).toBe('historic-v1');
  expect(row.settlementDeadline).toBe('2026-11-30');
});

it('limits overlapping settlement documents by the same source allocations', async () => {
  const first = await setup('100');
  await open(first.id);
  const date = '2026-10-' + String(sequence).padStart(2, '0');
  await write(source('overlap-extra', date, '5', '4'));
  const second = await preview(scope(date));
  expect((await confirm(second)).status).toBe(200);
  await open(second.id);
  const a = await create(first.id, '100');
  const v = await overview(second.id);
  expect(v.totals.confirmedAmount).toBe('105.0000');
  expect(v.totals.availableAmount).toBe('5.0000');
  expect(
    (await post(`settlements/${second.id}/payment-quote`, { ...owner, amount: '6', expectedVersion: v.version }))
      .status,
  ).toBe(409);
  const b = await create(second.id, '5');
  expect(a.id).not.toBe(b.id);
  expect((await overview(first.id)).totals.processingAmount).toBe('100.0000');
  expect((await overview(second.id)).totals.processingAmount).toBe('105.0000');
  expect(
    (
      await q(
        "SELECT CAST(SUM(amount) AS CHAR) amount FROM opc_withdrawals WHERE status IN ('pending','approved','paid')",
      )
    )[0].amount,
  ).toBe('105.0000');
});

it('rejects excessive legacy association and allows audited unlink from a blocked source', async () => {
  const doc = await setup('40');
  await open(doc.id);
  const oldQuote = await get('finance/withdrawal-quote', { ...base, amount: '40' }, '4');
  const old = await post(
    'finance/withdrawals',
    {
      ...base,
      amount: '40',
      requestKey: key(),
      policyVersion: oldQuote.body.data.policyVersion,
      quoteToken: oldQuote.body.data.quoteToken,
      receiverName: '测试',
      payMethod: 'bank',
      payAccount: 'TEST',
    },
    '4',
  );
  expect(old.status, old.text).toBe(201);
  const wid = old.body.data.id,
    sourceId = doc.items[0].record.id;
  expect(
    (
      await post(`settlements/${doc.id}/payment-links/preview`, {
        ...owner,
        withdrawalId: wid,
        allocations: [{ sourceId, amount: '41' }],
      })
    ).status,
  ).toBe(409);
  const allocations = [{ sourceId, amount: '40' }];
  const previewLink = await post(`settlements/${doc.id}/payment-links/preview`, {
    ...owner,
    withdrawalId: wid,
    allocations,
  });
  expect(
    (
      await post(`settlements/${doc.id}/payment-links`, {
        ...owner,
        withdrawalId: wid,
        allocations,
        expectedVersion: previewLink.body.data.version,
        requestKey: key(),
      })
    ).status,
  ).toBe(200);
  await c.query("UPDATE opc_earning_sources SET blocked_reason='待核实' WHERE id=?", [sourceId]);
  const cleared = [{ sourceId, amount: '0' }];
  const removal = await post(`settlements/${doc.id}/payment-links/preview`, {
    ...owner,
    withdrawalId: wid,
    allocations: cleared,
  });
  expect(removal.status, removal.text).toBe(200);
  expect(
    (
      await post(`settlements/${doc.id}/payment-links`, {
        ...owner,
        withdrawalId: wid,
        allocations: cleared,
        expectedVersion: removal.body.data.version,
        requestKey: key(),
      })
    ).status,
  ).toBe(200);
  const v = await overview(doc.id);
  expect(v.totals.legacyUnallocatedAmount).toBe('40.0000');
  expect(v.totals.availableAmount).toBe('0.0000');
  expect(await q('SELECT id FROM opc_settlement_payment_events WHERE withdrawal_id=?', [wid])).toHaveLength(2);
});

it('exports expected payment separately from paid amounts and exposes the actual recording staff', async () => {
  const doc = await setup('30');
  await open(doc.id);
  const made = await create(doc.id, '10');
  const fields = async () => {
    const output = await get(`settlements/${doc.id}/export`, owner);
    expect(output.status, output.text).toBe(200);
    return output.text
      .split('\r\n')
      .find((line: string) => line.startsWith('"' + made.id + '",'))!
      .slice(1, -1)
      .split('","');
  };
  let row = await fields();
  expect(row[4]).toBe('0.0000');
  expect(row[6]).toBe('0.0000');
  expect(row[11]).toBe('9.9000');
  expect(row[12]).toBe('9.9000');
  const processing = await get(`settlements/${doc.id}/payments`, { ...owner, paymentView: 'processing', pageSize: 1 });
  expect(processing.status, processing.text).toBe(200);
  expect(processing.body.data.total).toBe(1);
  expect(processing.body.data.totals.confirmedAmount).toBe('30.0000');
  expect((await get(`settlements/${doc.id}/payments`, { ...owner, paymentView: 'paid' })).body.data.total).toBe(0);
  await pay(made.id, made.quoted);
  row = await fields();
  expect(row[4]).toBe('9.9000');
  expect(row[6]).toBe('9.9000');
  expect(row[11]).toBe('0.0000');
  expect((await overview(doc.id)).payments[0].paidByName).toBe('人员2');
  expect((await get(`settlements/${doc.id}/payments`, { ...owner, paymentView: 'paid' })).body.data.total).toBe(1);
  expect((await get(`settlements/${doc.id}/payments`, { ...owner, paymentView: 'processing' })).body.data.total).toBe(
    0,
  );
  const direct = await get(`settlements/${doc.id}/payments`, {
    ...owner,
    paymentView: 'processing',
    withdrawalId: made.id,
  });
  expect(direct.status, direct.text).toBe(200);
  expect(direct.body.data.payments[0].withdrawalId).toBe(made.id);
});

it('continues an overlapping payment from its displayed context and preserves original provenance', async () => {
  const first = await setup('100');
  await open(first.id);
  const made = await create(first.id, '10');
  const date = '2026-10-' + String(sequence).padStart(2, '0');
  await write(source('overlap-actions', date, '5', '4'));
  const second = await preview(scope(date));
  expect((await confirm(second)).status).toBe(200);
  await open(second.id);
  await action(second.id, made.id, 'failed');
  const view = await overview(second.id);
  const retry = await post(`settlements/${second.id}/payments/${made.id}/action`, {
    ...owner,
    action: 'retry',
    expectedVersion: view.version,
    requestKey: key(),
    reason: '',
  });
  expect(retry.status, retry.text).toBe(200);
  const [event] = await q(
    "SELECT CAST(settlement_id AS CHAR) settlement_id,reason,after_json FROM opc_settlement_payment_events WHERE withdrawal_id=? AND event_type='retry'",
    [made.id],
  );
  expect(event.settlement_id).toBe(first.id);
  expect(event.reason).toBe('核对后继续原付款办理');
  expect(event.after_json.openedFromSettlementId).toBe(second.id);
  const next = await overview(second.id);
  expect(
    (
      await post(`settlements/${second.id}/payments/${made.id}/action`, {
        ...owner,
        action: 'cancel',
        expectedVersion: next.version,
        requestKey: key(),
        reason: '',
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await post(`settlements/${second.id}/payments/${made.id}/action`, {
        ...owner,
        action: 'failed',
        expectedVersion: next.version,
        requestKey: key(),
        reason: '',
      })
    ).status,
  ).toBe(422);
  const unrelated = await setup('1');
  expect(
    (
      await post(`settlements/${unrelated.id}/payments/${made.id}/action`, {
        ...owner,
        action: 'cancel',
        expectedVersion: (await overview(unrelated.id)).version,
        requestKey: key(),
        reason: '不可跨记录',
      })
    ).status,
  ).toBe(404);
  await action(second.id, made.id, 'cancel');
  expect((await overview(first.id)).totals.processingAmount).toBe('0.0000');
});

it('routes legacy-payment reminders to the precise thread and retains it after association removal', async () => {
  const doc = await setup('30');
  await open(doc.id);
  const oldQuote = await get('finance/withdrawal-quote', { ...base, amount: '10' }, '4');
  const made = await post(
    'finance/withdrawals',
    {
      ...base,
      amount: '10',
      requestKey: key(),
      policyVersion: oldQuote.body.data.policyVersion,
      quoteToken: oldQuote.body.data.quoteToken,
      receiverName: '测试',
      payMethod: 'bank',
      payAccount: 'TEST',
    },
    '4',
  );
  expect(made.status, made.text).toBe(201);
  const wid = made.body.data.id,
    sourceId = doc.items[0].record.id;
  async function link(value: string) {
    const allocations = [{ sourceId, amount: value }],
      p = await post(`settlements/${doc.id}/payment-links/preview`, { ...owner, withdrawalId: wid, allocations });
    expect(p.status, p.text).toBe(200);
    expect(
      (
        await post(`settlements/${doc.id}/payment-links`, {
          ...owner,
          withdrawalId: wid,
          allocations,
          requestKey: key(),
          expectedVersion: p.body.data.version,
        })
      ).status,
    ).toBe(200);
  }
  await link('10');
  const path = `settlements/${doc.id}/payments/${wid}/comments`;
  const added = await post(path, { ...owner, body: '核对原付款资料，不在提醒泄漏正文', requestKey: key() }, '1');
  expect(added.status, added.text).toBe(201);
  async function checkReminder() {
    const reminders = await get('reminders', { state: 'all', pageSize: 100 });
    expect(reminders.status, reminders.text).toBe(200);
    const row = reminders.body.data.list.find((r: { id: string }) => r.id === 'comment:' + added.body.data.id);
    expect(row).toBeTruthy();
    const params = new URL(row.path, 'http://local').searchParams;
    expect(params.get('settlementId')).toBe(doc.id);
    expect(params.get('withdrawalId')).toBe(wid);
    expect(params.get('leaderId')).toBe(owner.leaderId);
    expect(row.title).toContain('人员4');
    expect(JSON.stringify(row)).not.toContain('不在提醒泄漏正文');
  }
  await checkReminder();
  await link('0');
  await checkReminder();
  const comments = await get(path, owner);
  expect(comments.status, comments.text).toBe(200);
  expect(comments.body.data.list.some((r: { id: string }) => r.id === added.body.data.id)).toBe(true);
  const deep = await get(`settlements/${doc.id}/payments`, { ...owner, withdrawalId: wid });
  expect(deep.status, deep.text).toBe(200);
  expect(deep.body.data.payments.find((w: { withdrawalId: string }) => w.withdrawalId === wid).allocatedAmount).toBe(
    '0.0000',
  );
  expect((await get(path, owner, '3')).status).toBe(403);
});
