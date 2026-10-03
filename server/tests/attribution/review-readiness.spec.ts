import { contentDigest } from '../../src/wechat/content-safety';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import { runMigrations } from '../../scripts/migrationRunner';
import path from 'node:path';
vi.mock('../../src/sms/aliyun', () => ({
  sendRegistrationSms: vi.fn(async () => undefined),
  sendAccountSms: vi.fn(async () => undefined),
}));
vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn(async () => ({ id: 'isolated' })) }));
let container: StartedMySqlContainer, c: Connection, app: express.Express, pool: typeof import('../../src/db').db;
const secret = 'isolated_wechat_bridge_signing_secret_32_chars',
  appId = 'wx0000000000000001',
  password = 'shared_account_test_password';
const openId = (name: string) => 'wechat_test_identity_' + name;
const tokens: Record<string, string> = {};
const scope = { projectId: '1', accountId: '' };
function signed(body: unknown, nonce = crypto.randomBytes(16).toString('hex'), time = String(Date.now())) {
  const raw = JSON.stringify(body),
    signature = crypto.createHmac('sha256', secret).update(`${time}\n${nonce}\n${raw}`).digest('hex');
  return {
    raw,
    headers: {
      'Content-Type': 'application/json',
      'X-Bridge-Time': time,
      'X-Bridge-Nonce': nonce,
      'X-Bridge-Signature': signature,
    },
  };
}
function call(name: string, path: string, method = 'GET', data: Record<string, unknown> = {}) {
  const contentSafety = {
    version: 1,
    digest: contentDigest(path, method, data),
    traceIds: ['isolated-provider-check'],
  };
  const { raw, headers } = signed({
    appId,
    openId: openId(name),
    path,
    method,
    data,
    token: tokens[name],
    contentSafety,
  });
  return request(app).post('/api/v1/mini/bridge').set(headers).send(raw);
}
async function login(name: string) {
  const r = await call(name, '/core/auth/login', 'POST', { username: name, password });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  tokens[name] = r.body.data.token;
  return r;
}
async function verifiedSignup(name: string, data: Record<string, unknown>) {
  const sent = await call(name, '/core/auth/registration-code', 'POST', {
    phone: data.phone,
    ...(data.inviteCode ? { inviteCode: data.inviteCode } : {}),
  });
  if (sent.status !== 200) return sent;
  const smsCode = vi.mocked((await import('../../src/sms/aliyun')).sendRegistrationSms).mock.calls.at(-1)![1];
  return call(name, '/core/auth/register', 'POST', { ...data, smsCode });
}
const webSessions = new Map<string, { token: string; client: string }>();
async function webMonitor(name: string) {
  let session = webSessions.get(name);
  if (!session) {
    const client = crypto.randomUUID();
    const response = await request(app)
      .post('/api/v1/core/auth/login')
      .set('X-Client-Id', client)
      .send({ username: name, password });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    session = { token: response.body.data.token, client };
    webSessions.set(name, session);
  }
  return request(app)
    .get('/api/v1/core/mini-monitor')
    .set('X-Client-Id', session.client)
    .auth(session.token, { type: 'bearer' });
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('wechat')
    .withUsername('test')
    .withUserPassword('test')
    .start();
  const target = {
    host: container.getHost(),
    port: container.getPort(),
    user: container.getUsername(),
    password: container.getUserPassword(),
    database: container.getDatabase(),
  };
  Object.assign(process.env, {
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_USER: target.user,
    DB_PASS: target.password,
    DB_NAME: target.database,
    WECHAT_BRIDGE_SECRET: secret,
    WECHAT_APP_ID: appId,
    OPC_MODULES: 'zhihu',
    DEV_DEMO_AUTH: '0',
    SMS_REGISTRATION_ENABLED: '1',
    SMS_LOGIN_ENABLED: '1',
    SMS_REGISTRATION_PILOT_INVITATIONS: '',
    SMS_SIGN_NAME: '测试签名',
    SMS_TEMPLATE_CODE: 'SMS_123456',
    SMS_VERIFICATION_SECRET: 'isolated_wechat_verification_secret_long_enough',
    SMS_DAILY_LIMIT: '100',
    MINI_CONTENT_SAFETY_REQUIRED: '1',
  });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  const hash = await bcrypt.hash(password, 4);
  for (const [i, role] of ['admin', 'leader', 'creator', 'operator', 'developer'].entries())
    await c.query(
      'INSERT INTO users(id,username,password_hash,role,role_id,display_name,admin_duty,must_change_pwd) VALUES(?,?,?,?,(SELECT id FROM roles WHERE role_key=?),?,?,0)',
      [i + 1, role, hash, role, role, role, role === 'operator' ? 'operations' : 'all'],
    );
  for (const [id, name] of [
    [3, 'creator'],
    [2, 'leader'],
  ])
    await c.query('INSERT INTO wechat_identities(app_id,open_id,user_id) VALUES(?,?,?)', [
      appId,
      openId(String(name)),
      id,
    ]);
  await c.query('UPDATE users SET phone=? WHERE id=2', ['13800000002']);
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3)');
  const [[account]] = await c.query<RowDataPacket[]>('SELECT id FROM integration_accounts LIMIT 1');
  scope.accountId = String(account.id);
  await c.query(
    "INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'channel',1,'测试渠道')",
  );
  await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'task','测试任务',NOW())");
  pool = (await import('../../src/db')).db;
  const { ModuleRuntime } = await import('../../src/core/module-runtime');
  const { createCoreApp } = await import('../../src/core/app');
  const { zhihuManifest } = await import('../../src/modules/zhihu/manifest');
  const { attributionRouter } = await import('../../src/modules/zhihu/routes/attribution');
  const { miniBusinessRouter } = await import('../../src/wechat/business');
  const { compositionsRouter } = await import('../../src/modules/zhihu/routes/compositions');
  const runtime = new ModuleRuntime([zhihuManifest]);
  runtime.register({
    manifest: zhihuManifest,
    router: express.Router().use(miniBusinessRouter).use(attributionRouter).use('/compositions', compositionsRouter),
  });
  app = createCoreApp(runtime);
}, 180000);
afterAll(async () => {
  await (await import('../../src/wechat/observability')).flushMiniObservations();
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

let sequence = 100;
async function fresh(role = 'creator') {
  const id = String(++sequence),
    name = 'review_' + id,
    hash = await bcrypt.hash(password, 4);
  await c.query(
    'INSERT INTO users(id,username,password_hash,role,role_id,display_name,must_change_pwd) VALUES(?,?,?,?,(SELECT id FROM roles WHERE role_key=?),?,0)',
    [id, name, hash, role, role, '可删除昵称'],
  );
  await login(name);
  return { id, name };
}
const closure = (u: { name: string; id: string }, extra: Record<string, unknown> = {}) =>
  call(u.name, '/core/account-privacy/closure', 'POST', {
    userId: u.id,
    password,
    confirmation: '注销网站及小程序共用账号',
    ...extra,
  });

it('requires a genuine signed content proof before updating publishable text', async () => {
  await login('creator');
  const body = {
    appId,
    openId: openId('creator'),
    path: '/core/auth/profile',
    method: 'POST',
    data: { displayName: 'unchecked' },
    token: tokens.creator,
  };
  for (const bad of [body, { ...body, contentSafety: { version: 1, digest: '0'.repeat(64), traceIds: [] } }]) {
    const s = signed(bad);
    const r = await request(app).post('/api/v1/mini/bridge').set(s.headers).send(s.raw);
    expect(r.status).toBe(503);
  }
  const [[row]] = await c.query<RowDataPacket[]>('SELECT display_name FROM users WHERE id=3');
  expect(row.display_name).toBe('creator');
  expect((await call('creator', '/core/auth/profile', 'POST', { displayName: '通过审核的昵称' })).status).toBe(200);
});
it('lets users erase optional contact data without writing it into audit detail', async () => {
  await login('creator');
  expect((await call('creator', '/core/auth/profile', 'POST', { contact: 'private_contact' })).status).toBe(200);
  expect((await call('creator', '/core/auth/profile', 'POST', { contact: '' })).status).toBe(200);
  const [logs] = await c.query<RowDataPacket[]>(
    "SELECT detail_json FROM audit_logs WHERE action='auth.profile_update'",
  );
  expect(JSON.stringify(logs)).not.toContain('private_contact');
});
it('requires authentication, account match, password and explicit irreversible confirmation', async () => {
  expect((await call('none', '/core/account-privacy/closure')).status).toBe(401);
  const u = await fresh();
  expect((await closure(u, { userId: '1' })).status).toBe(409);
  expect((await closure(u, { confirmation: 'yes' })).status).toBe(422);
  expect((await closure(u, { password: 'wrong' })).status).toBe(422);
  const [[row]] = await c.query<RowDataPacket[]>('SELECT closed_at,is_active FROM users WHERE id=?', [u.id]);
  expect(row.closed_at).toBeNull();
  expect(row.is_active).toBe(1);
});
it('blocks unresolved finances per scope rather than netting separate project balances', async () => {
  const u = await fresh();
  await c.query("INSERT INTO projects(id,name,slug) VALUES(2,'另一项目','review-two')");
  for (const [project, amount] of [
    [1, '10'],
    [2, '-10'],
  ]) {
    const [s] = await c.query<mysql.ResultSetHeader>(
      "INSERT INTO opc_income_sources(module_id,project_id,account_id,source_key,business_date,source_version,snapshot_hash,description) VALUES('zhihu',?,?,?,CURDATE(),'v1',?,'业务依据')",
      [project, scope.accountId, 'closure-' + project, 'a'.repeat(64)],
    );
    await c.query(
      'INSERT INTO opc_income_entries(source_id,source_version,user_id,amount,target_amount,confirmed_by) VALUES(?,?,?,?,?,1)',
      [s.insertId, 'v1', u.id, amount, amount],
    );
  }
  const status = await call(u.name, '/core/account-privacy/closure');
  expect(status.body.data.canClose).toBe(false);
  expect(status.body.data.blockers.join()).toContain('结清');
  expect((await closure(u)).status).toBe(409);
});
it('blocks closing before member and project ownership handover', async () => {
  const leader = await fresh('leader'),
    child = await fresh();
  await c.query('UPDATE users SET parent_id=? WHERE id=?', [leader.id, child.id]);
  expect((await call(leader.name, '/core/account-privacy/closure')).body.data.blockers.join()).toContain(
    '移交名下成员',
  );
  expect((await closure(leader)).status).toBe(409);
  await c.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES(1,?,'owner')", [child.id]);
  expect((await closure(child)).body.message).toContain('移交负责的项目');
});
it('prevents the last developer from closing and preserves the database terminal-state invariant', async () => {
  await login('developer');
  const r = await call('developer', '/core/account-privacy/closure');
  expect(r.body.data.blockers.join()).toContain('最后一个开发者');
  expect((await closure({ name: 'developer', id: '5' })).status).toBe(409);
});
it('erases profile and login bindings, closes Web and mini together, and revokes invitation links', async () => {
  const u = await fresh();
  await c.query('UPDATE users SET email=?,phone=?,phone_verified_at=NOW(),zhihu_uid=? WHERE id=?', [
    'private@example.invalid',
    '13900000111',
    'zhihu-private',
    u.id,
  ]);
  await c.query('INSERT INTO wechat_profiles(user_id,contact) VALUES(?,?)', [u.id, 'private-contact']);
  await c.query('INSERT INTO wechat_identities(app_id,open_id,user_id) VALUES(?,?,?)', [appId, openId(u.name), u.id]);
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,?)', [u.id]);
  const [invite] = await c.query<mysql.ResultSetHeader>(
    'INSERT INTO member_invitations(owner_user_id,token_hash,label,expires_at,max_uses) VALUES(?,?,?,TIMESTAMPADD(DAY,1,NOW()),5)',
    [u.id, 'b'.repeat(64), 'private-label'],
  );
  await c.query('INSERT INTO mini_invitation_codes(invitation_id,code,token_hash) VALUES(?,?,?)', [
    invite.insertId,
    'ABCD2345',
    'b'.repeat(64),
  ]);
  const client = crypto.randomUUID();
  const web = await request(app)
    .post('/api/v1/core/auth/login')
    .set('X-Client-Id', client)
    .send({ username: u.name, password });
  expect(web.status).toBe(200);
  expect((await call(u.name, '/core/account-privacy/closure')).body.data.canClose).toBe(true);
  const result = await closure(u);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const [[row]] = await c.query<RowDataPacket[]>('SELECT * FROM users WHERE id=?', [u.id]);
  expect(row.closed_at).toBeTruthy();
  expect(row.is_active).toBe(0);
  expect(row.username).not.toBe(u.name);
  expect(row.display_name).toBe('已注销用户');
  expect(row.phone).toBeNull();
  expect(row.email).toBeNull();
  expect(row.zhihu_uid).toBeNull();
  expect(await bcrypt.compare(password, row.password_hash)).toBe(false);
  for (const table of ['wechat_identities', 'wechat_profiles', 'login_sessions', 'token_sessions', 'project_members']) {
    const [[n]] = await c.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${table} WHERE user_id=?`, [u.id]);
    expect(n.n, table).toBe(0);
  }
  const [[inv]] = await c.query<RowDataPacket[]>(
    'SELECT revoked_at,deleted_at,token_cipher,label FROM member_invitations WHERE id=?',
    [invite.insertId],
  );
  expect(inv.revoked_at).toBeTruthy();
  expect(inv.token_cipher).toBeNull();
  expect(inv.label).not.toContain('private');
  expect((await call(u.name, '/core/auth/me')).status).toBe(401);
  expect(
    (
      await request(app)
        .get('/api/v1/core/auth/me')
        .set('X-Client-Id', client)
        .auth(web.body.data.token, { type: 'bearer' })
    ).status,
  ).toBe(401);
  expect((await call(u.name, '/core/auth/wechat-login', 'POST')).body.data.needsBind).toBe(true);
  await expect(c.query('UPDATE users SET is_active=1 WHERE id=?', [u.id])).rejects.toBeTruthy();
});
it('rolls back profile deletion and account closing together when a database mutation fails', async () => {
  const u = await fresh();
  await c.query('INSERT INTO wechat_profiles(user_id,contact) VALUES(?,?)', [u.id, 'preserve-on-failure']);
  await c.query(
    "CREATE TRIGGER isolated_closure_failure BEFORE DELETE ON wechat_profiles FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated failure'",
  );
  try {
    expect((await closure(u)).status).toBe(500);
  } finally {
    await c.query('DROP TRIGGER isolated_closure_failure');
  }
  const [[row]] = await c.query<RowDataPacket[]>('SELECT username,is_active,closed_at FROM users WHERE id=?', [u.id]);
  expect(row.username).toBe(u.name);
  expect(row.is_active).toBe(1);
  expect(row.closed_at).toBeNull();
  expect((await call(u.name, '/core/auth/me')).status).toBe(200);
});
it('serializes repeated closing and concurrent profile updates without reviving personal data', async () => {
  const u = await fresh();
  const rs = await Promise.all([
    closure(u),
    closure(u),
    call(u.name, '/core/auth/profile', 'POST', { displayName: '竞态昵称', contact: 'race-contact' }),
  ]);
  expect(rs.slice(0, 2).filter((r) => r.status === 200)).toHaveLength(1);
  const [[row]] = await c.query<RowDataPacket[]>('SELECT display_name,closed_at FROM users WHERE id=?', [u.id]);
  expect(row.display_name).toBe('已注销用户');
  expect(row.closed_at).toBeTruthy();
  const [[n]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM wechat_profiles WHERE user_id=?', [u.id]);
  expect(n.n).toBe(0);
});
