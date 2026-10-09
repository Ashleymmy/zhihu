import { afterAll, beforeAll, expect, it } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { Router, type Express } from 'express';
import { readFile } from 'node:fs/promises';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';
import type { ModuleManifest } from '../../src/core/contracts';
import type { EarningSourceInput } from '../../src/core/earnings';
let container: StartedMySqlContainer, c: mysql.Connection, app: Express, emptyApp: Express;
let db: typeof import('../../src/db').db,
  tx: typeof import('../../src/db').withTransaction,
  earnings: typeof import('../../src/core/earnings');
const headers: Record<string, Record<string, string>> = {},
  scope = { moduleId: 'sample-earnings', projectId: '1', accountId: '1' };
const people = [
  { sub: '1', role: 'admin', adminDuty: 'all' },
  { sub: '2', role: 'creator', adminDuty: 'all' },
  { sub: '3', role: 'leader', adminDuty: 'all' },
  { sub: '4', role: 'admin', adminDuty: 'operations' },
  { sub: '5', role: 'creator', adminDuty: 'all' },
] as const;
const admin: AuthUser = {
  ...people[0],
  username: 'user1',
  displayName: '管理员',
  parentId: null,
  jti: 'earnings-test',
};
const manifest: ModuleManifest = {
  id: scope.moduleId,
  name: '示例收益',
  version: '1',
  contractVersion: 2,
  roles: ['admin', 'creator', 'leader'],
  permissions: {},
  capabilities: [],
  entryPath: '/tasks',
};
const q = async (sql: string, args: unknown[] = []) => (await c.query<mysql.RowDataPacket[]>(sql, args))[0];
const input = (sourceKey: string, amount = '16.0000', version = '1'): EarningSourceInput => ({
  sourceKey,
  version,
  date: '2026-10-08',
  taskId: sourceKey,
  taskName: '示例任务 ' + sourceKey,
  metricType: 'sale',
  metricLabel: '成交',
  unit: '单',
  lines: [
    {
      payeeId: '2',
      performerId: '2',
      performerName: '本人',
      ruleCode: 'creator',
      quantity: '2',
      unitPrice: '8.0000',
      amount,
      internal: false,
      ready: true,
      reason: '',
      next: '财务：核对并确认金额',
    },
  ],
});
const write = (value: EarningSourceInput, s = scope) => tx((conn) => earnings.writeEarningLines(conn, s, value));
const confirm = (value: EarningSourceInput, s = scope) =>
  tx((conn) => earnings.confirmEarningSource(conn, admin, s, value.sourceKey, value.version));
const get = (who = '2', extra: object = {}, target = app) =>
  request(target)
    .get('/api/v1/core/earnings/mine')
    .set(headers[who])
    .query({ from: '2026-10-01', to: '2026-10-09', ...extra });
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withCommand(['--log-bin-trust-function-creators=1'])
    .withDatabase('core_earnings')
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
    JWT_SECRET: 'earnings_isolated_secret_over_32_characters',
  });
  delete process.env.DEV_DEMO_AUTH;
  await runOpcMigrations(target, []);
  c = await mysql.createConnection(target);
  for (const person of people)
    await c.query('INSERT INTO users(id,username,password_hash,role,admin_duty,display_name) VALUES(?,?,?,?,?,?)', [
      person.sub,
      'user' + person.sub,
      'unused',
      person.role,
      person.adminDuty,
      '人员' + person.sub,
    ]);
  await c.query(
    "INSERT INTO projects(id,name,slug) VALUES(1,'项目一','one'),(2,'项目二','two'),(3,'他人项目','private')",
  );
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,5),(2,2),(3,5)');
  await c.query("INSERT INTO module_installations(module_id,version) VALUES('sample-earnings','1')");
  await c.query(
    "INSERT INTO integration_accounts(id,module_id,account_key,name,created_by) VALUES(1,'sample-earnings','one','项目一来源',1),(2,'sample-earnings','two','项目二来源',1),(3,'sample-earnings','three','私有来源',1)",
  );
  await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(1,1),(2,2),(3,3)');
  ({ db, withTransaction: tx } = await import('../../src/db'));
  earnings = await import('../../src/core/earnings');
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    { createCoreApp } = await import('../../src/core/app'),
    runtime = new ModuleRuntime([manifest]);
  runtime.register({ manifest, router: Router() });
  app = createCoreApp(runtime);
  emptyApp = createCoreApp(new ModuleRuntime([manifest]));
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions'),
    { signToken } = await import('../../src/auth/jwt');
  for (const person of people) {
    const client = 'earning-client-' + person.sub,
      session = await issueRefreshSession(person.sub, { type: 'web', id: client });
    headers[person.sub] = {
      'X-Client-Id': client,
      Authorization:
        'Bearer ' +
        (await signToken({
          ...person,
          id: person.sub,
          username: 'user' + person.sub,
          displayName: '人员' + person.sub,
          parentId: null,
          sessionId: session.familyId,
        })),
    };
  }
}, 90000);
afterAll(async () => {
  await db?.end();
  await c?.end();
  await container?.stop();
}, 30000);

