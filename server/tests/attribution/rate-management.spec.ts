import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import type { Express } from 'express';
import type { AuthUser } from '../../src/types';
import type { ModuleRuntime } from '../../src/core/module-runtime';
import { runOpcMigrations } from '../../scripts/opcMigrations';
vi.mock('../../src/modules/zhihu/queue', async (original) => ({
  ...(await original<typeof import('../../src/modules/zhihu/queue')>()),
  enqueue: vi.fn(async () => ({ id: 'isolated' })),
}));
let container: StartedMySqlContainer,
  c: Connection,
  pool: typeof import('../../src/db').db,
  app: Express,
  runtime: ModuleRuntime;
let management: typeof import('../../src/core/rate-management');
const key = () => crypto.randomUUID(),
  scope = { projectId: '1', accountId: '' },
  url = '/api/v1/core/rates';
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const future = (n = 5) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
const actor = (sub: string, role: AuthUser['role'], adminDuty: AuthUser['adminDuty'] = 'all'): AuthUser => ({
  sub,
  role,
  adminDuty,
  username: 'rateuser' + sub,
  displayName: '测试人员',
  parentId: null,
  jti: key(),
});
const admin = actor('1', 'admin'),
  creator = actor('2', 'creator'),
  leader = actor('3', 'leader'),
  operations = actor('4', 'admin', 'operations'),
  finance = actor('5', 'admin', 'finance');
const headers: Record<string, Record<string, string>> = {};
const q = async (sql: string, values: unknown[] = []) => (await c.query<RowDataPacket[]>(sql, values))[0];
const get = (user = admin, projectId = '1') =>
  request(app).get(url).set(headers[user.sub]).query({ projectId, moduleId: 'zhihu' });
