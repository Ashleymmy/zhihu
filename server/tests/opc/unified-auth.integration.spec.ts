import { beforeAll, afterAll, it, expect } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import type { Express } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';
let container: StartedMySqlContainer, conn: mysql.Connection, app: Express, pool: typeof import('../../src/db').db;
const password = 'isolated_password';
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('unified_auth_test')
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
    NODE_ENV: 'test',
    DEV_DEMO_AUTH: '0',
    OPC_MODULES: '',
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
  });
  await runOpcMigrations(target, []);
  conn = await mysql.createConnection(target);
  const { createApp } = await import('../../src/app');
  pool = (await import('../../src/db')).db;
  app = createApp();
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (conn) await conn.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
}, 30000);
it('registers a creator and rejects escalation, duplicates, stale roles and disabled accounts', async () => {
  const endpoint = '/api/v1/core/auth/register';
  for (const fields of [
    { role: 'admin' },
    { role: 'leader' },
    { permissions: ['team.view'] },
    { parentId: '1' },
    { password: 'short' },
  ])
    expect(
      (
        await request(app)
          .post(endpoint)
          .send({ username: 'invalid_account', password, ...fields })
      ).status,
    ).toBe(422);
  const created = await request(app).post(endpoint).send({ username: 'new_creator', password });
  expect(created.status).toBe(201);
  const [users] = await conn.query<mysql.RowDataPacket[]>('SELECT * FROM users WHERE username=?', ['new_creator']);
  expect(users[0]).toMatchObject({ role: 'creator', parent_id: null, is_active: 1, must_change_pwd: 0 });
  expect(users[0].password_hash).not.toBe(password);
  expect(users[0].role_id).toBeTruthy();
  expect((await request(app).post(endpoint).send({ username: 'new_creator', password })).status).toBe(409);
  const agent = request.agent(app);
  const logged = await agent.post('/api/v1/core/auth/login').send({ username: 'new_creator', password });
  expect(logged.status).toBe(200);
  const auth = 'Bearer ' + logged.body.data.token;
  expect(logged.body.data.user.role).toBe('creator');
  expect((await agent.post('/api/v1/core/auth/refresh')).status).toBe(200);
  expect((await request(app).get('/api/v1/core/team/members').set('Authorization', auth)).status).toBe(403);
  await conn.query("UPDATE users SET role='leader' WHERE username='new_creator'");
  expect((await request(app).get('/api/v1/core/auth/me').set('Authorization', auth)).body.data.role).toBe('leader');
  await conn.query("UPDATE users SET is_active=0 WHERE username='new_creator'");
  expect((await request(app).get('/api/v1/core/projects').set('Authorization', auth)).status).toBe(401);
});
it('preserves deep links through the unified entry', async () => {
  for (const role of ['admin', 'leader', 'creator'])
    expect((await request(app).get('/' + role + '/projects?from=bookmark')).headers.location).toBe(
      '/app/projects?from=bookmark',
    );
});

it('handles simultaneous duplicates and limits registration attempts', async () => {
  const { deleteRateLimit } = await import('../../src/utils/rateLimit');
  await deleteRateLimit('register:ip:127.0.0.1');
  await deleteRateLimit('register:ip:::ffff:127.0.0.1');
  const endpoint = '/api/v1/core/auth/register';
  const attempts = await Promise.all(
    [1, 2].map(() => request(app).post(endpoint).send({ username: 'concurrent_creator', password })),
  );
  expect(attempts.map((result) => result.status).sort()).toEqual([201, 409]);
  const [accounts] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS total FROM users WHERE username=?', [
    'concurrent_creator',
  ]);
  expect(accounts[0].total).toBe(1);
  for (let i = 0; i < 3; i++)
    expect((await request(app).post(endpoint).send({ username: 'concurrent_creator', password })).status).toBe(409);
  expect((await request(app).post(endpoint).send({ username: 'rate_limited', password })).status).toBe(429);
});

it.skipIf(!process.env.OPC_PLAYWRIGHT_MODULE)(
  'registers in the browser and follows current account roles through one entry',
  async () => {
    const { createRequire } = await import('node:module');
    const { mkdir } = await import('node:fs/promises');
    const path = await import('node:path');
    const { chromium } = createRequire(path.resolve(process.cwd(), "package.json"))(process.env.OPC_PLAYWRIGHT_MODULE!);
    const { deleteRateLimit } = await import('../../src/utils/rateLimit');
    await deleteRateLimit('register:ip:127.0.0.1');
    await deleteRateLimit('register:ip:::ffff:127.0.0.1');
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const browser = await chromium.launch({ headless: true, channel: process.env.OPC_BROWSER_CHANNEL || 'msedge' });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      await page.route('**/*', (route: any) =>
        new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
      );
      await page.goto(base + '/app/register');
      await page.getByLabel('用户名', { exact: true }).fill('browser-creator');
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByLabel('确认密码', { exact: true }).fill('different_password');
      await page.getByLabel('昵称', { exact: true }).fill('浏览器测试账号');
      expect(await page.locator('#username').evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
      await page.locator('button[type=submit]').click();
      await page.getByRole('alert').filter({ hasText: '两次输入的密码不一致' }).waitFor();
      const out = path.resolve(process.cwd(), '../.opc-work/unified-ui');
      await mkdir(out, { recursive: true });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: path.join(out, 'register-mobile.png'), fullPage: true });
      await page.getByLabel('确认密码', { exact: true }).fill(password);
      await page.locator('button[type=submit]').click();
      await page.waitForURL('**/app/login?**');
      await page.getByRole('status').filter({ hasText: '注册成功' }).waitFor();
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.locator('button[type=submit]').click();
      await page.waitForURL('**/app/dashboard');
      await page.setViewportSize({ width: 1440, height: 1000 });
      const labels = { admin: '管理员', leader: '团长', creator: '达人' };
      for (const role of ['admin', 'leader', 'creator'] as const) {
        await conn.query('UPDATE users SET role=?,role_id=(SELECT id FROM roles WHERE role_key=?) WHERE username=?', [
          role,
          role,
          'browser-creator',
        ]);
        // A client-side navigation must fetch the current identity and replace its routes.
        await page.locator('.studio-nav').getByText('业务模块', { exact: true }).click();
        await page.getByText('Desk / ' + labels[role], { exact: true }).waitFor();
        expect(await page.locator('.studio-nav').getByText('团队与成员', { exact: true }).count()).toBe(
          role === 'creator' ? 0 : 1,
        );
        expect(await page.locator('.studio-nav').getByText('数据库状态', { exact: true }).count()).toBe(
          role === 'admin' ? 1 : 0,
        );
        await page
          .locator('.studio-nav')
          .getByText(role === 'creator' ? '个人资料' : '团队与成员', { exact: true })
          .click();
        await page.waitForURL('**/app/' + (role === 'creator' ? 'profile' : 'team'));
        await page.reload();
        await page.getByText('Desk / ' + labels[role], { exact: true }).waitFor();
        await page.screenshot({ path: path.join(out, role + '.png'), fullPage: true });
      }
      await page.goto(base + '/admin/system/db');
      await page.waitForURL('**/app/dashboard');
      await page.getByRole('button', { name: '退出登录' }).click();
      await page.waitForURL('**/app/login');
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  90000,
);
