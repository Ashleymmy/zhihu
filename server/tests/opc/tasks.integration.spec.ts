import { afterAll, beforeAll, expect, it } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import express, { Router, type Express } from 'express';
import type { Server } from 'node:http';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import { createSampleModule, sampleManifest } from '../../examples/sample-api/module';
import type { AuthUser } from '../../src/types';
import type { ModuleRuntime } from '../../src/core/module-runtime';
let container: StartedMySqlContainer, c: mysql.Connection, app: Express, runtime: ModuleRuntime, upstream: Server;
let pool: typeof import('../../src/db').db;
const headers: Record<string, Record<string, string>> = {};
const people = [
  { id: '1', role: 'admin', adminDuty: 'all' },
  { id: '2', role: 'creator', adminDuty: 'all' },
  { id: '3', role: 'admin', adminDuty: 'operations' },
  { id: '4', role: 'admin', adminDuty: 'finance' },
] as const;
const stored = Array.from({ length: 4 }, (_, i) => ({
  id: String(i + 1),
  title: '示例任务' + (i + 1),
  executorId: i === 3 ? '99' : (null as string | null),
  completed: false,
}));
const received: string[] = [],
  claims = new Map<string, string>();
let failing = false;
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('task_contract_test')
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
    DEV_DEMO_AUTH: '0',
  });
  await runOpcMigrations(target, []);
  c = await mysql.createConnection(target);
  for (const p of people)
    await c.query(
      'INSERT INTO users(id,username,password_hash,role,admin_duty,display_name,is_active,must_change_pwd) VALUES(?,?,?, ?,?,?,1,0)',
      [p.id, 'task' + p.id, 'unused', p.role, p.adminDuty, '测试' + p.id],
    );
  await c.query("INSERT INTO projects(id,name,slug) VALUES(1,'接口项目','api'),(2,'另一项目','other')");
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2)');
  await c.query("INSERT INTO module_installations(module_id,version) VALUES('sample-api','1')");
  await c.query(
    "INSERT INTO integration_accounts(id,module_id,account_key,name,created_by) VALUES(1,'sample-api','one','测试一',1),(2,'sample-api','two','测试二',1)",
  );
  await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(1,1),(2,2)');
  const mock = express();
  mock.use(express.json());
  mock.get('/tasks', (req, res) => {
    received.push(String(req.query.projectId) + ':' + String(req.query.accountId));
    if (failing && req.query.projectId === '2') {
      res.status(503).json({ secret: 'private' });
      return;
    }
    res.json({ count: stored.length, tasks: stored });
  });
  mock.post('/claim', (req, res) => {
    const task = stored.find((t) => t.id === req.body.id),
      key = String(req.headers['idempotency-key']);
    if (claims.get(key) === req.body.userId) {
      res.json({ ok: true });
      return;
    }
    if (!task || task.executorId) {
      res.sendStatus(409);
      return;
    }
    task.executorId = req.body.userId;
    claims.set(key, req.body.userId);
    res.json({ ok: true });
  });
  upstream = await new Promise<Server>((resolve) => {
    const s = mock.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { ModuleRuntime } = await import('../../src/core/module-runtime');
  const oldManifest = { ...sampleManifest, id: 'old-v1', contractVersion: 1 };
  runtime = new ModuleRuntime([sampleManifest, oldManifest]);
  runtime.register(createSampleModule('http://127.0.0.1:' + (upstream.address() as { port: number }).port + '/tasks'));
  runtime.register({ manifest: oldManifest, router: Router() });
  app = (await import('../../src/core/app')).createCoreApp(runtime);
  pool = (await import('../../src/db')).db;
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions'),
    { signToken } = await import('../../src/auth/jwt');
  for (const p of people) {
    const client = 'task-contract-client-' + p.id,
      session = await issueRefreshSession(p.id, { type: 'web', id: client });
    headers[p.id] = {
      'X-Client-Id': client,
      Authorization:
        'Bearer ' +
        (await signToken({
          ...p,
          username: 'task' + p.id,
          displayName: '测试' + p.id,
          parentId: null,
          sessionId: session.familyId,
        })),
    };
  }
}, 90000);
afterAll(async () => {
  await pool?.end();
  await c?.end();
  await new Promise<void>((resolve) => {
    upstream?.closeAllConnections();
    upstream?.close(() => resolve());
    if (!upstream) resolve();
  });
  await container?.stop();
}, 30000);
const list = (actor = '1', query: Record<string, unknown> = {}) =>
  request(app).get('/api/v1/core/tasks').set(headers[actor]).query(query);