it('无项目模块表时聚合两个项目，SQL 只返回本人明细和数量，不泄漏团队个人金额', async () => {
  const first = input('one');
  first.lines.push({
    ...first.lines[0],
    payeeId: '3',
    ruleCode: 'leader_override',
    unitPrice: '0.5000',
    amount: '1.0000',
  });
  await write(first);
  await write(input('two', '24.0000'), { ...scope, projectId: '2', accountId: '2' });
  const own = await get();
  expect(own.status, own.text).toBe(200);
  expect(own.body.data.summary.amount).toBe('40.0000');
  expect(own.body.data.groups).toHaveLength(2);
  expect(own.body.data.list.every((l: { ruleCode: string }) => l.ruleCode === 'creator')).toBe(true);
  const team = await get('3');
  expect(team.body.data.summary.amount).toBe('1.0000');
  expect(team.body.data.list).toHaveLength(1);
  expect(team.body.data.list[0]).toMatchObject({
    unitPrice: '0.5000',
    amount: '1.0000',
    earningGroup: 'team',
    quantity: '2',
  });
  expect(JSON.stringify(team.body)).not.toContain('16.0000');
  expect((await q("SHOW TABLES LIKE 'zh_%'")).length).toBe(0);
});
it('拒绝未登录、运营、跨项目与伪造收款人参数，历史接口也独立校验本人范围', async () => {
  expect((await request(app).get('/api/v1/core/earnings/mine')).status).toBe(401);
  expect((await get('4')).status).toBe(403);
  expect((await get('2', { projectId: '3' })).status).toBe(403);
  expect((await get('2', { userId: '5' })).status).toBe(422);
  expect((await get('2', { accountId: '2' })).status).toBe(422);
  const own = (await get()).body.data.list[0];
  expect(
    (
      await request(app)
        .get('/api/v1/core/earnings/' + own.id + '/history')
        .set(headers['5'])
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app)
        .get('/api/v1/core/earnings/' + own.id + '/history')
        .set(headers['4'])
    ).status,
  ).toBe(403);
});
it('确认前展示空金额与负责人，内部业绩不能写入资金账', async () => {
  const missing = input('missing');
  Object.assign(missing.lines[0], {
    amount: null,
    unitPrice: null,
    ready: false,
    reason: '资料待核对',
    next: '运营：核对资料',
  });
  await write(missing);
  const internal = input('staff', '70.0000');
  Object.assign(internal.lines[0], {
    payeeId: '1',
    performerId: '1',
    internal: true,
    ruleCode: 'staff_self',
    ready: false,
  });
  await write(internal);
  const row = (await get()).body.data.list.find((l: { taskId: string }) => l.taskId === 'missing');
  expect(row).toMatchObject({
    amount: null,
    unitPrice: null,
    pendingAmount: null,
    reason: '资料待核对',
    nextAction: '运营：核对资料',
  });
  await expect(confirm(missing)).rejects.toThrow('收益记录已更新');
  await expect(confirm(internal)).rejects.toThrow('收益记录已更新');
  expect((await get('1')).body.data.summary).toMatchObject({ amount: '0.0000', internalAmount: '70.0000' });
  expect(await q('SELECT * FROM opc_income_entries')).toHaveLength(0);
});
it('重复投影幂等、确认幂等；更正保留确认行并只追加资金差额', async () => {
  const before = await q('SELECT * FROM opc_earning_lines ORDER BY id');
  await write(input('two', '24.0000'), { ...scope, projectId: '2', accountId: '2' });
  expect(await q('SELECT * FROM opc_earning_lines ORDER BY id')).toEqual(before);
  const value = input('correct', '16.0000');
  await write(value);
  expect((await get('2', { search: 'correct' })).body.data.list[0].nextAction).toBe('财务：核对并确认金额');
  await confirm(value);
  const confirmed = await q('SELECT * FROM opc_earning_lines WHERE confirmed_at IS NOT NULL ORDER BY id'),
    cashBefore = await q('SELECT * FROM opc_income_entries ORDER BY id');
  expect((await get('2', { search: 'correct' })).body.data.list[0].nextAction).toBe('金额已确认，可查看提现状态');
  expect(await q('SELECT * FROM opc_earning_lines WHERE confirmed_at IS NOT NULL ORDER BY id')).toEqual(confirmed);
  expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(cashBefore);
  await confirm(value);
  expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(cashBefore);
  const changed = input('correct', '8.0000', '2');
  changed.lines[0].quantity = '1';
  await write(changed);
  expect(await q('SELECT * FROM opc_earning_lines WHERE confirmed_at IS NOT NULL ORDER BY id')).toEqual(confirmed);
  const own = (await get()).body.data.list.find((l: { taskId: string }) => l.taskId === 'correct');
  expect(own).toMatchObject({
    amount: '8.0000',
    confirmedAmount: '16.0000',
    pendingAmount: '-8.0000',
    nextAction: '财务：核对并确认金额',
  });
  await confirm(changed);
  expect((await get('2', { search: 'correct' })).body.data.list[0].nextAction).toBe('金额已确认，可查看提现状态');
  expect(
    (await q('SELECT CAST(amount AS CHAR) amount FROM opc_income_entries ORDER BY id')).map((r) => r.amount),
  ).toEqual(['16.0000', '-8.0000']);
  expect(await q('SELECT * FROM opc_earning_lines WHERE id=?', [confirmed[0].id])).toEqual([confirmed[0]]);
  const history = await request(app)
    .get('/api/v1/core/earnings/' + own.id + '/history')
    .set(headers['2']);
  expect(history.status).toBe(200);
  expect(history.body.data.list.map((l: { amount: string }) => l.amount)).toEqual(['-8.0000', '16.0000']);
  await expect(write(input('correct', '9.0000', '2'))).rejects.toThrow('收益记录已更新');
});
it('筛选与分页在 SQL 生效，停用模块或项目后不返回旧项目入口或金额', async () => {
  const page = await get('2', { pageSize: 1, page: 2, projectId: '1', metricType: 'sale', group: 'self' });
  expect(page.status, page.text).toBe(200);
  expect(page.body.data.list).toHaveLength(1);
  expect(page.body.data.total).toBe(3);
  expect((await get('2', { search: 'correct' })).body.data.total).toBe(1);
  const empty = await get('2', {}, emptyApp);
  expect(empty.status).toBe(200);
  expect(empty.body.data).toMatchObject({ scopes: [], list: [], groups: [], total: 0 });
  await c.query('UPDATE projects SET is_enabled=0 WHERE id=2');
  try {
    expect((await get()).body.data.groups).toHaveLength(1);
    expect((await get('2', { projectId: '2' })).status).toBe(403);
  } finally {
    await c.query('UPDATE projects SET is_enabled=1 WHERE id=2');
  }
});
it('资金写入失败回滚全部确认，迁移重复执行不改已有收益与资金', async () => {
  const value = input('rollback');
  await write(value);
  const lines = await q('SELECT * FROM opc_earning_lines ORDER BY id'),
    income = await q('SELECT * FROM opc_income_entries ORDER BY id');
  await c.query(
    "CREATE TRIGGER fail_earning_cash BEFORE INSERT ON opc_income_entries FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated write failure'",
  );
  try {
    await expect(confirm(value)).rejects.toThrow('isolated write failure');
  } finally {
    await c.query('DROP TRIGGER fail_earning_cash');
  }
  expect(await q('SELECT * FROM opc_earning_lines ORDER BY id')).toEqual(lines);
  expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(income);
  const migration = await readFile('schema/extensions/015_earning_lines.sql', 'utf8');
  for (let run = 0; run < 2; run++)
    for (const sql of migration.split(/;\s*(?:\r?\n|$)/).filter((s) => s.trim())) await c.query(sql);
  expect(await q('SELECT * FROM opc_earning_lines ORDER BY id')).toEqual(lines);
  expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(income);
});

