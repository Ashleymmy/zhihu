import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { runOpcMigrations } from '../../scripts/opcMigrations';
vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn() }));
let container: StartedMySqlContainer, c: Connection, pool: typeof import('../../src/db').db, app: express.Express;
const password = 'isolated_invitation_password';
let serial = 0;
const sessions: Record<string, { token: string; headers: Record<string, string> }> = {};
const headers = () => ({ 'X-Client-Id': randomUUID(), 'X-Forwarded-For': '10.2.0.' + ((++serial % 250) + 1) });
async function login(name: string) {
  const h = headers();
  const res = await request(app).post('/auth/login').set(h).send({ username: name, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (sessions[name] = { token: res.body.data.token, headers: h });
}
function call(name: string, method: 'get' | 'post' | 'patch' | 'delete', path: string) {
  return request(app)[method](path).set(sessions[name].headers).auth(sessions[name].token, { type: 'bearer' });
}
async function invite(name = 'leader', maxUses = 20) {
  const r = await call(name, 'post', '/team/invitations').send({ label: '测试邀请', validDays: 7, maxUses });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { id: string; token: string };
}
const register = (token: string, username = 'invited_' + ++serial) =>
  request(app).post('/auth/register').set(headers()).send({ username, password, invitationToken: token });
const preview = (token: string) => request(app).post('/auth/invitation').send({ token });
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('members_test')
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
  for (const [i, role] of ['developer', 'admin', 'operator', 'leader', 'creator', 'leader', 'admin'].entries())
    await c.query(
      'INSERT INTO users(id,username,password_hash,role,role_id,display_name,parent_id,admin_duty,must_change_pwd) VALUES(?,?,?,?,(SELECT id FROM roles WHERE role_key=?),?,?,?,0)',
      [
        i + 1,
        i === 5 ? 'other_leader' : i === 6 ? 'finance' : role,
        hash,
        role,
        role,
        i === 3 ? '邀请团长' : role,
        i === 4 ? 4 : null,
        i === 6 ? 'finance' : role === 'operator' ? 'operations' : 'all',
      ],
    );
  pool = (await import('../../src/db')).db;
  const { authRouter } = await import('../../src/routes/auth');
  const { teamRouter } = await import('../../src/routes/team');
  const { projectsRouter } = await import('../../src/routes/projects');
  const { errorHandler } = await import('../../src/middleware/errors');
  app = express()
    .set('trust proxy', 1)
    .use(express.json())
    .use('/auth', authRouter)
    .use('/team', teamRouter)
    .use('/projects', projectsRouter)
    .use(errorHandler);
  for (const name of ['developer', 'admin', 'operator', 'leader', 'creator', 'other_leader', 'finance'])
    await login(name);
}, 180000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

it('only authorized roles create invitations; malformed and privilege-bearing registration are rejected', async () => {
  for (const name of ['creator', 'finance'])
    expect((await call(name, 'post', '/team/invitations').send({ label: 'x' })).status).toBe(403);
  expect((await preview('invalid')).status).toBe(422);
  const i = await invite();
  expect(
    (
      await request(app)
        .post('/auth/register')
        .set(headers())
        .send({ username: 'escalation', password, invitationToken: i.token, role: 'developer' })
    ).status,
  ).toBe(422);
});
it('leader invitation records provenance and joins only the correct team, without granting project access', async () => {
  const i = await invite();
  expect((await preview(i.token)).body.data).toMatchObject({
    inviterName: '邀请团长',
    teamName: '邀请团长',
    role: 'creator',
  });
  const r = await register(i.token, 'joined_creator');
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const [[u]] = await c.query<RowDataPacket[]>('SELECT * FROM users WHERE id=?', [r.body.data.id]);
  expect(u.role).toBe('creator');
  expect(String(u.parent_id)).toBe('4');
  expect(String(u.created_by)).toBe('4');
  const [[p]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM project_members WHERE user_id=?', [u.id]);
  expect(p.n).toBe(0);
  const list = (await call('leader', 'get', '/team/members')).body.data;
  expect(list.find((m: any) => m.id === String(u.id))).toMatchObject({
    registrationSource: 'invitation',
    inviterName: '邀请团长',
    parentName: '邀请团长',
    canManage: true,
    editableRoles: ['creator'],
  });
  expect((await call('other_leader', 'get', '/team/members')).body.data.some((m: any) => m.id === String(u.id))).toBe(
    false,
  );
  expect((await call('leader', 'delete', '/team/members/' + u.id)).status).toBe(422);
});
it('staff invitation creates an independent creator and duplicate registration does not consume capacity', async () => {
  const i = await invite('operator', 2);
  expect((await register(i.token, 'creator')).status).toBe(409);
  const r = await register(i.token);
  expect(r.status).toBe(201);
  const [[u]] = await c.query<RowDataPacket[]>('SELECT role,parent_id,created_by FROM users WHERE id=?', [
    r.body.data.id,
  ]);
  expect(u.role).toBe('creator');
  expect(u.parent_id).toBeNull();
  expect(String(u.created_by)).toBe('3');
  const [[row]] = await c.query<RowDataPacket[]>('SELECT used_count,token_hash FROM member_invitations WHERE id=?', [
    i.id,
  ]);
  expect(row.used_count).toBe(1);
  expect(row.token_hash).not.toBe(i.token);
});
it('concurrent registrations cannot overdraw the final invitation slot', async () => {
  const i = await invite('leader', 1);
  const result = await Promise.all([register(i.token), register(i.token), register(i.token)]);
  expect(result.map((r) => r.status).sort()).toEqual([201, 422, 422]);
  const [[row]] = await c.query<RowDataPacket[]>('SELECT used_count FROM member_invitations WHERE id=?', [i.id]);
  expect(row.used_count).toBe(1);
  expect((await preview(i.token)).status).toBe(422);
});
it('invitation listing is private, tokens are never returned again, and another owner cannot revoke it', async () => {
  const i = await invite();
  expect((await call('other_leader', 'post', '/team/invitations/' + i.id + '/revoke')).status).toBe(403);
  expect((await call('developer', 'get', '/team/invitations')).body.data.some((r: any) => r.id === i.id)).toBe(false);
  const list = await call('leader', 'get', '/team/invitations');
  expect(JSON.stringify(list.body)).not.toContain(i.token);
  expect(JSON.stringify(list.body)).not.toContain('tokenHash');
  expect((await call('leader', 'post', '/team/invitations/' + i.id + '/revoke')).status).toBe(200);
  expect((await preview(i.token)).status).toBe(422);
  expect((await register(i.token)).status).toBe(422);
});
it('expired invitations and disabled or changed team owners cannot enroll users', async () => {
  const i = await invite();
  await c.query('UPDATE member_invitations SET expires_at=TIMESTAMPADD(SECOND,-1,NOW(3)) WHERE id=?', [i.id]);
  expect((await register(i.token)).status).toBe(422);
  const j = await invite();
  await c.query('UPDATE users SET is_active=0 WHERE id=4');
  expect((await preview(j.token)).status).toBe(422);
  expect((await register(j.token)).status).toBe(422);
  await c.query("UPDATE users SET is_active=1,role='creator' WHERE id=4");
  expect((await register(j.token)).status).toBe(422);
  await c.query("UPDATE users SET role='leader' WHERE id=4");
});
it('member editing enforces hierarchy, own-team scope, duty restrictions and creator management denial', async () => {
  for (const [actor, id, patch] of [
    ['admin', '1', { displayName: 'deny' }],
    ['admin', '2', { isActive: false }],
    ['operator', '2', { displayName: 'deny' }],
    ['operator', '5', { role: 'admin' }],
    ['leader', '5', { role: 'leader' }],
    ['other_leader', '5', { displayName: 'deny' }],
    ['creator', '5', { role: 'developer' }],
    ['finance', '5', { isActive: false }],
    ['admin', '5', { adminDuty: 'all' }],
  ] as const)
    expect((await call(actor, 'patch', '/team/members/' + id + '/access').send(patch)).status).toBe(403);
  expect((await call('leader', 'patch', '/team/members/5/access').send({ displayName: '更新达人' })).status).toBe(200);
  expect((await call('creator', 'get', '/projects/1/members')).status).toBe(403);
});
it('role, duty, status and team changes revoke existing sessions; profile-only edits preserve them', async () => {
  expect((await call('creator', 'get', '/auth/me')).status).toBe(200);
  expect((await call('developer', 'patch', '/team/members/5/access').send({ parentId: '6' })).status).toBe(200);
  expect((await call('creator', 'get', '/auth/me')).status).toBe(401);
  await login('creator');
  expect((await call('developer', 'patch', '/team/members/5/access').send({ role: 'operator' })).status).toBe(200);
  expect((await call('creator', 'get', '/auth/me')).status).toBe(401);
  await login('creator');
  expect((await call('developer', 'patch', '/team/members/5/access').send({ isActive: false })).status).toBe(200);
  expect((await call('creator', 'get', '/auth/me')).status).toBe(401);
  expect(
    (await call('developer', 'patch', '/team/members/5/access').send({ isActive: true, role: 'creator' })).status,
  ).toBe(200);
  await login('creator');
  const [[s]] = await c.query<RowDataPacket[]>(
    'SELECT COUNT(*) n FROM token_sessions WHERE user_id=5 AND revoked_at IS NULL',
  );
  expect(s.n).toBe(1);
  expect((await call('developer', 'patch', '/team/members/7/access').send({ adminDuty: 'operations' })).status).toBe(
    200,
  );
  expect((await call('finance', 'get', '/auth/me')).status).toBe(401);
});
it('team leaders with children cannot be reclassified and creators cannot join invalid teams', async () => {
  expect((await call('developer', 'patch', '/team/members/4/access').send({ role: 'creator' })).status).toBe(409);
  expect((await call('developer', 'patch', '/team/members/5/access').send({ parentId: '2' })).status).toBe(422);
  expect((await call('developer', 'delete', '/team/members/4')).status).toBe(422);
});
