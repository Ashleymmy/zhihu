import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { Router, type Express } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { EvidenceRow, ModuleManifest } from '../../src/core/contracts';

let container: StartedMySqlContainer, c: mysql.Connection, app: Express, pool: typeof import('../../src/db').db;
const headers: Record<string, Record<string, string>> = {};
let evidenceReady = false;
function evidenceRow(): EvidenceRow {
  const check = { status: 'ready' as const, reason: '已核实', sourceRefs: [] };
  return {
    key: {
      projectId: '1',
      accountId: '1',
      channelRef: '8',
      taskRef: '11',
      businessDate: '2026-10-01',
      metricType: 'activation',
    },
    title: '资料',
    official: {
      status: 'ready',
      quantity: '1',
      quantityUnit: '个',
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
      status: evidenceReady ? 'ready' : 'needs_input',
      reason: '核对资料',
      responsibleRole: evidenceReady ? null : 'operations',
      nextAction: null,
      evidenceVersion: 'one',
      lastChangedAt: null,
    },
    finance: { amount: '12345', currency: 'CNY', sourceRefs: [] },
  };
}
const actors = [
  ['1', 'admin', 'all'],
  ['2', 'admin', 'finance'],
  ['3', 'admin', 'operations'],
  ['4', 'leader', 'all'],
  ['5', 'creator', 'all'],
  ['6', 'creator', 'all'],
  ['7', 'operator', 'all'],
] as const;
const manifest: ModuleManifest = {
  id: 'reminder-test',
  name: '提醒测试',
  version: '1',
  contractVersion: 2,
  roles: ['admin', 'leader', 'creator', 'operator'],
  permissions: {},
  capabilities: [],
  entryPath: '/tasks',
};
const get = (actor = '2', query: object = {}) =>
  request(app).get('/api/v1/core/reminders').set(headers[actor]).query(query);
const read = (id: string, actor = '2', value = true) =>
  request(app)
    .post('/api/v1/core/reminders/' + encodeURIComponent(id) + '/read')
    .set(headers[actor])
    .send({ read: value });
async function comment(kind = 'evidence', author = '1', context = '11', project = '1', leader: string | null = null) {
  const [result] = await c.query<mysql.ResultSetHeader>(
    `INSERT INTO opc_record_comments(module_id,project_id,account_id,leader_id,context_kind,context_id,channel_ref,business_date,metric_type,author_id,body)
 VALUES('reminder-test',?,1,?,?,?,?,?,?,?,'秘密金额12345及内部留言')`,
    [
      project,
      leader,
      kind,
      context,
      kind === 'evidence' ? '8' : null,
      kind === 'evidence' ? '2026-10-01' : null,
      kind === 'evidence' ? 'activation' : null,
      author,
    ],
  );
  return 'comment:' + result.insertId;
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('core_reminders')
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
  for (const [id, role, duty] of actors)
    await c.query('INSERT INTO users(id,username,password_hash,role,admin_duty,display_name) VALUES(?,?,?,?,?,?)', [
      id,
      'r' + id,
      'unused',
      role,
      duty,
      '人员' + id,
    ]);
  await c.query("INSERT INTO projects(id,name,slug) VALUES(1,'一','remind-one'),(2,'二','remind-two')");
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,4),(1,5),(1,6)');
  await c.query("INSERT INTO module_installations(module_id,version) VALUES('reminder-test','1')");
  await c.query(
    "INSERT INTO integration_accounts(id,module_id,account_key,name) VALUES(1,'reminder-test','one','来源')",
  );
  await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(1,1)');
  await c.query(`INSERT INTO opc_settlements(id,module_id,project_id,account_id,leader_id,business_from,business_to,preview_version,status,document_json,selection_json,created_by)
 VALUES(1,'reminder-test',1,1,4,'2026-10-01','2026-10-01',REPEAT('a',64),'confirmed','{}','[]',1)`);
  ({ db: pool } = await import('../../src/db'));
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    runtime = new ModuleRuntime([manifest]);
  runtime.register({
    manifest,
    router: Router(),
    settlementProvider: {
      lock: async () => {},
      inspect: async () => [],
      confirm: async () => {},
      context: async () => ({
        coverage: { status: 'no_performance', message: '' },
        unresolvedContext: { records: 0, reason: '', next: '', nextAction: null },
      }),
    },
    dataProvider: {
      summary: async (s) => ({ ...s, moduleId: manifest.id, status: 'empty', metrics: [], updatedAt: '' }),
      evidenceInTransaction: async (_c, s, _u, f) => ({
        moduleId: manifest.id,
        ...s,
        status: 'ready',
        list: [evidenceRow()],
        total: 1,
        page: f.page ?? 1,
        pageSize: f.pageSize ?? 1,
        limits: { maxDays: 31, maxPageSize: 100 },
      }),
    },
  });
  app = (await import('../../src/core/app')).createCoreApp(runtime);
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions'),
    { signToken } = await import('../../src/auth/jwt');
  for (const [id, role, adminDuty] of actors) {
    const client = 'reminder-client-' + id,
      session = await issueRefreshSession(id, { type: 'web', id: client });
    headers[id] = {
      'X-Client-Id': client,
      Authorization:
        'Bearer ' +
        (await signToken({
          id,
          role,
          adminDuty,
          username: 'r' + id,
          displayName: '人员',
          parentId: null,
          sessionId: session.familyId,
        })),
    };
  }
}, 90000);
beforeEach(async () => {
  evidenceReady = false;
  await c.query('DELETE FROM opc_reminder_reads');
  await c.query('DELETE FROM opc_record_comments');
  await c.query('DELETE FROM opc_settlement_payment_events');
  await c.query('DELETE FROM opc_settlement_payment_allocations');
  await c.query('DELETE FROM opc_settlement_payment_origins');
  await c.query('DELETE FROM opc_withdrawals');
  await c.query('UPDATE projects SET is_enabled=1');
  await c.query("UPDATE integration_accounts SET status='active'");
  await c.query('UPDATE project_members SET left_at=NULL');
  await c.query("UPDATE users SET admin_duty='finance',is_active=1 WHERE id=2");
});
afterAll(async () => {
  await pool?.end();
  await c?.end();
  await container?.stop({ remove: true, removeVolumes: true });
});

