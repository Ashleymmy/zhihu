import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import type { Express } from 'express';
import type { AuthUser } from '../../src/types';
import { runOpcMigrations } from '../../scripts/opcMigrations';
vi.mock('../../src/modules/zhihu/queue', async (original) => ({
  ...(await original<typeof import('../../src/modules/zhihu/queue')>()),
  enqueue: vi.fn(async () => ({ id: 'isolated' })),
}));
let container: StartedMySqlContainer, c: Connection, pool: typeof import('../../src/db').db, app: Express;
let scope = { projectId: '1', accountId: '' };
const date = '2026-09-14',
  key = () => crypto.randomUUID();
const actor = (sub: string, role: AuthUser['role'], adminDuty: AuthUser['adminDuty'] = 'all'): AuthUser => ({
  sub,
  role,
  adminDuty,
  username: 'legacy_' + sub,
  displayName: '兼容测试',
  parentId: null,
  jti: key(),
});
const admin = actor('1', 'admin'),
  creator = actor('2', 'creator'),
  operations = actor('3', 'admin', 'operations');
const headers: Record<string, Record<string, string>> = {};
const url = '/api/v1/modules/zhihu/workbench';
const period = () => ({ ...scope, from: date, to: date });
const get = (user = admin, version?: '2') =>
  request(app)
    .get(url)
    .set(headers[user.sub])
    .query({ ...period(), ...(version ? { viewVersion: version } : {}) });
const confirm = (hash: string, version?: '2') =>
  request(app)
    .post(url + '/confirm')
    .set(headers[admin.sub])
    .send({
      ...period(),
      reviewHash: hash,
      requestKey: key(),
      acknowledged: true,
      ...(version ? { viewVersion: version } : {}),
    });
