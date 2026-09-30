import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { runOpcMigrations } from '../../scripts/opcMigrations';

vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn() }));
let container: StartedMySqlContainer, c: Connection, pool: typeof import('../../src/db').db, app: express.Express;
let sessions: typeof import('../../src/auth/tokenSessions');
const password = 'isolated_device_password';
const roles = ['developer', 'admin', 'operator', 'leader', 'creator'] as const;
let serial = 0;
const device = (mobile = false) => ({
  id: randomUUID(),
  ua: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
});
type Device = ReturnType<typeof device>;
type Login = { token: string; cookie: string; device: Device; id: string };
const headers = (d: Device) => ({
  'X-Client-Id': d.id,
  'User-Agent': d.ua,
  'X-Forwarded-For': '10.1.' + Math.floor(++serial / 250) + '.' + ((serial % 250) + 1),
});
async function login(username: string, d = device(), pwd = password): Promise<Login> {
  const res = await request(app).post('/auth/login').set(headers(d)).send({ username, password: pwd });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return {
    token: res.body.data.token,
    cookie: res.get('Set-Cookie')![0].split(';')[0],
    device: d,
    id: res.body.data.user.id,
  };
}
const me = (s: Login, d = s.device) => request(app).get('/auth/me').set(headers(d)).auth(s.token, { type: 'bearer' });
const refresh = (s: Login, d = s.device) => request(app).post('/auth/refresh').set(headers(d)).set('Cookie', s.cookie);
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('roles_device_test')
    .withUsername('test')
    .withUserPassword('isolated_test')
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
    OPC_MODULES: 'zhihu',
  });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  const hash = await bcrypt.hash(password, 4);
  for (const [index, role] of roles.entries())
    await c.query(
      'INSERT INTO users(id,username,password_hash,role,role_id,display_name,admin_duty,must_change_pwd) VALUES(?,?,?,?,(SELECT id FROM roles WHERE role_key=?),?,?,0)',
      [index + 1, role, hash, role, role, role, role === 'operator' ? 'operations' : 'all'],
    );
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,display_name,admin_duty) VALUES(6,'finance',?,'admin','财务','finance')",
    [hash],
  );
  pool = (await import('../../src/db')).db;
  sessions = await import('../../src/auth/tokenSessions');
  const { authRouter } = await import('../../src/routes/auth');
  const { requireAuth } = await import('../../src/auth/middleware');
  const { staffRouter } = await import('../../src/core/staff');
  const { teamRouter } = await import('../../src/routes/team');
  const { requirePermission, setModulePermissions } = await import('../../src/auth/permissions');
  const { requirePermission: zhPermission } = await import('../../src/modules/zhihu/permissions');
  const { zhihuManifest } = await import('../../src/modules/zhihu/manifest');
  const { errorHandler } = await import('../../src/middleware/errors');
  setModulePermissions([zhihuManifest]);
  app = express()
    .set('trust proxy', 1)
    .use(express.json())
    .use('/auth', authRouter)
    .use('/team', teamRouter)
    .use('/staff', requireAuth, staffRouter);
  app.get('/developer-tool', requireAuth, requirePermission('system.develop'), (_req, res) => res.sendStatus(204));
  app.get('/operations', requireAuth, zhPermission('keyword.create'), (_req, res) => res.sendStatus(204));
  app.get('/callback-secret', requireAuth, zhPermission('callback.secret'), (_req, res) => res.sendStatus(204));
  app.use(errorHandler);
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