it('denies anonymous list/read and prevents recipient or URL injection', async () => {
  expect((await request(app).get('/api/v1/core/reminders')).status).toBe(401);
  expect((await request(app).post('/api/v1/core/reminders/comment%3A1/read').send({ read: true })).status).toBe(401);
  expect((await get('2', { userId: '5' })).status).toBe(422);
  const id = await comment();
  expect(
    (
      await request(app)
        .post('/api/v1/core/reminders/' + encodeURIComponent(id) + '/read')
        .set(headers['2'])
        .send({ read: true, userId: '5' })
    ).status,
  ).toBe(422);
});
it('filters financial comments in SQL before counts and paginates full evidence context', async () => {
  const business = await comment(),
    finance = await comment('settlement', '1', '1', '1', '4');
  await comment('evidence', '3');
  const result = await get('3', { pageSize: 1 });
  expect(result.status, result.text).toBe(200);
  expect(result.body.data.total).toBe(1);
  expect(result.body.data.unread).toBe(1);
  expect(result.body.data.list[0].id).toBe(business);
  expect(result.body.data.list[0].path).toContain('/dashboard?');
  expect(result.body.data.list[0].path).toContain('channelRef=8');
  expect(result.body.data.list[0].path).toContain('taskRef=11');
  expect(result.body.data.list[0].path).toContain('businessDate=2026-10-01');
  expect(result.body.data.list[0].path).toContain('metricType=activation');
  expect(JSON.stringify(result.body)).not.toContain('12345');
  expect(JSON.stringify(result.body)).not.toContain('财务办理');
  expect((await read(finance, '3')).status).toBe(404);
  expect((await read(finance, '7')).status).toBe(404);
  expect((await read(business, '5')).status).toBe(404);
});
it('stores separate idempotent read receipts without marking business handled', async () => {
  const id = await comment();
  const a = await read(id);
  expect(a.status, a.text).toBe(200);
  const b = await read(id);
  expect(b.body.data.readAt).toBe(a.body.data.readAt);
  expect((await get()).body.data.unread).toBe(0);
  expect((await get('3')).body.data.unread).toBe(1);
  const all = (await get('2', { state: 'all' })).body.data;
  expect(all.total).toBe(1);
  expect(all.list[0].handled).toBe(false);
  expect(all.list[0].readAt).not.toBeNull();
  expect((await read(id, '2', false)).status).toBe(200);
  expect((await get()).body.data.unread).toBe(1);
  await read(id);
  await comment();
  expect((await get()).body.data.unread).toBe(1);
});
it('derives completed evidence status independently from read state and never copies provider financial fields', async () => {
  const id = await comment();
  await read(id, '3');
  evidenceReady = true;
  const result = (await get('3', { state: 'all' })).body.data;
  expect(result.list[0].handled).toBe(true);
  expect(result.list[0].readAt).not.toBeNull();
  expect(JSON.stringify(result)).not.toContain('12345');
  await read(id, '3', false);
  expect((await get('3')).body.data.list[0].handled).toBe(true);
});
it('revokes list/count/read access when project, integration or staff duty changes', async () => {
  const id = await comment('settlement', '1', '1', '1', '4');
  await read(id);
  await c.query('UPDATE projects SET is_enabled=0 WHERE id=1');
  expect((await get('2', { state: 'all' })).body.data.total).toBe(0);
  expect((await read(id)).status).toBe(404);
  await c.query('UPDATE projects SET is_enabled=1');
  await c.query("UPDATE integration_accounts SET status='disabled'");
  expect((await get()).body.data.total).toBe(0);
  await c.query("UPDATE integration_accounts SET status='active'");
  await c.query("UPDATE users SET admin_duty='operations' WHERE id=2");
  expect((await get('2', { state: 'all' })).body.data.total).toBe(0);
  expect((await read(id)).status).toBe(404);
});
it('rejects comments whose supplied project is not linked to the source', async () => {
  const id = await comment('evidence', '1', '11', '2');
  expect((await get('3')).body.data.total).toBe(0);
  expect((await read(id, '3')).status).toBe(404);
});
it('shows only own payment events for members and creates a new unread identity after status changes', async () => {
  await c.query(
    "INSERT INTO opc_withdrawals(id,module_id,project_id,account_id,user_id,amount,request_key,request_hash,status) VALUES(1,'reminder-test',1,1,5,10,'remind-pay-1','hash','pending'),(2,'reminder-test',1,1,6,20,'remind-pay-2','hash','pending')",
  );
  const list = await get('5');
  expect(list.status, list.text).toBe(200);
  expect(list.body.data.total).toBe(1);
  const first = list.body.data.list[0];
  expect(first.path).toContain('/income?');
  expect(first.path).toContain('withdrawalId=1');
  const foreign = (await get('6')).body.data.list[0];
  expect((await read(foreign.id, '5')).status).toBe(404);
  expect((await get('4')).body.data.total).toBe(0);
  expect((await get('3')).body.data.total).toBe(0);
  await read(first.id, '5');
  await c.query("UPDATE opc_withdrawals SET status='approved',reviewed_at=NOW(3) WHERE id=1");
  const changed = (await get('5')).body.data;
  expect(changed.unread).toBe(1);
  expect(changed.list[0].id).not.toBe(first.id);
  expect(changed.list[0].handled).toBe(false);
  expect((await read(first.id, '5')).status).toBe(404);
  await c.query("UPDATE opc_withdrawals SET status='paid',paid_at=NOW(3),payment_version=1 WHERE id=1");
  const paid = (await get('5')).body.data.list[0];
  expect(paid.handled).toBe(true);
  expect(paid.readAt).toBeNull();
  await c.query('UPDATE project_members SET left_at=NOW() WHERE user_id=5');
  expect((await get('5')).body.data.total).toBe(0);
  expect((await read(paid.id, '5')).status).toBe(404);
});
it('links financial payment comments and failures to the exact settlement/payment without message content leaks', async () => {
  await c.query(
    "INSERT INTO opc_withdrawals(id,module_id,project_id,account_id,user_id,amount,request_key,request_hash,status) VALUES(1,'reminder-test',1,1,4,10,'remind-failure-1','hash','approved')",
  );
  await c.query(
    "INSERT INTO opc_settlement_payment_origins(withdrawal_id,settlement_id,initiated_by,failure_reason,attempt_version) VALUES(1,1,1,'未完成',1)",
  );
  const id = await comment('withdrawal', '1', '1', '1', '4');
  const all = (await get()).body.data;
  expect(all.total).toBe(2);
  for (const row of all.list) {
    expect(row.path).toContain('settlementId=1');
    expect(row.path).toContain('withdrawalId=1');
    expect(row.path).toContain('leaderId=4');
  }
  expect((await read(id, '4')).status).toBe(404);
  expect((await get('7')).body.data.total).toBe(0);
  const payment = all.list.find((r: { kind: string }) => r.kind === 'payment');
  await read(payment.id);
  await c.query('UPDATE opc_settlement_payment_origins SET attempt_version=2,failure_reason=NULL');
  expect((await get()).body.data.unread).toBe(2);
});