const detail = (actor = '2', projectId = '1', account = '1', id = '1') =>
  request(app).get(`/api/v1/core/tasks/sample-api/${account}/${id}`).set(headers[actor]).query({ projectId });
const claim = (actor = '2', projectId = '1', account = '1', id = '1') =>
  request(app)
    .post(`/api/v1/core/tasks/sample-api/${account}/${id}/actions/claim`)
    .set(headers[actor])
    .send({ projectId, requestKey: crypto.randomUUID(), input: {} });
it('aggregates a real second API module, paginates each project and supports old version-one modules', async () => {
  const r = await list('1', { pageSize: 2 });
  expect(r.status).toBe(200);
  expect(r.body.data.groups).toHaveLength(2);
  expect(r.body.data.groups[0]).toMatchObject({ total: 4, page: 1, pageSize: 2, status: 'ready' });
  expect(r.body.data.groups[0].list.map((t: { id: string }) => t.id)).toEqual(['1', '2']);
  expect(
    (await list('1', { projectId: '1', pageSize: 2, page: 2 })).body.data.groups[0].list.map(
      (t: { id: string }) => t.id,
    ),
  ).toEqual(['3', '4']);
  expect(received).toContain('2:2');
  expect(runtime.list('admin').find((m) => m.id === 'sample-api')?.capabilities).toContain('tasks');
  expect(runtime.get('old-v1')).toBeTruthy();
  const [tables] = await c.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'zh_%'");
  expect(tables).toHaveLength(0);
});
it('filters member data at provider level and rejects project, account, task and job-role escalation', async () => {
  expect(
    (await list('2', { view: 'available' })).body.data.groups.map((g: { projectId: string }) => g.projectId),
  ).toEqual(['1']);
  expect((await list('2', { view: 'available' })).body.data.groups[0].total).toBe(3);
  for (const r of [
    await list('2', { projectId: '2' }),
    await detail('2', '2', '2'),
    await detail('2', '1', '2'),
    await claim('2', '2', '2'),
    await list('4'),
    await detail('4'),
  ])
    expect(r.status, r.text).toBe(403);
  expect((await detail('2', '1', '1', '4')).status).toBe(404);
  expect((await request(app).get('/api/v1/core/tasks')).status).toBe(401);
  expect((await list('3')).body.data.groups[0].list.some((t: { id: string }) => t.id === '4')).toBe(true);
});
it('dispatches an inline claim through the adapter and reflects exclusive ownership in task and dashboard', async () => {
  const r = await claim();
  expect(r.status, r.text).toBe(200);
  expect((await detail()).body.data.actions).toHaveLength(0);
  expect((await claim()).status).toBe(409);
  expect(claims.size).toBe(1);
  const r2 = await list('2', { view: 'owned' });
  expect(r2.body.data.groups[0].list.map((t: { id: string }) => t.id)).toEqual(['1']);
  const dashboard = await request(app).get('/api/v1/core/dashboard').set(headers['2']);
  expect(dashboard.body.data.groups[0].services[0].todos[0]).toMatchObject({
    kind: 'task.submit',
    count: 1,
    path: '/tasks?projectId=1',
  });
});
it('retains successful project results when another provider fails and does not expose private diagnostics', async () => {
  failing = true;
  try {
    const r = await list();
    expect(r.status).toBe(200);
    expect(r.body.data.groups.map((g: { status: string }) => g.status)).toEqual(['ready', 'unavailable']);
    expect(JSON.stringify(r.body)).not.toContain('private');
  } finally {
    failing = false;
  }
});
it('rejects disabled projects on list, detail and write endpoints', async () => {
  await c.query('UPDATE projects SET is_enabled=0 WHERE id=1');
  try {
    expect((await list('2')).body.data.groups).toEqual([]);
    expect((await detail()).status).toBe(403);
    expect((await claim('2', '1', '1', '2')).status).toBe(403);
  } finally {
    await c.query('UPDATE projects SET is_enabled=1 WHERE id=1');
  }
});