describe('设备会话：Web 1 + 移动 1，开发者除外', () => {
  it.each(['admin', 'operator', 'leader', 'creator', 'finance'])(
    '%s 两类设备独立生效，替换后旧 access 和 refresh 立即失效',
    async (role) => {
      const web = await login(role),
        mobile = await login(role, device(true));
      expect((await me(web)).status).toBe(200);
      expect((await me(mobile)).status).toBe(200);
      const replacement = await login(role);
      expect((await me(web)).status).toBe(401);
      expect((await refresh(web)).status).toBe(401);
      expect((await me(replacement)).status).toBe(200);
      expect((await me(mobile)).status).toBe(200);
      const nextMobile = await login(role, device(true));
      expect((await me(mobile)).status).toBe(401);
      expect((await me(nextMobile)).status).toBe(200);
      expect((await me(replacement)).status).toBe(200);
      const [[count]] = await c.query<RowDataPacket[]>(
        'SELECT COUNT(*) total FROM login_sessions WHERE user_id=? AND revoked_at IS NULL',
        [web.id],
      );
      expect(Number(count.total)).toBe(2);
    },
  );
  it('开发者同类设备可以同时登录', async () => {
    const logins = await Promise.all([
      login('developer'),
      login('developer'),
      login('developer', device(true)),
      login('developer', device(true)),
    ]);
    for (const s of logins) expect((await me(s)).status).toBe(200);
  });
  it('并发登录仍只有一个同类会话', async () => {
    const logins = await Promise.all(Array.from({ length: 6 }, () => login('creator')));
    const checks = await Promise.all(logins.map((s) => me(s)));
    expect(checks.filter((r) => r.status === 200)).toHaveLength(1);
    const [[count]] = await c.query<RowDataPacket[]>(
      "SELECT COUNT(*) total FROM login_sessions WHERE user_id=5 AND client_type='web' AND revoked_at IS NULL",
    );
    expect(Number(count.total)).toBe(1);
  });
  it('客户端 ID 不匹配、缺失，以及改写类型字段均不能绕过校验', async () => {
    const s = await login('creator');
    expect((await me(s, device())).status).toBe(401);
    expect((await refresh(s, device())).status).toBe(401);
    expect((await request(app).get('/auth/me').auth(s.token, { type: 'bearer' })).status).toBe(401);
    expect((await request(app).post('/auth/login').send({ username: 'creator', password })).status).toBe(401);
    const replacement = await request(app)
      .post('/auth/login')
      .set(headers(device()))
      .send({ username: 'creator', password, clientType: 'mobile', role: 'developer' });
    expect(replacement.status).toBe(200);
    expect(replacement.body.data.user.role).toBe('creator');
    expect((await me(s)).status).toBe(401);
  });
  it('轮换保留设备关系；重放刷新令牌撤销会话且持久生效', async () => {
    const s = await login('creator');
    const rotated = await refresh(s);
    expect(rotated.status).toBe(200);
    const next = { ...s, token: rotated.body.data.token, cookie: rotated.get('Set-Cookie')![0].split(';')[0] };
    expect((await me(next)).status).toBe(200);
    expect((await refresh(s)).status).toBe(401);
    expect((await me(next)).status).toBe(401);
    expect((await refresh(next)).status).toBe(401);
  });
  it('退出立即撤销当前设备，另一类设备不受影响', async () => {
    const web = await login('creator'),
      mobile = await login('creator', device(true));
    expect(
      (await request(app).post('/auth/logout').set(headers(web.device)).auth(web.token, { type: 'bearer' })).status,
    ).toBe(200);
    expect((await me(web)).status).toBe(401);
    expect((await refresh(web)).status).toBe(401);
    expect((await me(mobile)).status).toBe(200);
  });
  it('没有 session ID 的存量令牌必须重新登录；数据库过期检查生效', async () => {
    const { signToken } = await import('../../src/auth/jwt');
    const token = await signToken({
      id: '5',
      role: 'creator',
      username: 'creator',
      displayName: 'creator',
      parentId: null,
    });
    expect((await request(app).get('/auth/me').set(headers(device())).auth(token, { type: 'bearer' })).status).toBe(
      401,
    );
    const s = await login('creator');
    await c.query('UPDATE login_sessions SET expires_at=DATE_SUB(NOW(),INTERVAL 1 DAY) WHERE user_id=5');
    expect((await me(s)).status).toBe(401);
    expect((await refresh(s)).status).toBe(401);
  });
});

