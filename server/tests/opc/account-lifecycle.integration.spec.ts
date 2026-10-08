import { beforeAll, afterAll, it, expect } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { Router, type Express } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import { ModuleRuntime } from '../../src/core/module-runtime';
import type { ModuleAccountLifecycle, ModuleManifest } from '../../src/core/contracts';

let container: StartedMySqlContainer, conn: mysql.Connection, app: Express;
let pool: typeof import('../../src/db').db;
let createCoreApp: typeof import('../../src/core/app').createCoreApp;
let passwordHash: string,
  sequence = 0;
const password = 'isolated_lifecycle_password';
const runtime = new ModuleRuntime();
const manifest: ModuleManifest = {
  id: 'lifecycle-test',
  name: '账户资料测试',
  version: '1',
  contractVersion: 1,
  roles: ['creator'],
  capabilities: [],
  permissions: {},
  entryPath: '/lifecycle-test',
};
let blocked = false,
  eraseFails = false;
const lifecycle: ModuleAccountLifecycle = {
  async closureBlockers() {
    return blocked ? ['请先完成测试项目的工作'] : [];
  },
  async erasePersonalData(c, id) {
    await c.query('UPDATE lifecycle_test_records SET private_label=NULL WHERE user_id=?', [id]);
    if (eraseFails) throw Error('isolated provider failure');
  },
};

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('account_lifecycle_test')
    .withUsername('review')
    .withUserPassword('isolated_review_only')
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
  });
  await runOpcMigrations(target, []);
  conn = await mysql.createConnection(target);
  passwordHash = await bcrypt.hash(password, 4);
  await conn.query(
    'CREATE TABLE lifecycle_test_records(user_id BIGINT PRIMARY KEY,private_label VARCHAR(64),evidence_amount DECIMAL(18,4) NOT NULL)',
  );
  createCoreApp = (await import('../../src/core/app')).createCoreApp;
  pool = (await import('../../src/db')).db;
  app = createCoreApp(runtime);
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (conn) await conn.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
}, 30000);

async function fresh(role = 'creator') {
  const name = 'lifecycle_' + ++sequence,
    client = 'lifecycle-client-' + sequence;
  const [inserted] = await conn.query<mysql.ResultSetHeader>(
    "INSERT INTO users(username,password_hash,role,display_name,is_active,must_change_pwd) VALUES(?,?,?,'测试成员',1,0)",
    [name, passwordHash, role],
  );
  const login = await request(app)
    .post('/api/v1/core/auth/login')
    .set('X-Client-Id', client)
    .send({ username: name, password });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return {
    id: String(inserted.insertId),
    headers: { Authorization: 'Bearer ' + login.body.data.token, 'X-Client-Id': client },
  };
}
function close(user: Awaited<ReturnType<typeof fresh>>, target = app) {
  return request(target)
    .post('/api/v1/core/account-privacy/closure')
    .set(user.headers)
    .send({ userId: user.id, password, confirmation: '注销网站及小程序共用账号' });
}

it('denies unauthenticated closure and another account identity', async () => {
  expect((await request(app).get('/api/v1/core/account-privacy/closure')).status).toBe(401);
  const user = await fresh();
  const result = await request(app)
    .post('/api/v1/core/account-privacy/closure')
    .set(user.headers)
    .send({ userId: '999999', password, confirmation: '注销网站及小程序共用账号' });
  expect(result.status).toBe(409);
});
it('closes a core-only account without optional project tables or profile columns', async () => {
  const user = await fresh();
  const [columns] = await conn.query<RowDataPacket[]>('SHOW COLUMNS FROM users');
  expect(columns.map((c) => c.Field)).not.toContain('zhihu_uid');
  const status = await request(app).get('/api/v1/core/account-privacy/closure').set(user.headers);
  expect(status.status, JSON.stringify(status.body)).toBe(200);
  expect(status.body.data.canClose).toBe(true);
  expect((await close(user)).status).toBe(200);
  const [[row]] = await conn.query<RowDataPacket[]>('SELECT is_active,closed_at FROM users WHERE id=?', [user.id]);
  expect(row.is_active).toBe(0);
  expect(row.closed_at).toBeTruthy();
});
it('changes a core-only member role through the real platform route', async () => {
  const manager = await fresh('developer'),
    member = await fresh();
  const result = await request(app)
    .patch('/api/v1/core/team/members/' + member.id + '/access')
    .set(manager.headers)
    .send({ role: 'leader' });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const [[row]] = await conn.query<RowDataPacket[]>('SELECT role FROM users WHERE id=?', [member.id]);
  expect(row.role).toBe('leader');
});
it('preserves a project blocker and the active account', async () => {
  await conn.query("INSERT INTO module_installations(module_id,version) VALUES('lifecycle-test','1')");
  runtime.register({ manifest, router: Router(), accountLifecycle: lifecycle });
  blocked = true;
  const user = await fresh();
  const status = await request(app).get('/api/v1/core/account-privacy/closure').set(user.headers);
  expect(status.body.data.blockers).toContain('请先完成测试项目的工作');
  expect((await close(user)).status).toBe(409);
  blocked = false;
});
it('erases module personal fields while preserving business evidence', async () => {
  const user = await fresh();
  await conn.query("INSERT INTO lifecycle_test_records VALUES(?,'private-profile',12.3400)", [user.id]);
  expect((await close(user)).status).toBe(200);
  const [[row]] = await conn.query<RowDataPacket[]>(
    'SELECT private_label,evidence_amount FROM lifecycle_test_records WHERE user_id=?',
    [user.id],
  );
  expect(row.private_label).toBeNull();
  expect(row.evidence_amount).toBe('12.3400');
});
it('rolls back both identity and module erasure when a provider fails', async () => {
  const user = await fresh();
  await conn.query("INSERT INTO lifecycle_test_records VALUES(?,'keep-until-complete',12.3400)", [user.id]);
  eraseFails = true;
  try {
    expect((await close(user)).status).toBe(500);
  } finally {
    eraseFails = false;
  }
  const [[row]] = await conn.query<RowDataPacket[]>(
    'SELECT u.is_active,u.closed_at,r.private_label FROM users u JOIN lifecycle_test_records r ON r.user_id=u.id WHERE u.id=?',
    [user.id],
  );
  expect(row).toMatchObject({ is_active: 1, closed_at: null, private_label: 'keep-until-complete' });
});
it('cannot skip installed module checks when that module is unavailable', async () => {
  const user = await fresh();
  const unavailableApp = createCoreApp(new ModuleRuntime([manifest]));
  expect((await request(unavailableApp).get('/api/v1/core/account-privacy/closure').set(user.headers)).status).toBe(
    503,
  );
  const result = await close(user, unavailableApp);
  expect(result.status).toBe(503);
  expect(result.body.message).toContain('项目资料暂时无法核对');
  const [[row]] = await conn.query<RowDataPacket[]>('SELECT is_active,closed_at FROM users WHERE id=?', [user.id]);
  expect(row).toMatchObject({ is_active: 1, closed_at: null });
});

it('preserves member ownership while an installed module cannot check changes', async () => {
  const manager = await fresh('developer'),
    member = await fresh();
  const unavailableApp = createCoreApp(new ModuleRuntime([manifest]));
  const result = await request(unavailableApp)
    .patch('/api/v1/core/team/members/' + member.id + '/access')
    .set(manager.headers)
    .send({ role: 'leader' });
  expect(result.status, JSON.stringify(result.body)).toBe(503);
  const [[row]] = await conn.query<RowDataPacket[]>('SELECT role FROM users WHERE id=?', [member.id]);
  expect(row.role).toBe('creator');
});