const query = async (sql: string, params: unknown[] = []) => (await c.query<RowDataPacket[]>(sql, params))[0];
const csv = (text: string) => {
  const buffer = Buffer.from(text);
  return { buffer, size: buffer.length, originalname: '兼容测试.csv', mimetype: 'text/csv' };
};
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('legacy_bills_test')
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
    ZHIHU_ACTIVATION_ENABLED: 'true',
  });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  for (const u of [admin, creator, operations])
    await c.query('INSERT INTO users(id,username,password_hash,role,display_name,admin_duty) VALUES(?,?,?,?,?,?)', [
      u.sub,
      u.username,
      'unused',
      u.role,
      u.displayName,
      u.adminDuty,
    ]);
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2)');
  scope.accountId = String((await query('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
  await c.query(
    "INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'legacy-channel',1,'兼容渠道')",
  );
  await c.query(
    "INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'legacy-task','兼容活动',NOW())",
  );
  const resources = await import('../../src/modules/zhihu/attribution/resources'),
    pricing = await import('../../src/modules/zhihu/attribution/pricing'),
    statements = await import('../../src/modules/zhihu/attribution/statements'),
    workbench = await import('../../src/modules/zhihu/attribution/workbench');
  pool = (await import('../../src/db')).db;
  const mapping = await resources.createMapping(admin, scope, key(), { channelId: '1', name: '兼容渠道', from: date });
  const price = await pricing.draftPrice(admin, scope, key(), {
    taskId: '1',
    payeeId: '2',
    unitPrice: '8',
    from: date,
    reason: '隔离验证',
  });
  await pricing.publishPrice(admin, scope, price.id, key());
  const word = await resources.createKeyword(admin, scope, key(), {
    keyword: '兼容关键词',
    taskId: '1',
    mappingId: mapping.id,
    landingUrl: 'https://example.com/book',
    popularizeType: 1,
  });
  await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id='legacy-plan' WHERE id=?", [
    word.planId,
  ]);
  await resources.synchronizeKeywords(scope);
  const binding = await resources.distribute(admin, scope, word.id, key(), '2');
  await resources.changeBinding(creator, scope, binding.id, key(), { action: 'activate' });
  await c.query('UPDATE zh_keyword_bindings SET activated_on=? WHERE id=?', [date, binding.id]);
  const evidence = await statements.submitEvidence(creator, scope, key(), {
    bindingId: binding.id,
    url: 'https://example.com/work',
    description: '隔离验证',
  });
  await statements.reviewEvidence(admin, scope, evidence.id, key(), true, '已核验');
  await workbench.uploadReport(
    admin,
    scope,
    csv(`日期,渠道名称,关键词,订单量\n${date},兼容渠道,兼容关键词,3\n${date},未知渠道,缺资料词,4`),
  );
  await workbench.uploadReport(
    admin,
    scope,
    csv(`日期,渠道名称,关键词,拉活量,结算金额\n${date},兼容渠道,兼容关键词,5,10`),
    'activation',
  );
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    { zhihuManifest } = await import('../../src/modules/zhihu/manifest'),
    { createZhihuModule } = await import('../../src/modules/zhihu/module'),
    { createCoreApp } = await import('../../src/core/app');
  const runtime = new ModuleRuntime([zhihuManifest]);
  runtime.register(createZhihuModule());
  app = createCoreApp(runtime);
  const { signToken } = await import('../../src/auth/jwt'),
    { issueRefreshSession } = await import('../../src/auth/tokenSessions');
  for (const u of [admin, creator, operations]) {
    const client = 'legacy-bills-client-' + u.sub,
      session = await issueRefreshSession(u.sub, { type: 'web', id: client });
    headers[u.sub] = {
      'X-Client-Id': client,
      Authorization: 'Bearer ' + (await signToken({ ...u, id: u.sub, sessionId: session.familyId })),
    };
  }
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});
it('旧请求只显示拉新金额，缺资料行仍保留而不是显示零', async () => {
  const response = await get();
  expect(response.status, response.text).toBe(200);
  const view = response.body.data;
  expect(view.entries.length).toBeGreaterThan(0);
  expect(view.entries.every((e: any) => e.metricType === 'new_user' && e.amount !== null)).toBe(true);
  expect(view.pendingEntries).toHaveLength(1);
  expect(view.pendingEntries[0]).toMatchObject({ metricType: 'new_user', amount: null, keyword: '缺资料词' });
  expect(view.summary.payable).toBe('24.0000');
  expect(view.summary.byType.activation.quantity).toBe('0');
});
it('新版读取两种业绩，运营岗位对新旧格式都无金额读取权限', async () => {
  const response = await get(admin, '2');
  expect(response.status, response.text).toBe(200);
  expect(new Set(response.body.data.entries.map((e: any) => e.metricType))).toEqual(
    new Set(['new_user', 'activation']),
  );
  expect(response.body.data.summary.byType.activation.payable).toBe('6.0000');
  expect((await get(operations)).status).toBe(403);
  expect((await get(operations, '2')).status).toBe(403);
});
it('新旧核对码不能混用，旧确认只入账已展示的拉新', async () => {
  const old = (await get()).body.data,
    modern = (await get(admin, '2')).body.data;
  expect((await confirm(modern.reviewHash)).status).toBe(409);
  expect((await confirm(old.reviewHash, '2')).status).toBe(409);
  expect(await query('SELECT id FROM opc_income_entries')).toHaveLength(0);
  const accepted = await confirm(old.reviewHash);
  expect(accepted.status, accepted.text).toBe(200);
  expect(accepted.body.data.confirmed).toBe(1);
  expect((await query('SELECT amount FROM opc_income_entries')).map((r) => r.amount)).toEqual(['24.0000']);
  const remaining = (await get(admin, '2')).body.data;
  expect(
    remaining.entries
      .filter((e: any) => e.metricType === 'activation')
      .every((e: any) => e.confirmedAmount === '0.0000'),
  ).toBe(true);
});
it('新版单独确认拉活后，旧请求金额仍为拉新且重复确认不入账', async () => {
  const fresh = (await get(admin, '2')).body.data;
  const accepted = await confirm(fresh.reviewHash, '2');
  expect(accepted.status, accepted.text).toBe(200);
  expect(accepted.body.data.confirmed).toBe(1);
  expect((await query('SELECT amount FROM opc_income_entries ORDER BY id')).map((r) => r.amount)).toEqual([
    '24.0000',
    '6.0000',
  ]);
  const old = (await get()).body.data;
  expect(old.summary.confirmedPayable).toBe('24.0000');
  expect((await confirm(old.reviewHash)).body.data.confirmed).toBe(0);
  expect(await query('SELECT id FROM opc_income_entries')).toHaveLength(2);
});
