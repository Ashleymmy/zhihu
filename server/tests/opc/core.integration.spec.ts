import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import type { Express } from 'express';
import { runMigrations } from '../../scripts/migrationRunner';
import path from 'node:path';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import { createSampleModule, sampleManifest } from '../../examples/sample-api/module';
let container: StartedMySqlContainer, conn: mysql.Connection, app: Express, upstream: Server;
let pool: typeof import('../../src/db').db;
let adminToken: string, creatorToken: string;
let target: { host: string; port: number; database: string; user: string; password: string };
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withRootPassword('isolated_root_test')
    .withDatabase('opc_core_test')
    .withUsername('opc_test')
    .withUserPassword('isolated_test_only')
    .start();
  target = {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getUserPassword(),
  };
  Object.assign(process.env, {
    NODE_ENV: 'test',
    OPC_MODULES: '',
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
    QUEUE_DRIVER: 'memory',
  });
  delete process.env.DEV_DEMO_AUTH;
  await runOpcMigrations(target, []);
  conn = await mysql.createConnection(target);
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash('test_password', 4);
  await conn.query(
    "INSERT INTO users(id,username,password_hash,role,display_name) VALUES (1,'admin',?,'admin','管理'),(2,'creator',?,'creator','成员')",
    [hash, hash],
  );
  await conn.query("INSERT INTO projects(id,name,slug) VALUES (1,'项目一','one'),(2,'项目二','two')");
  await conn.query('INSERT INTO project_members(project_id,user_id) VALUES (1,2)');
  await conn.query("INSERT INTO module_installations(module_id,version) VALUES ('sample-api','1')");
  upstream = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ count: 12 }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address() as { port: number };
  const { ModuleRuntime } = await import('../../src/core/module-runtime');
  const runtime = new ModuleRuntime([sampleManifest]);
  runtime.register(createSampleModule('http://127.0.0.1:' + address.port));
  const { createCoreApp } = await import('../../src/core/app');
  app = createCoreApp(runtime);
  pool = (await import('../../src/db')).db;
  const { signToken } = await import('../../src/auth/jwt');
  adminToken = await signToken({ id: '1', role: 'admin', username: 'admin', displayName: '管理', parentId: null });
  creatorToken = await signToken({
    id: '2',
    role: 'creator',
    username: 'creator',
    displayName: '成员',
    parentId: null,
  });
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (conn) await conn.end();
  if (upstream) await new Promise<void>((resolve) => upstream.close(() => resolve()));
  if (container) await container.stop({ remove: true, removeVolumes: true });
}, 30000);
const auth = (token = adminToken) => 'Bearer ' + token;
describe('OPC independent core', () => {
  it('fresh schema has no provider tables', async () => {
    const [tables] = await conn.query<mysql.RowDataPacket[]>('SHOW TABLES');
    const names = tables.map((r) => String(Object.values(r)[0]));
    expect(names).toContain('projects');
    expect(names).toContain('integration_accounts');
    for (const name of ['plans', 'channels', 'daily_metrics', 'earnings', 'data_import_batches', 'attribution_tasks'])
      expect(names).not.toContain(name);
  });
  it('login and refresh work through canonical and compatibility paths', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/core/auth/login').send({ username: 'admin', password: 'test_password' });
    expect(login.status).toBe(200);
    expect(String(login.headers['set-cookie'])).toContain('Path=/api/v1;');
    expect((await agent.post('/api/v1/auth/refresh')).status).toBe(200);
  });
  it('public functions and project creation need no provider configuration', async () => {
    for (const url of [
      '/healthz',
      '/api/v1/core/projects',
      '/api/v1/core/team/members',
      '/api/v1/core/modules',
      '/api/v1/core/admin-tools/site-info',
      '/api/v1/core/announcements/active',
    ]) {
      expect((await request(app).get(url).set('Authorization', auth())).status, url).toBe(200);
    }
    const created = await request(app)
      .post('/api/v1/core/projects')
      .set('Authorization', auth())
      .send({ name: '独立业务', slug: 'independent' });
    expect(created.status).toBe(201);
    expect(created.body.data).not.toHaveProperty('apiBaseUrl');
  });
  it('disabled module canonical and compatibility routes are absent', async () => {
    for (const url of [
      '/api/v1/modules/zhihu/plans',
      '/api/v1/data-import/batches',
      '/api/v1/plans',
      '/api/alliance/api/popularize_plan',
    ]) {
      expect((await request(app).get(url).set('Authorization', auth())).status, url).toBe(404);
    }
  });
  it('API adapter transforms data and enforces account/project boundaries', async () => {
    const created = await request(app)
      .post('/api/v1/core/integrations')
      .set('Authorization', auth())
      .send({ moduleId: 'sample-api', accountKey: 'same-external-id', name: 'API 账号' });
    expect(created.status).toBe(201);
    const accountId = created.body.data.id;
    expect(
      (await request(app).post('/api/v1/core/projects/1/integrations').set('Authorization', auth()).send({ accountId }))
        .status,
    ).toBe(201);
    const scope = { projectId: '1', accountId, from: '2026-09-01', to: '2026-09-02' };
    const response = await request(app)
      .get('/api/v1/core/modules/sample-api/summary')
      .query(scope)
      .set('Authorization', auth(creatorToken));
    expect(response.status).toBe(200);
    expect(response.body.data.metrics[0].value).toBe('12');
    for (const token of [adminToken, creatorToken])
      expect(
        (
          await request(app)
            .get('/api/v1/core/modules/sample-api/summary')
            .query({ ...scope, projectId: '2' })
            .set('Authorization', auth(token))
        ).status,
      ).toBe(403);
    expect(
      (
        await request(app)
          .patch('/api/v1/core/integrations/' + accountId)
          .set('Authorization', auth())
          .send({ status: 'disabled' })
      ).status,
    ).toBe(200);
    expect(
      (await request(app).get('/api/v1/core/modules/sample-api/summary').query(scope).set('Authorization', auth()))
        .status,
    ).toBe(403);
  });
  it('module failures, bad dates and external identifiers remain isolated', async () => {
    const { ModuleRuntime } = await import('../../src/core/module-runtime');
    const { createCoreApp } = await import('../../src/core/app');
    const first = createSampleModule('http://127.0.0.1:1');
    const second = {
      ...createSampleModule('http://127.0.0.1:1'),
      manifest: { ...sampleManifest, id: 'sample-second' },
    };
    const runtime = new ModuleRuntime([sampleManifest, second.manifest]);
    runtime.register(first);
    runtime.register(second);
    const isolated = createCoreApp(runtime);
    await conn.query("INSERT INTO module_installations(module_id,version) VALUES ('sample-second','1')");
    const create = (moduleId: string) =>
      request(isolated)
        .post('/api/v1/core/integrations')
        .set('Authorization', auth())
        .send({ moduleId, accountKey: 'isolation-id', name: moduleId });
    const a = await create('sample-api'),
      b = await create('sample-second');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.id).not.toBe(b.body.data.id);
    expect((await create('sample-api')).status).toBe(409);
    const accountId = a.body.data.id;
    await request(isolated)
      .post('/api/v1/core/projects/1/integrations')
      .set('Authorization', auth())
      .send({ accountId });
    const scope = { projectId: '1', accountId, from: '2026-09-01', to: '2026-09-02' };
    const summary = (query: object) =>
      request(isolated).get('/api/v1/core/modules/sample-api/summary').query(query).set('Authorization', auth());
    expect((await summary(scope)).body.data.status).toBe('unavailable');
    expect((await request(isolated).get('/api/v1/core/projects').set('Authorization', auth())).status).toBe(200);
    expect((await summary({ ...scope, from: '2026-02-30' })).status).toBe(422);
    expect((await summary({ ...scope, from: '2026-10-01' })).status).toBe(422);
    expect((await summary({ ...scope, accountId: b.body.data.id })).status).toBe(403);
    first.dataProvider = {
      async summary(input) {
        return {
          ...input,
          projectId: '2',
          moduleId: 'sample-api',
          status: 'ready',
          updatedAt: new Date().toISOString(),
          metrics: [],
        };
      },
    };
    expect((await summary(scope)).body.data.status).toBe('unavailable');
  });
  it('startup failure removes all module endpoints while core stays available', async () => {
    const { ModuleRuntime } = await import('../../src/core/module-runtime');
    const { createCoreApp } = await import('../../src/core/app');
    const failed = createSampleModule('http://127.0.0.1:1');
    failed.router.get('/probe', (_req, res) => res.json({ ok: true }));
    failed.beforeJson = (app) => {
      app.get('/probe-raw', (_req, res) => res.json({ ok: true }));
    };
    failed.mountLegacy = (app) => {
      app.get('/probe-legacy', (_req, res) => res.json({ ok: true }));
    };
    failed.start = () => {
      throw Error('isolated startup failure');
    };
    const runtime = new ModuleRuntime([sampleManifest]);
    runtime.register(failed);
    const isolated = createCoreApp(runtime);
    expect(() => runtime.start()).not.toThrow();
    for (const url of ['/api/v1/modules/sample-api/probe', '/probe-raw', '/probe-legacy'])
      expect((await request(isolated).get(url)).status).toBe(404);
    expect((await request(isolated).get('/healthz')).status).toBe(200);
    expect((await request(isolated).get('/api/v1/core/modules').set('Authorization', auth())).body.data[0].status).toBe(
      'unavailable',
    );
  });
  it('public finance requires a business scope before reading balances or applying withdrawals', async () => {
    const response = await request(app).get('/api/v1/core/finance').set('Authorization', auth());
    expect(response.body.data.status).toBe('requires_scope');
    expect(response.body.data).not.toHaveProperty('balance');
    expect(
      (await request(app).post('/api/v1/core/finance/withdrawals').set('Authorization', auth()).send({ amount: 1 }))
        .status,
    ).toBe(422);
  });
  it('optional installation preserves IDs and is repeatable', async () => {
    await runOpcMigrations(target, ['zhihu']);
    await runOpcMigrations(target, ['zhihu']);
    const [users] = await conn.query<mysql.RowDataPacket[]>('SELECT id FROM users ORDER BY id');
    expect(users.map((r) => r.id)).toEqual([1, 2]);
    const [tables] = await conn.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'data_import_batches'");
    expect(tables).toHaveLength(1);
    const { createZhihuModule } = await import('../../src/modules/zhihu/module');
    const { zhihuManifest } = await import('../../src/modules/zhihu/manifest');
    const { ModuleRuntime } = await import('../../src/core/module-runtime');
    const runtime = new ModuleRuntime([zhihuManifest]);
    runtime.register(createZhihuModule());
    const { createCoreApp } = await import('../../src/core/app');
    const legacyApp = createCoreApp(runtime);
    for (const url of ['/api/v1/meta/enums', '/api/v1/modules/zhihu/meta/enums'])
      expect((await request(legacyApp).get(url).set('Authorization', auth())).status).toBe(200);
    expect((await request(legacyApp).get('/api/v1/modules/zhihu/alliance/api/popularize_compositions')).status).toBe(
      401,
    );
    expect(
      (
        await request(legacyApp)
          .post('/api/v1/core/integrations')
          .set('Authorization', auth())
          .send({ moduleId: 'zhihu', accountKey: 'unsupported', name: '额外账号' })
      ).status,
    ).toBe(422);
    const raw = await request(legacyApp)
      .get('/api/v1/modules/zhihu/alliance/api/not-registered')
      .set('Authorization', auth());
    expect(raw.status).toBe(404);
  }, 30000);
  it('legacy database upgrade retains financial amounts, users and project IDs', async () => {
    const root = await mysql.createConnection({
      host: target.host,
      port: target.port,
      user: 'root',
      password: 'isolated_root_test',
    });
    await root.query('CREATE DATABASE opc_legacy_test');
    await root.end();
    const legacy = { ...target, user: 'root', password: 'isolated_root_test', database: 'opc_legacy_test' };
    await runMigrations(legacy, path.resolve(process.cwd(), 'migrations'));
    const c = await mysql.createConnection(legacy);
    try {
      await c.query(
        "INSERT INTO users(id,username,password_hash,role,display_name) VALUES (99,'legacy','unusable','creator','历史成员')",
      );
      await c.query(
        "INSERT INTO earnings(user_id,project_id,settle_date,amount,status,source_ref) VALUES (99,1,'2026-08-01',12345.6789,'confirmed','baseline:test')",
      );
      await c.query(
        "INSERT INTO projects(id,name,slug,api_base_url,sign_method) VALUES (88,'仅有历史收益','legacy-earning-only','https://open.zhihu.com','hmac_sha256')",
      );
      await c.query(
        "INSERT INTO earnings(user_id,project_id,settle_date,amount,status,source_ref) VALUES (99,88,'2026-08-02',100.1250,'confirmed','baseline:earning-only')",
      );
      const [before] = await c.query('SELECT * FROM earnings');
      await runOpcMigrations(legacy, ['zhihu']);
      await runOpcMigrations(legacy, []);
      const [after] = await c.query('SELECT * FROM earnings');
      expect(after).toEqual(before);
      const [links] = await c.query<mysql.RowDataPacket[]>(
        'SELECT project_id FROM project_integrations ORDER BY project_id',
      );
      expect(links.map((r) => r.project_id)).toEqual([1, 88]);
    } finally {
      await c.end();
    }
  }, 30000);
});
