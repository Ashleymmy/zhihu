import { beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { AuthUser } from '../../src/types';
import { runOpcMigrations } from '../../scripts/opcMigrations';
vi.mock('../../src/sms/aliyun', () => ({ sendRegistrationSms: vi.fn(async () => undefined) }));
let container: StartedMySqlContainer, c: Connection, app: Express, pool: typeof import('../../src/db').db;
let invitationId: string,
  inviteCode = 'ABCDEFGH',
  serial = 0;
const appId = 'wx0000000000000001',
  secret = 'isolated_sms_bridge_secret_longer_than_32';
const actor = { sub: '1', role: 'leader', adminDuty: 'all', username: 'smsleader', parentId: null } as AuthUser;
const identity = (name: string) => ({ appId, openId: 'sms_test_wechat_identity_' + name });
function call(name: string, path: string, method = 'POST', data: Record<string, unknown> = {}) {
  const raw = JSON.stringify({ ...identity(name), path, method, data });
  const time = String(Date.now()),
    nonce = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', secret).update(`${time}\n${nonce}\n${raw}`).digest('hex');
  return request(app)
    .post('/api/v1/mini/bridge')
    .set({
      'Content-Type': 'application/json',
      'X-Bridge-Time': time,
      'X-Bridge-Nonce': nonce,
      'X-Bridge-Signature': signature,
    })
    .send(raw);
}
function fresh() {
  const n = ++serial;
  return { name: 'person' + n, phone: '139' + String(n).padStart(8, '0') };
}
async function provider() {
  return vi.mocked((await import('../../src/sms/aliyun')).sendRegistrationSms);
}
async function send(person: ReturnType<typeof fresh>) {
  const response = await call(person.name, '/core/auth/registration-code', 'POST', { phone: person.phone, inviteCode });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (await provider()).mock.calls.at(-1)![1];
}
function signup(person: ReturnType<typeof fresh>, smsCode?: string, selectedInviteCode = inviteCode) {
  return call(person.name, '/core/auth/register', 'POST', {
    phone: person.phone,
    password: 'Sms_test_password_123',
    inviteCode: selectedInviteCode,
    ...(smsCode ? { smsCode } : {}),
  });
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('sms_test')
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
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
    WECHAT_APP_ID: appId,
    WECHAT_BRIDGE_SECRET: secret,
    OPC_MODULES: '',
    DEV_DEMO_AUTH: '0',
  });
  await runOpcMigrations(target, []);
  await runOpcMigrations(target, []);
  c = await mysql.createConnection(target);
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,role_id,display_name,is_active,must_change_pwd) VALUES(1,'smsleader','unused','leader',(SELECT id FROM roles WHERE role_key='leader'),'短信测试团长',1,0)",
  );
  const invitation = await (
    await import('../../src/services/invitations.service')
  ).createInvitation(actor, { label: 'sms_test', validDays: 7, maxUses: 1000 });
  invitationId = invitation.id;
  await c.query(
    'INSERT INTO mini_invitation_codes(invitation_id,code,token_hash) SELECT id,?,token_hash FROM member_invitations WHERE id=?',
    [inviteCode, invitationId],
  );
  pool = (await import('../../src/db')).db;
  app = (await import('../../src/core/app')).createCoreApp();
}, 180000);
beforeEach(async () => {
  Object.assign(process.env, {
    SMS_REGISTRATION_ENABLED: '1',
    SMS_LOGIN_ENABLED: '0',
    SMS_REGISTRATION_PILOT_INVITATIONS: '',
    SMS_SIGN_NAME: '测试签名',
    SMS_TEMPLATE_CODE: 'SMS_123456',
    SMS_VERIFICATION_SECRET: 'isolated_sms_verification_secret_longer_than_32',
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
it('defaults off and never exposes signing settings; malformed configuration fails closed', async () => {
  delete process.env.SMS_REGISTRATION_ENABLED;
  expect((await call('policy', '/core/auth/registration-policy', 'GET')).body.data).toEqual({
    smsRequired: true,
    smsEnabled: false,
  });
  expect(
    (await call('policy', '/core/auth/registration-code', 'POST', { phone: fresh().phone, inviteCode })).status,
  ).toBe(503);
  process.env.SMS_REGISTRATION_ENABLED = 'typo';
  expect((await call('policy', '/core/auth/registration-policy', 'GET')).status).toBe(503);
  process.env.SMS_REGISTRATION_ENABLED = '1';
  process.env.SMS_SIGN_NAME = '';
  expect((await call('policy', '/core/auth/registration-policy', 'GET')).status).toBe(503);
  expect(await provider()).not.toHaveBeenCalled();
});
it('requires trusted bridge identity; validates invite and account before sending', async () => {
  const p = fresh();
  expect(
    (await request(app).post('/api/v1/core/mini-auth/registration-code').send({ phone: p.phone, inviteCode })).status,
  ).toBe(403);
  expect(
    (await call(p.name, '/core/auth/registration-code', 'POST', { phone: p.phone, inviteCode: 'ZZZZZZZZ' })).status,
  ).toBe(422);
  await c.query(
    "INSERT INTO users(username,password_hash,role,display_name,phone) VALUES(?,'unused','creator','old',?)",
    [p.phone, p.phone],
  );
  expect((await call(p.name, '/core/auth/registration-code', 'POST', { phone: p.phone, inviteCode })).status).toBe(409);
  expect(await provider()).not.toHaveBeenCalled();
});
it('only returns TTL; stores hashes, requires OTP even for old clients and preserves invitation on invalid code', async () => {
  const p = fresh();
  const before = await c.query<RowDataPacket[]>('SELECT used_count FROM member_invitations WHERE id=?', [invitationId]);
  const code = await send(p);
  expect(code).toMatch(/^\d{6}$/);
  const [[row]] = await c.query<RowDataPacket[]>('SELECT * FROM sms_registration_challenges');
  expect(JSON.stringify(row)).not.toContain(p.phone);
  expect(row.code_hash).not.toBe(code);
  expect(row.identity_hash).not.toBe(identity(p.name).openId);
  expect((await signup(p)).status).toBe(422);
  expect((await signup(p, code === '000000' ? '999999' : '000000')).status).toBe(422);
  const [[after]] = await c.query<RowDataPacket[]>('SELECT used_count FROM member_invitations WHERE id=?', [
    invitationId,
  ]);
  expect(after.used_count).toBe(before[0][0].used_count);
  const [[count]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM users WHERE username=?', [p.phone]);
  expect(count.n).toBe(0);
});
it('registers one unified, verified account without automatically binding WeChat with the correct leader and consumes once', async () => {
  const p = fresh(),
    code = await send(p),
    r = await signup(p, code);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.body.data.user.phoneVerifiedAt).toBeTruthy();
  expect(r.body.data.user.parentId).toBe('1');
  const [[row]] = await c.query<RowDataPacket[]>(
    'SELECT u.phone_verified_at,w.open_id,i.user_id FROM users u LEFT JOIN wechat_identities w ON w.user_id=u.id JOIN member_invitation_uses i ON i.user_id=u.id WHERE u.username=?',
    [p.phone],
  );
  expect(row.phone_verified_at).toBeTruthy();
  expect(row.open_id).toBeNull();
  expect((await signup(p, code)).status).toBe(422);
});
it('wrong identity or phone cannot use a code, and expiry blocks registration', async () => {
  const p = fresh(),
    code = await send(p);
  expect((await signup({ ...p, name: 'other' }, code)).status).toBe(422);
  expect((await signup({ ...p, phone: fresh().phone }, code)).status).toBe(422);
  await c.query('UPDATE sms_registration_challenges SET expires_at=DATE_SUB(NOW(3),INTERVAL 1 SECOND)');
  expect((await signup(p, code)).status).toBe(422);
});
it('commits failed attempt counts and rejects the correct code after five errors', async () => {
  const p = fresh(),
    code = await send(p);
  for (let i = 0; i < 5; i++) expect((await signup(p, code === '000000' ? '999999' : '000000')).status).toBe(422);
  const [[row]] = await c.query<RowDataPacket[]>('SELECT attempts FROM sms_registration_challenges');
  expect(row.attempts).toBe(5);
  expect((await signup(p, code)).status).toBe(422);
});
it('prevents concurrent duplicate SMS and strictly enforces the global budget', async () => {
  process.env.SMS_DAILY_LIMIT = '1';
  const p = fresh();
  const results = await Promise.all([sendRequest(p), sendRequest(p)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
  expect(await provider()).toHaveBeenCalledTimes(1);
  expect((await sendRequest(fresh())).status).toBe(429);
  expect(await provider()).toHaveBeenCalledTimes(1);
});
function sendRequest(p: ReturnType<typeof fresh>) {
  return call(p.name, '/core/auth/registration-code', 'POST', { phone: p.phone, inviteCode });
}
it('resend invalidates prior challenge and recipient cooldown cannot be bypassed by another WeChat', async () => {
  const p = fresh(),
    code = await send(p);
  expect((await sendRequest({ ...p, name: 'secondwechat' })).status).toBe(429);
  await c.query('UPDATE sms_registration_challenges SET created_at=DATE_SUB(NOW(3),INTERVAL 61 SECOND)');
  await c.query('DELETE FROM sms_registration_limits');
  const { verifyRegistrationCode, consumeRegistrationCode } = await import('../../src/sms/registration');
  const { wechatClientId } = await import('../../src/wechat/context');
  const proof = await verifyRegistrationCode(p.phone, wechatClientId(identity(p.name)), code);
  const next = await send(p);
  const { withTransaction } = await import('../../src/db');
  await expect(withTransaction((tx) => consumeRegistrationCode(tx, proof, '1'))).rejects.toMatchObject({
    httpStatus: 422,
  });
  expect((await signup(p, next)).status).toBe(201);
});
it('concurrent registration consumes one invitation and produces one member', async () => {
  const p = fresh(),
    code = await send(p);
  const results = await Promise.all([signup(p, code), signup(p, code)]);
  expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  const [[row]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM users WHERE username=?', [p.phone]);
  expect(row.n).toBe(1);
});
it('registration preserves an existing WeChat binding and does not switch its owner', async () => {
  const p = fresh(),
    code = await send(p);
  await c.query('INSERT INTO wechat_identities(app_id,open_id,user_id) VALUES(?,?,1)', [
    appId,
    identity(p.name).openId,
  ]);
  const r = await signup(p, code);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const [[link]] = await c.query<RowDataPacket[]>(
    'SELECT user_id FROM wechat_identities WHERE app_id=? AND open_id=?',
    [appId, identity(p.name).openId],
  );
  expect(String(link.user_id)).toBe('1');
  await c.query('DELETE FROM wechat_identities WHERE user_id=1');
});
it('no invitation registers a verified independent creator with no WeChat link or invitation use', async () => {
  const p = fresh();
  expect((await call(p.name, '/core/auth/registration-code', 'POST', { phone: p.phone })).status).toBe(200);
  const smsCode = (await provider()).mock.calls.at(-1)![1];
  const r = await call(p.name, '/core/auth/register', 'POST', {
    phone: p.phone,
    password: 'Sms_test_password_123',
    smsCode,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.body.data.user).toMatchObject({ role: 'creator', parentId: null });
  expect(r.body.data.user.phoneVerifiedAt).toBeTruthy();
  const id = r.body.data.user.id;
  for (const table of ['member_invitation_uses', 'wechat_identities']) {
    const [[count]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM ' + table + ' WHERE user_id=?', [id]);
    expect(count.n).toBe(0);
  }
});
it('keeps failures charged to quotas and never accepts a code whose send failed', async () => {
  const { AppError } = await import('../../src/middleware/errors');
  (await provider()).mockRejectedValue(new AppError(503, 50321, '短信暂时无法发送，请稍后再试'));
  const p = fresh();
  expect((await sendRequest(p)).status).toBe(503);
  const code = (await provider()).mock.calls[0][1];
  expect((await signup(p, code)).status).toBe(422);
  expect((await sendRequest(p)).status).toBe(429);
});
it('rolls back a lost proof consumption and leaves no partially verified user', async () => {
  const p = fresh(),
    code = await send(p);
  const { verifyRegistrationCode, consumeRegistrationCode } = await import('../../src/sms/registration');
  const { wechatClientId } = await import('../../src/wechat/context');
  const proof = await verifyRegistrationCode(p.phone, wechatClientId(identity(p.name)), code);
  const { withTransaction } = await import('../../src/db');
  await expect(
    withTransaction(async (tx) => {
      await consumeRegistrationCode(tx, proof, '1');
      throw new Error('rollback_fixture');
    }),
  ).rejects.toThrow('rollback_fixture');
  const [[row]] = await c.query<RowDataPacket[]>('SELECT phone_verified_at FROM users WHERE id=1');
  expect(row.phone_verified_at).toBeNull();
  expect((await signup(p, code)).status).toBe(201);
});
it('same phone edit preserves verification, changed phone clears it through both member routes', async () => {
  const p = fresh(),
    code = await send(p),
    r = await signup(p, code),
    id = String(r.body.data.user.id);
  const { updateMemberAccess } = await import('../../src/services/member-access.service');
  await updateMemberAccess(actor, id, { phone: p.phone });
  let [[row]] = await c.query<RowDataPacket[]>('SELECT phone_verified_at FROM users WHERE id=?', [id]);
  expect(row.phone_verified_at).toBeTruthy();
  await updateMemberAccess(actor, id, { phone: '13899990001' });
  [[row]] = await c.query<RowDataPacket[]>('SELECT phone_verified_at FROM users WHERE id=?', [id]);
  expect(row.phone_verified_at).toBeNull();
  await c.query('UPDATE users SET phone_verified_at=NOW(3) WHERE id=?', [id]);
  const { updateMember } = await import('../../src/services/team.service');
  await updateMember(actor, id, { phone: '13899990002' });
  [[row]] = await c.query<RowDataPacket[]>('SELECT phone_verified_at FROM users WHERE id=?', [id]);
  expect(row.phone_verified_at).toBeNull();
});
it('disabled rollout never permits registration without phone verification', async () => {
  process.env.SMS_REGISTRATION_ENABLED = '0';
  const p = fresh(),
    r = await signup(p);
  expect(r.status).toBe(422);
  expect((await signup(p, '123456')).status).toBe(503);
  expect(await provider()).not.toHaveBeenCalled();
});
it('pilot policy uses validated invitations and does not permit non-pilot unverified registration', async () => {
  const pilot = fresh(),
    outsider = fresh();
  const invitation = await (
    await import('../../src/services/invitations.service')
  ).createInvitation(actor, { label: 'non_pilot', validDays: 7, maxUses: 10 });
  await c.query(
    'INSERT INTO mini_invitation_codes(invitation_id,code,token_hash) SELECT id,?,token_hash FROM member_invitations WHERE id=?',
    ['JKLMNPQR', invitation.id],
  );
  const [[record]] = await c.query<RowDataPacket[]>('SELECT token_hash FROM member_invitations WHERE id=?', [
    invitationId,
  ]);
  process.env.SMS_REGISTRATION_ENABLED = '0';
  process.env.SMS_REGISTRATION_PILOT_INVITATIONS = record.token_hash;
  expect((await call(pilot.name, '/core/auth/registration-policy', 'GET', { inviteCode })).body.data).toEqual({
    smsRequired: true,
    smsEnabled: true,
  });
  expect(
    (
      await call(outsider.name, '/core/auth/registration-policy', 'GET', {
        inviteCode: 'JKLMNPQR',
        invitationHash: record.token_hash,
        smsRequired: true,
      })
    ).body.data,
  ).toEqual({ smsRequired: true, smsEnabled: false });
  expect((await call(pilot.name, '/core/auth/registration-policy', 'GET', { inviteCode: 'ZZZZZZZZ' })).status).toBe(
    422,
  );
  expect((await signup(pilot)).status).toBe(422);
  expect(
    (
      await call(outsider.name, '/core/auth/registration-code', 'POST', {
        phone: outsider.phone,
        inviteCode: 'JKLMNPQR',
      })
    ).status,
  ).toBe(503);
  const old = await signup(outsider, undefined, 'JKLMNPQR');
  expect(old.status).toBe(422);
  expect(await provider()).not.toHaveBeenCalled();
  const code = await send(pilot);
  expect(
    crypto
      .createHash('sha256')
      .update((await provider()).mock.calls.at(-1)![2]!)
      .digest('hex'),
  ).toBe(record.token_hash);
  const verified = await signup(pilot, code);
  expect(verified.status).toBe(201);
  expect(verified.body.data.user.phoneVerifiedAt).toBeTruthy();
});
it('removing a pilot denies pending proof verification; global enable still requires OTP', async () => {
  const { wechatClientId } = await import('../../src/wechat/context');
  const { verifyRegistrationCode } = await import('../../src/sms/registration');
  const pilot = fresh(),
    outsider = fresh();
  const [[record]] = await c.query<RowDataPacket[]>('SELECT token_hash FROM member_invitations WHERE id=?', [
    invitationId,
  ]);
  process.env.SMS_REGISTRATION_ENABLED = '0';
  process.env.SMS_REGISTRATION_PILOT_INVITATIONS = record.token_hash;
  const code = await send(pilot);
  process.env.SMS_REGISTRATION_PILOT_INVITATIONS = '';
  await expect(verifyRegistrationCode(pilot.phone, wechatClientId(identity(pilot.name)), code)).rejects.toMatchObject({
    code: 50320,
  });
  process.env.SMS_REGISTRATION_ENABLED = '1';
  expect(
    (await call(outsider.name, '/core/auth/registration-policy', 'GET', { smsRequired: true, smsEnabled: false })).body
      .data,
  ).toEqual({ smsRequired: true, smsEnabled: true });
  expect((await signup(outsider)).status).toBe(422);
  expect((await signup(pilot, code)).status).toBe(201);
});
it('enforces five daily sends per recipient across different WeChat identities', async () => {
  const p = fresh();
  for (let i = 0; i < 5; i++) {
    expect((await sendRequest({ ...p, name: 'quota_phone_' + i })).status).toBe(200);
    await c.query('UPDATE sms_registration_challenges SET created_at=DATE_SUB(NOW(3),INTERVAL 61 SECOND)');
  }
  expect((await sendRequest({ ...p, name: 'quota_phone_6' })).status).toBe(429);
  expect(await provider()).toHaveBeenCalledTimes(5);
});
it('enforces the daily identity budget across different recipient numbers', async () => {
  for (let i = 0; i < 10; i++) {
    expect((await sendRequest({ ...fresh(), name: 'quota_identity' })).status).toBe(200);
    // Simulate the next minute without changing day counters.
    await c.query('DELETE FROM sms_registration_limits WHERE expires_at<TIMESTAMPADD(SECOND,130,NOW(3))');
  }
  expect((await sendRequest({ ...fresh(), name: 'quota_identity' })).status).toBe(429);
  expect(await provider()).toHaveBeenCalledTimes(10);
});
it('database failure cannot bypass durable send limits', async () => {
  const p = fresh();
  const spy = vi.spyOn(pool, 'getConnection').mockRejectedValueOnce(new Error('isolated_connection_failure'));
  try {
    expect((await sendRequest(p)).status).toBe(500);
    expect(await provider()).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});
it('invitation revoked after delivery cannot register or consume verification', async () => {
  const p = fresh(),
    code = await send(p);
  await c.query('UPDATE member_invitations SET revoked_at=NOW(3) WHERE id=?', [invitationId]);
  try {
    expect((await signup(p, code)).status).toBe(422);
    const [[row]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM users WHERE username=?', [p.phone]);
    expect(row.n).toBe(0);
  } finally {
    await c.query('UPDATE member_invitations SET revoked_at=NULL WHERE id=?', [invitationId]);
  }
  expect((await signup(p, code)).status).toBe(201);
});