const post = (input: object, user = admin) => request(app).post(url).set(headers[user.sub]).send(input);
const input = (baseVersion: string, effectiveFrom = future(), metricType = 'new_user') => ({
  projectId: '1',
  moduleId: 'zhihu',
  metricType,
  effectiveFrom,
  baseVersion,
  prices:
    metricType === 'new_user'
      ? { creator: '8.1', leader_self: '8.8', staff_self: '10' }
      : { creator: '1.3', leader_self: '1.7', staff_self: '2' },
});
async function snapshot() {
  const [fact] = await q(
    'SELECT r.snapshot_json FROM zh_metric_facts f JOIN zh_attribution_results r ON r.id=f.current_result_id WHERE f.business_date=?',
    [future(6)],
  );
  return typeof fact.snapshot_json === 'string' ? JSON.parse(fact.snapshot_json) : fact.snapshot_json;
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('rate_management_test')
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
  for (const u of [admin, creator, leader, operations, finance])
    await c.query('INSERT INTO users(id,username,password_hash,role,display_name,admin_duty) VALUES(?,?,?,?,?,?)', [
      u.sub,
      u.username,
      'unused',
      u.role,
      u.displayName,
      u.adminDuty,
    ]);
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3)');
  scope.accountId = String((await q('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
  await c.query(
    "INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'rate-channel',1,'单价测试渠道')",
  );
  await c.query(
    "INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'rate-task','单价测试活动',NOW())",
  );
  const resources = await import('../../src/modules/zhihu/attribution/resources'),
    workbench = await import('../../src/modules/zhihu/attribution/workbench');
  pool = (await import('../../src/db')).db;
  const mapping = await resources.createMapping(admin, scope, key(), {
    channelId: '1',
    name: '单价测试渠道',
    from: day,
  });
  const word = await resources.createKeyword(admin, scope, key(), {
    keyword: '未来单价测试',
    taskId: '1',
    mappingId: mapping.id,
    landingUrl: 'https://example.com/story',
    popularizeType: 1,
  });
  await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id='rate-ready' WHERE id=?", [
    word.planId,
  ]);
  await resources.synchronizeKeywords(scope);
  const binding = await resources.distribute(admin, scope, word.id, key(), creator.sub);
  await resources.changeBinding(creator, scope, binding.id, key(), { action: 'activate' });
  await c.query("UPDATE zh_keyword_bindings SET verification_status='passed',activated_on=? WHERE id=?", [
    day,
    binding.id,
  ]);
  // Seed later business days under an isolated clock, then return to today to
  // verify that future publication never changes already-confirmed entries.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(future(10) + 'T12:00:00+08:00'));
  const body = Buffer.from(
    `日期,渠道名称,关键词,订单量\n${day},单价测试渠道,未来单价测试,3\n${future()},单价测试渠道,未来单价测试,4\n${future(6)},单价测试渠道,未来单价测试,10`,
  );
  await workbench.uploadReport(admin, scope, {
    originalname: 'rates.csv',
    buffer: body,
    size: body.length,
    mimetype: 'text/csv',
  });
  const period = { from: future(), to: future() },
    bill = await workbench.overview(admin, scope, period);
  expect(bill.entries, JSON.stringify(bill)).toHaveLength(1);
  expect(bill.entries[0].ready, JSON.stringify(bill.entries[0])).toBe(true);
  await workbench.confirmBills(admin, scope, period, key(), bill.reviewHash);
  vi.useRealTimers();
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    { zhihuManifest } = await import('../../src/modules/zhihu/manifest'),
    { createZhihuModule } = await import('../../src/modules/zhihu/module'),
    { createCoreApp } = await import('../../src/core/app');
  runtime = new ModuleRuntime([zhihuManifest]);
  runtime.register(createZhihuModule());
  app = createCoreApp(runtime);
  management = await import('../../src/core/rate-management');
  const { signToken } = await import('../../src/auth/jwt'),
    { issueRefreshSession } = await import('../../src/auth/tokenSessions');
  for (const u of [admin, creator, leader, operations, finance]) {
    const client = 'rates-publish-client-' + u.sub,
      session = await issueRefreshSession(u.sub, { type: 'web', id: client });
    headers[u.sub] = {
      'X-Client-Id': client,
      Authorization: 'Bearer ' + (await signToken({ ...u, id: u.sub, sessionId: session.familyId })),
    };
  }
}, 90000);
afterAll(async () => {
  vi.useRealTimers();
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});
it('仅财务和完整管理员可读取和发布；服务层也拒绝越权', async () => {
  expect((await get()).status).toBe(200);
  expect((await get(finance)).status).toBe(200);
  for (const user of [creator, leader, operations]) {
    expect((await get(user)).status).toBe(403);
    expect((await post({}, user)).status).toBe(403);
    await expect(management.listRateVersions(runtime, user, { projectId: '1', moduleId: 'zhihu' })).rejects.toThrow(
      '财务权限',
    );
  }
  expect((await get(admin, '999999')).status).toBe(403);
});
it('未来调价保留旧金额，自动重算未确认行，确认账和公共收入逐行不变', async () => {
  const listed = (await get()).body.data,
    beforeRates = await q('SELECT id,unit_price,effective_from FROM opc_rate_rules ORDER BY id');
  const ledger = await q('SELECT * FROM zh_statement_entries ORDER BY id'),
    income = await q('SELECT * FROM opc_income_entries ORDER BY id');
  expect(ledger.length).toBeGreaterThan(0);
  expect(income.length).toBeGreaterThan(0);
  const confirmed = await q('SELECT * FROM zh_metric_facts WHERE business_date=?', [future()]);
  const oldDay = await q('SELECT * FROM zh_metric_facts WHERE business_date=?', [day]);
  const result = await post(input(listed.baseVersion), finance);
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  expect(result.body.data.recalculated).toBe(1);
  expect((await snapshot()).obligations[0].amount).toBe('81.0000');
  expect(await q('SELECT * FROM zh_statement_entries ORDER BY id')).toEqual(ledger);
  expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(income);
  expect(await q('SELECT * FROM zh_metric_facts WHERE business_date=?', [future()])).toEqual(confirmed);
  expect(await q('SELECT * FROM zh_metric_facts WHERE business_date=?', [day])).toEqual(oldDay);
  expect(
    await q('SELECT id,unit_price,effective_from FROM opc_rate_rules WHERE id IN (?) ORDER BY id', [
      beforeRates.map((r) => r.id),
    ]),
  ).toEqual(beforeRates);
  expect(
    (
      await q(
        "SELECT CAST(unit_price AS CHAR) price FROM opc_rate_rules WHERE metric_type='new_user' AND rule_code='leader_override' ORDER BY id DESC LIMIT 1",
      )
    )[0].price,
  ).toBe('0.7000');
  expect((await post(input(listed.baseVersion))).status).toBe(409);
});
it('拒绝过去日期、无效日期、遗漏字段和负分成，不留下半套价格', async () => {
  const version = (await get()).body.data.baseVersion,
    original = await q('SELECT * FROM opc_rate_rules ORDER BY id');
  for (const patch of [
    { effectiveFrom: day },
    { effectiveFrom: '2026-02-30' },
    { prices: { creator: '9', leader_self: '8.5', staff_self: '10' } },
    { prices: { creator: '1' } },
    { prices: { creator: '1e3', leader_self: '8.5', staff_self: '10' } },
  ]) {
    expect((await post({ ...input(version, future(10)), ...patch })).status).toBe(422);
  }
  expect(await q('SELECT * FROM opc_rate_rules ORDER BY id')).toEqual(original);
});
it('拉活单价独立发布，上游核对价和拉新版本不变', async () => {
  const data = (await get()).body.data,
    before = await q("SELECT * FROM opc_rate_rules WHERE metric_type='new_user' OR rule_code='upstream' ORDER BY id");
  expect(data.earliestFrom.activation).toBe(future(1));
  expect((await post(input(data.baseVersion, future(10), 'activation'))).status).toBe(201);
  expect(
    await q("SELECT * FROM opc_rate_rules WHERE metric_type='new_user' OR rule_code='upstream' ORDER BY id"),
  ).toEqual(before);
  expect(
    (
      await q(
        "SELECT CAST(unit_price AS CHAR) price FROM opc_rate_rules WHERE metric_type='activation' AND rule_code='leader_override' ORDER BY id DESC LIMIT 1",
      )
    )[0].price,
  ).toBe('0.4000');
});
it('模块重算失败时价格关闭、新增和审计一起回滚', async () => {
  const data = (await get()).body.data,
    before = await q('SELECT * FROM opc_rate_rules ORDER BY id'),
    audit = await q("SELECT * FROM audit_logs WHERE action='rates.publish' ORDER BY id");
  const provider = runtime.get('zhihu')!.rateProvider!,
    original = provider.published;
  provider.published = async () => {
    throw Error('isolated recalculation failure');
  };
  try {
    await expect(management.publishRateVersions(runtime, admin, input(data.baseVersion, future(20)))).rejects.toThrow(
      'isolated recalculation failure',
    );
  } finally {
    provider.published = original;
  }
  expect(await q('SELECT * FROM opc_rate_rules ORDER BY id')).toEqual(before);
  expect(await q("SELECT * FROM audit_logs WHERE action='rates.publish' ORDER BY id")).toEqual(audit);
});
it('并发发布只接受一份，另一份得到刷新提示，生效区间不重叠', async () => {
  const data = (await get()).body.data,
    body = input(data.baseVersion, future(30));
  const results = await Promise.all([post(body), post(body, finance)]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const [count] = await q(
    "SELECT COUNT(*) total FROM opc_rate_rules WHERE metric_type='new_user' AND effective_from=?",
    [future(30)],
  );
  expect(Number(count.total)).toBe(4);
});