it('共享财务在无项目表环境读取确认金额，拒绝运营、成员和跨项目来源', async () => {
  const endpoint = '/api/v1/core/finance/workspace';
  expect((await request(app).get(endpoint)).status).toBe(401);
  for (const actor of ['2', '3', '4']) {
    expect((await request(app).get(endpoint).set(headers[actor])).status).toBe(403);
    expect(
      (
        await request(app)
          .get(endpoint + '/entries')
          .set(headers[actor])
      ).status,
    ).toBe(403);
  }
  const scopes = await request(app).get(endpoint).set(headers['1']);
  expect(scopes.status, scopes.text).toBe(200);
  expect(scopes.body.data).toHaveLength(3);
  expect((await request(emptyApp).get(endpoint).set(headers['1'])).body.data).toEqual([]);
  const filter = { ...scope, from: '2026-10-01', to: '2026-10-09' };
  const ledger = await request(app)
    .get(endpoint + '/entries')
    .set(headers['1'])
    .query(filter);
  expect(ledger.status, ledger.text).toBe(200);
  expect(ledger.body.data).toMatchObject({ total: 1, amount: '8.0000' });
  expect(ledger.body.data.list[0]).toMatchObject({ payeeName: '人员2', quantity: '1', unitPrice: '8.0000' });
  expect(
    (
      await request(app)
        .get(endpoint + '/entries')
        .set(headers['1'])
        .query({ ...filter, projectId: '2' })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(emptyApp)
        .get(endpoint + '/entries')
        .set(headers['1'])
        .query(filter)
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app)
        .get(endpoint + '/entries')
        .set(headers['1'])
        .query({ ...filter, from: '2026-10-10' })
    ).status,
  ).toBe(422);
  const second = input('finance-second', '5.0000');
  second.lines[0].quantity = '1';
  second.lines[0].unitPrice = '5.0000';
  await write(second, { ...scope, projectId: '2', accountId: '2' });
  await confirm(second, { ...scope, projectId: '2', accountId: '2' });
  const other = await request(app)
    .get(endpoint + '/entries')
    .set(headers['1'])
    .query({ ...filter, projectId: '2', accountId: '2' });
  expect(other.body.data).toMatchObject({ total: 1, amount: '5.0000' });
  expect((await q("SHOW TABLES LIKE 'zh_%'")).length).toBe(0);
});

it('风险排除说明不当作未处理，后续业务阻断仍覆盖当前就绪状态且不改确认账', async () => {
  const value = input('status-review', '0.0000');
  value.lines[0].reason = '本次推广不计费';
  await write(value);
  await confirm(value);
  const read = async () => (await get('2', { search: 'status-review' })).body.data.list[0];
  expect(await read()).toMatchObject({
    isReady: 1,
    amount: '0.0000',
    calculationAmount: '16.0000',
    reason: '本次推广不计费',
  });
  expect((await read()).confirmedAt).toBeTruthy();
  const original = await q('SELECT * FROM opc_earning_lines WHERE confirmed_at IS NOT NULL ORDER BY id');
  const { blockIncome } = await import('../../src/core/finance');
  await tx((conn) => blockIncome(conn, scope, value.sourceKey, '作品需要再次核对'));
  expect(await read()).toMatchObject({ isReady: 0, reason: '作品需要再次核对' });
  expect(await q('SELECT * FROM opc_earning_lines WHERE confirmed_at IS NOT NULL ORDER BY id')).toEqual(original);
});
