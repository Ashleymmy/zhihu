import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection } from 'mysql2/promise';
import request from 'supertest';
import type { Express } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';
const jobs = vi.hoisted(() => new Map<string, (data: Record<string, unknown>) => Promise<unknown>>());
vi.mock('../../src/modules/zhihu/queue', async (original) => ({
  ...(await original<typeof import('../../src/modules/zhihu/queue')>()),
  registerJob: (name: string, handler: (data: Record<string, unknown>) => Promise<unknown>) => jobs.set(name, handler),
  enqueue: vi.fn(async () => ({ id: 'isolated' })),
}));
let container: StartedMySqlContainer, c: Connection, pool: typeof import('../../src/db').db, app: Express;
const actors = [
  ['1', 'admin', 'all'],
  ['2', 'leader', 'all'],
  ['3', 'creator', 'all'],
  ['4', 'creator', 'all'],
  ['5', 'admin', 'operations'],
  ['6', 'admin', 'finance'],
] as const;
const headers: Record<string, Record<string, string>> = {};
const q = async (sql: string, args: unknown[] = []) => (await c.query<mysql.RowDataPacket[]>(sql, args))[0];
const base = '/api/v1/modules/zhihu';
const get = (path: string, actor = '1') =>
  request(app)
    .get(base + path)
    .set(headers[actor]);
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('legacy_history')
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
  for (const [id, role, duty] of actors)
    await c.query(
      'INSERT INTO users(id,username,password_hash,role,admin_duty,display_name,parent_id) VALUES(?,?,?,?,?,?,?)',
      [id, 'history' + id, 'unused', role, duty, '历史人员' + id, id === '3' ? '2' : null],
    );
  await c.query(
    "INSERT INTO earnings(user_id,project_id,settle_date,amount,status) VALUES(2,1,'2025-09-01',1000.0000,'paid'),(3,1,'2025-09-01',1234.5678,'confirmed'),(4,1,'2025-09-01',9900,'confirmed')",
  );
  for (const id of ['2', '3', '4']) {
    await c.query(
      "INSERT INTO withdrawal_requests(id,user_id,amount,pay_method,pay_account,status,invoice_path,invoice_name) VALUES(?,?,1000,'wechat','private-account','approved','test.pdf','发票.pdf')",
      [id, id],
    );
    await c.query(
      "INSERT INTO finance_appeals(id,user_id,kind,title,content,status,adjust_amount) VALUES(?,?,'扣款',?,'说明','approved',-123.45)",
      [id, id, '申诉' + id],
    );
  }
  await c.query(
    "INSERT INTO settlement_batches(id,title,period_start,period_end,status,total_source,total_relay,created_by) VALUES(1,'历史结算单','2025-09-01','2025-09-02','approved',100,80,1)",
  );
  await c.query("INSERT INTO settlement_items(batch_id,creator_id,source_amount,note) VALUES(1,3,100,'原记录')");
  await c.query(
    "INSERT INTO data_import_batches(id,file_name,file_size,file_sha256,sheet_name,total_rows,valid_rows,error_rows,errors_json,headers_json,created_by) VALUES(1,'历史订单.xlsx',10,REPEAT('a',64),'数据',2,1,1,'[]','[]',1)",
  );
  await c.query(
    "INSERT INTO data_import_rows(batch_id,`row_number`,keyword,order_count,validation_status,errors_json,raw_json) VALUES(1,2,'历史小说',1,'valid','[]','{}'),(1,3,'错误记录',NULL,'invalid',JSON_ARRAY('日期不完整'),'{}')",
  );
  pool = (await import('../../src/db')).db;
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    { zhihuManifest } = await import('../../src/modules/zhihu/manifest'),
    { createZhihuModule } = await import('../../src/modules/zhihu/module'),
    { createCoreApp } = await import('../../src/core/app');
  const runtime = new ModuleRuntime([zhihuManifest]);
  runtime.register(createZhihuModule());
  app = createCoreApp(runtime);
  const { signToken } = await import('../../src/auth/jwt'),
    { issueRefreshSession } = await import('../../src/auth/tokenSessions');
  for (const [id, role, adminDuty] of actors) {
    const client = 'history-client-' + id,
      session = await issueRefreshSession(id, { type: 'web', id: client });
    headers[id] = {
      'X-Client-Id': client,
      Authorization:
        'Bearer ' +
        (await signToken({
          id,
          role,
          adminDuty,
          parentId: id === '3' ? '2' : null,
          username: 'history' + id,
          displayName: '历史人员' + id,
          sessionId: session.familyId,
        })),
    };
  }
}, 90000);
afterAll(async () => {
  await pool?.end();
  await c?.end();
  await container?.stop();
});
it('authenticates and rejects operations access to current and old history reads', async () => {
  expect((await request(app).get(base + '/finance-history/earnings')).status).toBe(401);
  for (const path of [
    '/finance-history/earnings',
    '/finance-history/withdrawals',
    '/finance-history/appeals',
    '/finance-history/settlements',
    '/finance-history/data-import',
    '/earnings',
    '/earnings/summary',
    '/withdrawals',
    '/appeals',
    '/data-import/batches',
    '/finance/batches',
  ])
    expect((await get(path, '5')).status, path).toBe(403);
});
it('keeps members and leaders on their own money with exact historical cents', async () => {
  const creator = await get('/finance-history/earnings', '3');
  expect(creator.status, creator.text).toBe(200);
  expect(creator.body.data.list).toHaveLength(1);
  expect(creator.body.data.list[0].cells.amount).toBe('12.345678');
  for (const kind of ['earnings', 'withdrawals', 'appeals']) {
    const r = await get('/finance-history/' + kind, '2');
    expect(r.body.data.list).toHaveLength(1);
    expect(r.body.data.list[0].cells.owner).toBe('历史人员2');
  }
  expect((await get('/finance-history/appeals', '3')).body.data.list[0].cells.amount).toBe('-1.2345');
  for (const path of ['/earnings', '/withdrawals', '/appeals']) {
    const r = await get(path, '2');
    expect(r.status, r.text).toBe(200);
    expect(r.body.data.list).toHaveLength(1);
  }
  expect((await get('/withdrawals/3/statement', '2')).status).toBe(403);
  expect((await get('/withdrawals/3/invoice', '2')).status).toBe(403);
  expect((await get('/finance-history/withdrawals/3/lines', '2')).status).toBe(404);
});
it('retains staff-only historical settlements and every original import row', async () => {
  for (const kind of ['settlements', 'data-import'])
    for (const actor of ['2', '3', '4']) expect((await get('/finance-history/' + kind, actor)).status).toBe(403);
  const list = await get('/finance-history/settlements', '6');
  expect(list.status, list.text).toBe(200);
  expect(list.body.data.list[0].cells.amount).toBe('80.00');
  const details = await get('/finance-history/settlements/1/lines', '6');
  expect(details.status, details.text).toBe(200);
  expect(details.body.data.list[0].fields).toContainEqual({ label: '来源金额（元）', value: '100.00' });
  const imported = await get('/finance-history/data-import/1/lines', '6').query({ page: 2, pageSize: 1 });
  expect(imported.status, imported.text).toBe(200);
  expect(imported.body.data.total).toBe(2);
  expect(imported.body.data.list[0].fields).toContainEqual({ label: '关键词', value: '错误记录' });
  expect((await get('/finance-history/earnings').query({ page: 2, pageSize: 1 })).body.data.list).toHaveLength(1);
});
it('retires every old write endpoint, including aliases, without financial side effects', async () => {
  const tables = [
    'earnings',
    'withdrawal_requests',
    'finance_appeals',
    'settlement_batches',
    'settlement_items',
    'relay_logs',
    'data_import_batches',
    'data_import_rows',
    'pricing_rules',
  ];
  const snapshot = async () =>
    Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await q('SELECT * FROM ' + t + ' ORDER BY id')])));
  const before = await snapshot();
  const paths = [
    '/withdrawals',
    '/withdrawals/3/cancel',
    '/withdrawals/3/review',
    '/withdrawals/3/decide',
    '/withdrawals/3/invoice',
    '/appeals',
    '/appeals/3/cancel',
    '/appeals/3/review',
    '/appeals/3/decide',
    '/data-import/parse',
    '/data-import/confirm',
    '/data-import/1/confirm',
    '/data-import/1/reject',
    '/finance/rules',
    '/finance/rules/1/disable',
    '/finance/batches',
    '/finance/batches/import',
    '/finance/batches/1/approve',
    '/finance/batches/1/cancel',
    '/admin-tools/settle-earnings',
  ];
  for (const prefix of [base, '/api/v1'])
    for (const path of paths) {
      const r = await request(app)
        .post(prefix + path)
        .set(headers['1'])
        .send({ amount: 1000 });
      expect(r.status, r.text + ' ' + prefix + path).toBe(410);
      expect(r.body.message).toContain('历史账目仅供查询');
    }
  await jobs.get('settle-earnings')!({ from: '2025-09-01', to: '2025-09-02' });
  expect(await snapshot()).toEqual(before);
});
it('exposes the optional history entry without sending private payment account values', async () => {
  const modules = await request(app).get('/api/v1/core/modules').set(headers['1']);
  expect(modules.body.data[0].financeHistoryPath).toBe('/modules/zhihu/earnings');
  const list = await get('/finance-history/withdrawals', '6');
  expect(list.status).toBe(200);
  expect(list.text).not.toContain('private-account');
  expect((await get('/finance-history/invalid')).status).toBe(422);
});
