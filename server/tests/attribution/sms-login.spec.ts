import { beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';
vi.mock('../../src/sms/aliyun', () => ({
  sendRegistrationSms: vi.fn(async () => undefined),
  sendAccountSms: vi.fn(async () => undefined),
}));
let container: StartedMySqlContainer,
  c: Connection,
  app: Express,
  pool: typeof import('../../src/db').db,
  serial = 0;
const appId = 'wx0000000000000001',
  bridgeSecret = 'isolated_sms_login_bridge_secret_long_enough',
  password = 'Sms_login_fixture_123';
const identity = (name: string) => ({ appId, openId: 'sms_login_fixture_identity_' + name });
function call(name: string, path: string, data: Record<string, unknown> = {}, token?: string, method = 'POST') {
  const raw = JSON.stringify({
    ...identity(name),
    path: '/core/auth/' + path,
    method,
    data,
    ...(token ? { token } : {}),
  });
  const time = String(Date.now()),
    nonce = crypto.randomBytes(16).toString('hex');
  return request(app)
    .post('/api/v1/mini/bridge')
    .set({
      'Content-Type': 'application/json',
      'X-Bridge-Time': time,
      'X-Bridge-Nonce': nonce,
      'X-Bridge-Signature': crypto.createHmac('sha256', bridgeSecret).update(`${time}\n${nonce}\n${raw}`).digest('hex'),
    })
    .send(raw);
}
async function person(verified = true, bound = true) {
  const n = ++serial,
    name = 'person' + n,
    phone = '138' + String(n).padStart(8, '0');
  const [result] = await c.query<ResultSetHeader>(
    "INSERT INTO users(username,password_hash,role,role_id,display_name,phone,phone_verified_at,is_active,must_change_pwd) VALUES(?,?,'creator',(SELECT id FROM roles WHERE role_key='creator'),?,?,IF(?,NOW(3),NULL),1,0)",
    [name, await bcrypt.hash(password, 4), name, phone, verified],
  );
  const id = String(result.insertId);
  if (bound)
    await c.query('INSERT INTO wechat_identities(app_id,open_id,user_id) VALUES(?,?,?)', [
      appId,
      identity(name).openId,
      id,
    ]);
  return { id, name, phone };
}
type Person = Awaited<ReturnType<typeof person>>;
const provider = async () => vi.mocked((await import('../../src/sms/aliyun')).sendAccountSms);
async function send(p: Person) {
  const r = await call(p.name, 'login-code', { phone: p.phone });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (await provider()).mock.calls.at(-1)![1];
}
const login = (p: Person, smsCode: string) => call(p.name, 'sms-login', { phone: p.phone, smsCode });
async function passwordLogin(p: Person) {
  const r = await call(p.name, 'login', { username: p.name, password });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data.token as string;
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('sms_login')
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
    WECHAT_APP_ID: appId,
    WECHAT_BRIDGE_SECRET: bridgeSecret,
    OPC_MODULES: '',
    DEV_DEMO_AUTH: '0',
  });
  await runOpcMigrations(target, []);
  await runOpcMigrations(target, []);
  c = await mysql.createConnection(target);
  pool = (await import('../../src/db')).db;
  app = (await import('../../src/core/app')).createCoreApp();
}, 180000);
beforeEach(async () => {
  Object.assign(process.env, {
    SMS_REGISTRATION_ENABLED: '1',
    SMS_REGISTRATION_PILOT_INVITATIONS: '',
    SMS_LOGIN_ENABLED: '1',
    SMS_SIGN_NAME: '测试签名',
    SMS_TEMPLATE_CODE: 'SMS_123456',
    SMS_VERIFICATION_SECRET: 'isolated_sms_login_verification_secret_long_enough',
    SMS_DAILY_LIMIT: '100',
  });
  await c.query('DELETE FROM sms_registration_challenges');
  await c.query('DELETE FROM sms_registration_limits');
  (await provider()).mockReset().mockResolvedValue(undefined);
});
afterAll(async () => {
  await (await import('../../src/wechat/observability')).flushMiniObservations();
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});
it('defaults off, validates settings and rejects unsigned direct requests', async () => {
  delete process.env.SMS_LOGIN_ENABLED;
  expect((await call('policy', 'sms-policy', {}, undefined, 'GET')).body.data).toEqual({ smsLoginEnabled: false });
  expect((await call('policy', 'login-code', { phone: '13800001234' })).status).toBe(503);
  process.env.SMS_LOGIN_ENABLED = 'typo';
  expect((await call('policy', 'sms-policy', {}, undefined, 'GET')).status).toBe(503);
  expect(
    (await request(app).post('/api/v1/core/mini-auth/sms-login').send({ phone: '13800001234', smsCode: '123456' }))
      .status,
  ).toBe(403);
  expect(await provider()).not.toHaveBeenCalled();
});
it('rejects unverified phones but allows unbound and different WeChat clients without binding', async () => {
  const legacy = await person(false),
    unbound = await person(true, false),
    verified = await person();
  expect((await call(legacy.name, 'login-code', { phone: legacy.phone })).status).toBe(403);
  for (const p of [unbound, { ...verified, name: 'different_wechat' }]) {
    const code = await send(p);
    expect((await login({ ...p, name: 'otp_thief' }, code)).status).toBe(422);
    expect((await login(p, code)).status).toBe(200);
  }
  const [[row]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM wechat_identities WHERE user_id=?', [
    unbound.id,
  ]);
  expect(row.n).toBe(0);
});
it('logs into the same account once, preserves attribution and both browser slots', async () => {
  const p = await person();
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions');
  await issueRefreshSession(p.id, { type: 'web', id: 'web_fixture' });
  await issueRefreshSession(p.id, { type: 'mobile', id: 'mobile_fixture' });
  await passwordLogin(p);
  const code = await send(p),
    r = await login(p, code);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.data.user.id).toBe(p.id);
  expect(r.body.data.user.role).toBe('creator');
  expect(r.body.data.user.parentId).toBeNull();
  expect((await call(p.name, 'me', {}, r.body.data.token, 'GET')).status).toBe(200);
  expect((await login(p, code)).status).toBe(422);
  const [rows] = await c.query<RowDataPacket[]>(
    'SELECT client_type,COUNT(*) n FROM login_sessions WHERE user_id=? AND revoked_at IS NULL GROUP BY client_type',
    [p.id],
  );
  expect(Object.fromEntries(rows.map((r) => [r.client_type, r.n]))).toEqual({ web: 1, mobile: 1, mini: 1 });
  const [[audit]] = await c.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM audit_logs WHERE user_id=? AND action='auth.sms_login'",
    [p.id],
  );
  expect(audit.n).toBe(1);
});
it('two simultaneous uses issue exactly one new session', async () => {
  const p = await person(),
    code = await send(p);
  const results = await Promise.all([login(p, code), login(p, code)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
  const [[count]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM login_sessions WHERE user_id=?', [p.id]);
  expect(count.n).toBe(1);
});
it('five wrong attempts are durable; expiry and wrong phone are rejected', async () => {
  const p = await person(),
    code = await send(p),
    wrong = code === '000000' ? '999999' : '000000';
  expect((await login({ ...p, phone: '13899999999' }, code)).status).toBe(403);
  for (let i = 0; i < 5; i++) expect((await login(p, wrong)).status).toBe(422);
  expect((await login(p, code)).status).toBe(422);
  const [[row]] = await c.query<RowDataPacket[]>('SELECT attempts FROM sms_registration_challenges');
  expect(row.attempts).toBe(5);
  await c.query('UPDATE sms_registration_challenges SET attempts=0,expires_at=DATE_SUB(NOW(3),INTERVAL 1 SECOND)');
  expect((await login(p, code)).status).toBe(422);
});
it.each(['password', 'phone', 'verification', 'disabled', 'reset'])(
  'invalidates pending login after %s changes',
  async (change) => {
    const p = await person(),
      code = await send(p);
    if (change === 'password')
      await c.query('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash('changed_password', 4), p.id]);
    if (change === 'phone') await c.query('UPDATE users SET phone=? WHERE id=?', ['13899999999', p.id]);
    if (change === 'verification') await c.query('UPDATE users SET phone_verified_at=NULL WHERE id=?', [p.id]);
    if (change === 'disabled') await c.query('UPDATE users SET is_active=0 WHERE id=?', [p.id]);
    if (change === 'reset') await c.query('UPDATE users SET must_change_pwd=1 WHERE id=?', [p.id]);
    expect((await login(p, code)).status).toBeOneOf([403, 422]);
    const [[row]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM login_sessions WHERE user_id=?', [p.id]);
    expect(row.n).toBe(0);
  },
);
it('verifies a legacy phone with current password and OTP then enables login', async () => {
  const p = await person(false, false),
    token = await passwordLogin(p);
  expect((await call(p.name, 'phone-code', { phone: p.phone, password: 'wrong' }, token)).status).toBe(422);
  expect((await call(p.name, 'phone-code', { phone: p.phone, password })).status).toBe(401);
  const sent = await call(p.name, 'phone-code', { phone: p.phone, password }, token);
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  const code = (await provider()).mock.calls.at(-1)![1];
  const r = await call(p.name, 'verify-phone', { phone: p.phone, password, smsCode: code }, token);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.data.phoneVerifiedAt).toBeTruthy();
  expect((await call(p.name, 'verify-phone', { phone: p.phone, password, smsCode: code }, token)).status).toBe(409);
  await c.query('UPDATE sms_registration_challenges SET created_at=DATE_SUB(NOW(3),INTERVAL 61 SECOND)');
  await c.query('DELETE FROM sms_registration_limits');
  expect((await login(p, await send(p))).status).toBe(200);
});
it('verification cannot change an existing phone or prove a number used by another account', async () => {
  const p = await person(false),
    other = await person(),
    token = await passwordLogin(p);
  expect((await call(p.name, 'phone-code', { phone: other.phone, password }, token)).status).toBe(409);
  await c.query('UPDATE users SET phone=NULL WHERE id=?', [p.id]);
  expect((await call(p.name, 'phone-code', { phone: other.phone, password }, token)).status).toBe(409);
  expect(await provider()).not.toHaveBeenCalled();
});
it('an empty contact can be verified and an identity cannot use another account token', async () => {
  const p = await person(false, false),
    token = await passwordLogin(p);
  await c.query('UPDATE users SET phone=NULL WHERE id=?', [p.id]);
  expect((await call('other_identity', 'phone-code', { phone: p.phone, password }, token)).status).toBe(401);
  expect((await call(p.name, 'phone-code', { phone: p.phone, password }, token)).status).toBe(200);
  expect(
    (
      await call(
        p.name,
        'verify-phone',
        { phone: p.phone, password, smsCode: (await provider()).mock.calls.at(-1)![1] },
        token,
      )
    ).status,
  ).toBe(200);
  const [[row]] = await c.query<RowDataPacket[]>('SELECT phone,phone_verified_at FROM users WHERE id=?', [p.id]);
  expect(row.phone).toBe(p.phone);
  expect(row.phone_verified_at).toBeTruthy();
});
it('separates code purposes and shares the send budget across them', async () => {
  const { sendRegistrationCode, verifyRegistrationCode, verifyAccountCode } =
    await import('../../src/sms/registration');
  const { wechatClientId } = await import('../../src/wechat/context');
  const p = await person(),
    code = await send(p),
    client = wechatClientId(identity(p.name));
  await expect(verifyRegistrationCode(p.phone, client, code)).rejects.toMatchObject({ code: 42220 });
  const [[row]] = await c.query<RowDataPacket[]>('SELECT subject_hash FROM sms_registration_challenges');
  await expect(verifyAccountCode(p.phone, client, code, 'phone_verify', row.subject_hash)).rejects.toMatchObject({
    code: 42220,
  });
  process.env.SMS_DAILY_LIMIT = '1';
  await expect(sendRegistrationCode('13888888888', 'another_identity')).rejects.toMatchObject({ httpStatus: 429 });
  expect(await provider()).toHaveBeenCalledTimes(1);
});
it('failed provider calls never produce usable codes and concurrent sends spend once', async () => {
  const p = await person();
  (await provider()).mockRejectedValueOnce(new Error('isolated_delivery_failure'));
  expect((await call(p.name, 'login-code', { phone: p.phone })).status).toBe(500);
  const code = (await provider()).mock.calls.at(-1)![1];
  expect((await login(p, code)).status).toBe(422);
  await c.query('DELETE FROM sms_registration_challenges');
  await c.query('DELETE FROM sms_registration_limits');
  const results = await Promise.all([
    call(p.name, 'login-code', { phone: p.phone }),
    call(p.name, 'login-code', { phone: p.phone }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
});
it('database unique constraint prevents two verified owners while retaining legacy unverified contacts', async () => {
  const a = await person(),
    b = await person(false);
  await c.query('UPDATE users SET phone=? WHERE id=?', [a.phone, b.id]);
  await expect(c.query('UPDATE users SET phone_verified_at=NOW(3) WHERE id=?', [b.id])).rejects.toMatchObject({
    code: 'ER_DUP_ENTRY',
  });
});
it('password login leaves WeChat unbound, and binding requires fresh password and phone proof', async () => {
  const p = await person(false, false),
    token = await passwordLogin(p);
  expect((await call(p.name, 'wechat-login')).body.data).toEqual({ needsBind: true });
  expect((await call(p.name, 'binding-status', {}, token, 'GET')).body.data).toEqual({
    bound: false,
    currentWechat: false,
  });
  const input = { username: p.name, password, phone: p.phone };
  expect((await call(p.name, 'bind', input)).status).toBe(422);
  expect((await call(p.name, 'bind-code', { ...input, password: 'wrong' })).status).toBe(401);
  expect((await call(p.name, 'bind-code', { ...input, phone: '13700000000' })).status).toBe(409);
  expect(await provider()).not.toHaveBeenCalled();
  expect((await call(p.name, 'bind-code', input)).status).toBe(200);
  const smsCode = (await provider()).mock.calls.at(-1)![1];
  expect((await call(p.name, 'sms-login', { phone: p.phone, smsCode })).status).toBe(403);
  expect((await call('thief', 'bind', { ...input, smsCode })).status).toBe(422);
  const r = await call(p.name, 'bind', { ...input, smsCode });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.data.user.phoneVerifiedAt).toBeTruthy();
  expect((await call(p.name, 'binding-status', {}, r.body.data.token, 'GET')).body.data).toEqual({
    bound: true,
    currentWechat: true,
  });
  expect((await call(p.name, 'wechat-login')).body.data.user.id).toBe(p.id);
  expect((await call(p.name, 'bind', { ...input, smsCode })).status).toBe(422);
});
it('profile binding targets the authenticated account, preserves its session and never overwrites other bindings', async () => {
  const p = await person(true, false),
    other = await person(),
    token = await passwordLogin(p);
  const input = { phone: p.phone, password };
  expect((await call(p.name, 'bind-current-code', { ...input, username: other.name }, token)).status).toBe(422);
  expect((await call('stolen', 'bind-current-code', input, token)).status).toBe(401);
  expect((await call(p.name, 'bind-current-code', input)).status).toBe(401);
  expect((await call(p.name, 'bind-current-code', input, token)).status).toBe(200);
  const smsCode = (await provider()).mock.calls.at(-1)![1];
  const results = await Promise.all([
    call(p.name, 'bind-current', { ...input, smsCode }, token),
    call(p.name, 'bind-current', { ...input, smsCode }, token),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
  expect((await call(p.name, 'me', {}, token, 'GET')).status).toBe(200);
  expect((await call('another_client', 'bind-code', { username: p.name, ...input })).status).toBe(409);
  expect((await call(p.name, 'bind-code', { username: other.name, password, phone: other.phone })).status).toBe(409);
  const [[count]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM wechat_identities WHERE user_id=?', [p.id]);
  expect(count.n).toBe(1);
});
it('a binding conflict arising after delivery leaves proof and account untouched', async () => {
  const p = await person(false, false),
    other = await person(),
    input = { username: p.name, password, phone: p.phone };
  expect((await call(p.name, 'bind-code', input)).status).toBe(200);
  const smsCode = (await provider()).mock.calls.at(-1)![1];
  await c.query('UPDATE wechat_identities SET open_id=? WHERE user_id=?', [identity(p.name).openId, other.id]);
  expect((await call(p.name, 'bind', { ...input, smsCode })).status).toBe(409);
  const [[challenge]] = await c.query<RowDataPacket[]>('SELECT state FROM sms_registration_challenges');
  expect(challenge.state).toBe('sent');
  const [[user]] = await c.query<RowDataPacket[]>('SELECT phone_verified_at FROM users WHERE id=?', [p.id]);
  expect(user.phone_verified_at).toBeNull();
});
it('binding proof expires when password or phone changes, and verification codes cannot bind', async () => {
  const p = await person(false, false),
    token = await passwordLogin(p),
    input = { phone: p.phone, password };
  expect((await call(p.name, 'phone-code', input, token)).status).toBe(200);
  const smsCode = (await provider()).mock.calls.at(-1)![1];
  expect((await call(p.name, 'bind', { username: p.name, ...input, smsCode })).status).toBe(422);
  await c.query('DELETE FROM sms_registration_challenges');
  await c.query('DELETE FROM sms_registration_limits');
  expect((await call(p.name, 'bind-code', { username: p.name, ...input })).status).toBe(200);
  const bindCode = (await provider()).mock.calls.at(-1)![1];
  await c.query('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash('new_password', 4), p.id]);
  expect(
    (await call(p.name, 'bind', { username: p.name, phone: p.phone, password: 'new_password', smsCode: bindCode }))
      .status,
  ).toBe(422);
});