describe('管理角色层级', () => {
  it('只有开发者能使用开发工具，运营可以处理关键词但不能读取接入密钥', async () => {
    for (const role of roles) {
      const s = await login(role);
      const get = (path: string) => request(app).get(path).set(headers(s.device)).auth(s.token, { type: 'bearer' });
      expect((await get('/developer-tool')).status).toBe(role === 'developer' ? 204 : 403);
      expect((await get('/operations')).status).toBe(['developer', 'admin', 'operator'].includes(role) ? 204 : 403);
      expect((await get('/callback-secret')).status).toBe(['developer', 'admin'].includes(role) ? 204 : 403);
    }
  });
  it('管理员只可创建运营管理员，运营不能创建管理账号，公开注册拒绝角色注入', async () => {
    const admin = await login('admin'),
      op = await login('operator');
    const create = (s: Login, role: string) =>
      request(app)
        .post('/staff')
        .set(headers(s.device))
        .auth(s.token, { type: 'bearer' })
        .send({ username: 'new_' + role, displayName: role, role, duty: 'all' });
    expect((await create(admin, 'developer')).status).toBe(403);
    expect((await create(admin, 'admin')).status).toBe(403);
    expect((await create(op, 'operator')).status).toBe(403);
    expect((await create(admin, 'operator')).status).toBe(201);
    const [[created]] = await c.query<RowDataPacket[]>(
      "SELECT role,admin_duty FROM users WHERE username='new_operator'",
    );
    expect(created).toMatchObject({ role: 'operator', admin_duty: 'operations' });
    expect(
      (await request(app).post('/auth/register').send({ username: 'escalation', password, role: 'developer' })).status,
    ).toBe(422);
  });
  it('开发者可创建管理员；低权限不能通过角色、重置密码、禁用接口操作高权限账号', async () => {
    const dev = await login('developer'),
      admin = await login('admin'),
      op = await login('operator');
    expect(
      (
        await request(app)
          .post('/staff')
          .set(headers(dev.device))
          .auth(dev.token, { type: 'bearer' })
          .send({ username: 'new_admin', displayName: '新管理员', role: 'admin', duty: 'all' })
      ).status,
    ).toBe(201);
    for (const [s, target] of [
      [admin, '1'],
      [op, '2'],
    ] as const) {
      expect(
        (
          await request(app)
            .patch('/staff/' + target)
            .set(headers(s.device))
            .auth(s.token, { type: 'bearer' })
            .send({ role: 'operator' })
        ).status,
      ).toBe(403);
      for (const action of ['reset-password', 'disable'])
        expect(
          (
            await request(app)
              .post('/team/members/' + target + '/' + action)
              .set(headers(s.device))
              .auth(s.token, { type: 'bearer' })
              .send({})
          ).status,
        ).toBe(403);
    }
  });
  it('降级开发者使原来所有设备退出，此后新角色受设备限制', async () => {
    const hash = await bcrypt.hash(password, 4);
    await c.query(
      "INSERT INTO users(username,password_hash,role,display_name) VALUES('secondary_dev',?,'developer','开发者二')",
      [hash],
    );
    const a = await login('secondary_dev'),
      b = await login('secondary_dev'),
      dev = await login('developer');
    expect(
      (
        await request(app)
          .patch('/staff/' + a.id)
          .set(headers(dev.device))
          .auth(dev.token, { type: 'bearer' })
          .send({ role: 'operator' })
      ).status,
    ).toBe(200);
    expect((await me(a)).status).toBe(401);
    expect((await me(b)).status).toBe(401);
    expect((await refresh(a)).status).toBe(401);
    const first = await login('secondary_dev'),
      second = await login('secondary_dev');
    expect((await me(first)).status).toBe(401);
    expect((await me(second)).status).toBe(200);
  });
  it('改密和管理员重置会撤销所有设备及刷新令牌', async () => {
    const a = await login('creator'),
      b = await login('creator', device(true)),
      admin = await login('admin');
    expect(
      (
        await request(app)
          .post('/team/members/5/reset-password')
          .set(headers(admin.device))
          .auth(admin.token, { type: 'bearer' })
          .send({ password })
      ).status,
    ).toBe(200);
    expect((await me(a)).status).toBe(401);
    expect((await me(b)).status).toBe(401);
    expect((await refresh(a)).status).toBe(401);
    const current = await login('creator');
    expect(
      (
        await request(app)
          .post('/auth/change-password')
          .set(headers(current.device))
          .auth(current.token, { type: 'bearer' })
          .send({ oldPassword: password, newPassword: password + '_new' })
      ).status,
    ).toBe(200);
    expect((await me(current)).status).toBe(401);
    expect((await refresh(current)).status).toBe(401);
  });
});
