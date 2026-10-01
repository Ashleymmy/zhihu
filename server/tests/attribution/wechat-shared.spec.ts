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
vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn(async () => ({ id: 'isolated' })) }));
let container: StartedMySqlContainer, c: Connection, app: express.Express, pool: typeof import('../../src/db').db;
const secret = 'isolated_wechat_bridge_signing_secret_32_chars',
  appId = 'wx22b91776ccf37354',
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
  const { raw, headers } = signed({ appId, openId: openId(name), path, method, data, token: tokens[name] });
  return request(app).post('/api/v1/mini/bridge').set(headers).send(raw);
}
async function login(name: string) {
  const r = await call(name, '/core/auth/login', 'POST', { username: name, password });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  tokens[name] = r.body.data.token;
  return r;
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
  });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  const hash = await bcrypt.hash(password, 4);
  for (const [i, role] of ['admin', 'leader', 'creator', 'operator', 'developer'].entries())
    await c.query(
      'INSERT INTO users(id,username,password_hash,role,role_id,display_name,admin_duty,must_change_pwd) VALUES(?,?,?,?,(SELECT id FROM roles WHERE role_key=?),?,?,0)',
      [i + 1, role, hash, role, role, role, role === 'operator' ? 'operations' : 'all'],
    );
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
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

it('rejects unsigned, modified, stale, replayed and foreign-app envelopes; HTTP headers cannot pretend to be WeChat', async () => {
  const body = { appId, openId: openId('none'), path: '/core/auth/wechat-login', method: 'POST', data: {} };
  expect((await request(app).post('/api/v1/mini/bridge').send(body)).status).toBe(401);
  let s = signed(body);
  expect(
    (
      await request(app)
        .post('/api/v1/mini/bridge')
        .set(s.headers)
        .send(s.raw + ' ')
    ).status,
  ).toBe(401);
  s = signed(body, crypto.randomBytes(16).toString('hex'), String(Date.now() - 120000));
  expect((await request(app).post('/api/v1/mini/bridge').set(s.headers).send(s.raw)).status).toBe(401);
  s = signed(body);
  expect((await request(app).post('/api/v1/mini/bridge').set(s.headers).send(s.raw)).body.data).toEqual({
    needsBind: true,
  });
  expect((await request(app).post('/api/v1/mini/bridge').set(s.headers).send(s.raw)).status).toBe(409);
  s = signed({ ...body, appId: 'wx0000000000000000' });
  expect((await request(app).post('/api/v1/mini/bridge').set(s.headers).send(s.raw)).status).toBe(403);
  expect(
    (await request(app).post('/api/v1/core/mini-auth/wechat-login').set('X-OpenId', openId('admin')).send({})).status,
  ).toBe(403);
});
it('binds the existing website account and keeps web/mobile sessions active independently', async () => {
  const webId = crypto.randomUUID(),
    mobileId = crypto.randomUUID();
  const web = await request(app)
    .post('/api/v1/core/auth/login')
    .set('X-Client-Id', webId)
    .send({ username: 'creator', password });
  const mobile = await request(app)
    .post('/api/v1/core/auth/login')
    .set('X-Client-Id', mobileId)
    .set('User-Agent', 'iPhone Mobile')
    .send({ username: 'creator', password });
  expect((await login('creator')).body.data.user.id).toBe('3');
  for (const [client, token, ua] of [
    [webId, web.body.data.token, 'desktop'],
    [mobileId, mobile.body.data.token, 'iPhone Mobile'],
  ])
    expect(
      (
        await request(app)
          .get('/api/v1/core/auth/me')
          .set('X-Client-Id', client)
          .set('User-Agent', ua)
          .auth(token, { type: 'bearer' })
      ).status,
    ).toBe(200);
  expect((await call('creator', '/core/auth/me')).body.data.id).toBe('3');
  const fast = await call('creator', '/core/auth/wechat-login', 'POST');
  expect(fast.body.data.user.id).toBe('3');
  tokens.creator = fast.body.data.token;
  const [[n]] = await c.query<RowDataPacket[]>("SELECT COUNT(*) n FROM users WHERE username='creator'");
  expect(n.n).toBe(1);
});
it('requires the website password and forbids stealing bindings or reusing a token from another WeChat identity', async () => {
  expect((await call('other', '/core/auth/login', 'POST', { username: 'creator', password: 'wrong' })).status).toBe(
    401,
  );
  expect((await call('other', '/core/auth/login', 'POST', { username: 'creator', password })).status).toBe(409);
  tokens.other = tokens.creator;
  expect((await call('other', '/core/auth/me')).status).toBe(401);
  expect((await call('creator', '/core/auth/login', 'POST', { username: 'leader', password })).status).toBe(409);
});
it('handles every canonical role including operator/developer without granting project management to operator', async () => {
  for (const name of ['admin', 'leader', 'operator', 'developer'])
    expect((await login(name)).body.data.user.role).toBe(name);
  expect((await call('operator', '/core/projects', 'POST', { name: 'not allowed' })).status).toBe(403);
});
let invitedId: string, inviteCode: string;
it('a mini invitation registers the same website creator, leader provenance, and no bonus ledger entries', async () => {
  const invite = await call('leader', '/modules/zhihu/invite/me');
  expect(invite.status, JSON.stringify(invite.body)).toBe(200);
  inviteCode = invite.body.data.code;
  expect(invite.body.data).toMatchObject({ rewardsEnabled: false, rewardAmount: '0.00' });
  const registered = await call('invited', '/core/auth/register', 'POST', {
    phone: '13900008881',
    password,
    inviteCode,
    displayName: '新达人',
  });
  expect(registered.status, JSON.stringify(registered.body)).toBe(201);
  tokens.invited = registered.body.data.token;
  invitedId = registered.body.data.user.id;
  expect(registered.body.data.user).toMatchObject({ role: 'creator', parentId: '2' });
  const affiliation = await call('invited', '/core/team/affiliation');
  expect(affiliation.body.data.team.leaderId).toBe('2');
  expect((await call('invited', '/core/projects')).body.data).toHaveLength(0);
  const [[rewards]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM opc_income_entries WHERE user_id=?', [
    invitedId,
  ]);
  expect(rewards.n).toBe(0);
  expect(
    (await call('invited', '/core/auth/register', 'POST', { phone: '13900008882', password, inviteCode })).status,
  ).toBe(409);
  const [[rolled]] = await c.query<RowDataPacket[]>("SELECT COUNT(*) n FROM users WHERE username='13900008882'");
  expect(rolled.n).toBe(0);
});
it('leader grants a shared project, which appears after relogin; the grant is visible to website services', async () => {
  const grant = await call('leader', '/core/team/members/' + invitedId + '/access', 'PATCH', { projectIds: ['1'] });
  expect(grant.status, JSON.stringify(grant.body)).toBe(200);
  expect((await call('invited', '/core/projects')).status).toBe(401);
  const fast = await call('invited', '/core/auth/wechat-login', 'POST');
  tokens.invited = fast.body.data.token;
  expect((await call('invited', '/core/projects')).body.data.some((p: any) => p.id === '1')).toBe(true);
  const members = await call('leader', '/core/team/members');
  expect(members.body.data.find((m: any) => m.id === invitedId).projects.some((p: any) => p.id === '1')).toBe(true);
});
it('mini keyword creation, unique ownership and canonical composition submission share website tables and stable receipts', async () => {
  const input = {
    ...scope,
    keyword: '双端共享唯一测试词',
    taskId: '1',
    channelId: '1',
    landingUrl: 'https://example.com/content',
    popularizeType: 0,
    requestKey: crypto.randomUUID(),
  };
  const keyword = await call('invited', '/modules/zhihu/keywords', 'POST', input);
  expect(keyword.status, JSON.stringify(keyword.body)).toBe(201);
  expect(
    (await call('creator', '/modules/zhihu/keywords', 'POST', { ...input, requestKey: crypto.randomUUID() })).status,
  ).toBe(409);
  const word = keyword.body.data;
  await c.query("UPDATE plans SET status='active',sync_status='synced',zhihu_plan_id=? WHERE id=?", [
    'isolated-' + word.planId,
    word.planId,
  ]);
  const payload = {
    ...scope,
    planId: word.planId,
    mediaType: 'KOC抖音',
    mediaAccount: '测试发布账号',
    compositionType: 2,
    compositionSubType: 5,
    promoUrl: 'https://example.com/work',
    releaseTime: '2026-10-01T12:00:00+08:00',
    requestKey: crypto.randomUUID(),
  };
  const submitted = await call('invited', '/modules/zhihu/mini-works', 'POST', payload);
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  const retry = await call('invited', '/modules/zhihu/mini-works', 'POST', payload);
  expect(retry.body.data.id).toBe(submitted.body.data.id);
  const listed = await call('invited', '/modules/zhihu/workbench/works', 'GET', scope);
  expect(listed.body.data.list.some((w: any) => w.compositionId === submitted.body.data.id)).toBe(true);
  const evidence = listed.body.data.list.find((w: any) => w.compositionId === submitted.body.data.id);
  expect(evidence.source).toBe('evidence');
  expect(evidence.status).toBe('pending');
  const reviewed = await call('leader', '/modules/zhihu/evidence/' + evidence.id + '/review', 'POST', {
    ...scope,
    requestKey: crypto.randomUUID(),
    accept: true,
    reason: '真实作品已核对',
  });
  expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
  const [[proof]] = await c.query<RowDataPacket[]>('SELECT verification_status FROM zh_keyword_bindings WHERE id=?', [
    evidence.bindingId,
  ]);
  expect(proof.verification_status).toBe('passed');
  expect(
    (await call('creator', '/modules/zhihu/mini-works', 'POST', { ...payload, requestKey: crypto.randomUUID() }))
      .status,
  ).toBe(404);
  const [[saved]] = await c.query<RowDataPacket[]>('SELECT owner_id,media_account FROM compositions WHERE id=?', [
    submitted.body.data.id,
  ]);
  expect(String(saved.owner_id)).toBe(invitedId);
  expect(saved.media_account).toBe('测试发布账号');
});
it('private chunk uploads reject a different owner, scope and content replay', async () => {
  const prepared = await call('creator', '/core/files/prepare', 'POST', {
    ...scope,
    purpose: 'composition-xlsx',
    name: '作品.xlsx',
  });
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
  const id = prepared.body.data.id;
  const bytes = Buffer.from('isolated bytes'),
    payload = { index: 0, totalBytes: bytes.length, base64: bytes.toString('base64') };
  expect((await call('creator', '/core/files/' + id + '/upload-chunk', 'POST', payload)).status).toBe(200);
  expect((await call('creator', '/core/files/' + id + '/upload-chunk', 'POST', payload)).status).toBe(200);
  expect((await call('invited', '/core/files/' + id + '/finish-upload', 'POST')).status).toBe(404);
  expect(
    (
      await call('creator', '/core/files/' + id + '/upload-chunk', 'POST', {
        ...payload,
        base64: Buffer.from('changed bytes!').toString('base64'),
      })
    ).status,
  ).toBe(409);
  expect((await call('creator', '/core/files/' + id + '/finish-upload', 'POST')).status).toBe(200);
  expect(
    (await call('creator', '/core/finance/withdrawals/1/pay', 'POST', { ...scope, moduleId: 'zhihu', fileId: id }))
      .status,
  ).toBe(403);
});
it('revoked invitation codes cannot register and do not create half-bound users', async () => {
  await c.query(
    'UPDATE member_invitations i JOIN mini_invitation_codes c ON c.invitation_id=i.id SET i.revoked_at=NOW(3) WHERE c.code=?',
    [inviteCode],
  );
  expect(
    (await call('fresh', '/core/auth/register', 'POST', { phone: '13900008883', password, inviteCode })).status,
  ).toBe(422);
  const [[saved]] = await c.query<RowDataPacket[]>("SELECT COUNT(*) n FROM users WHERE username='13900008883'");
  expect(saved.n).toBe(0);
});

it('creator referrals preserve the actual leader and expire when that relationship changes; staff referrals are platform managed', async () => {
  const own = await call('invited', '/modules/zhihu/invite/me');
  expect(own.status).toBe(200);
  const child = await call('referral', '/core/auth/register', 'POST', {
    phone: '13900008885',
    password,
    inviteCode: own.body.data.code,
  });
  expect(child.status, JSON.stringify(child.body)).toBe(201);
  expect(child.body.data.user.parentId).toBe('2');
  await c.query('UPDATE users SET parent_id=NULL WHERE id=?', [invitedId]);
  expect(
    (
      await call('moved', '/core/auth/register', 'POST', {
        phone: '13900008886',
        password,
        inviteCode: own.body.data.code,
      })
    ).status,
  ).toBe(422);
  const staff = await call('operator', '/modules/zhihu/invite/me');
  expect(staff.status).toBe(200);
  const independent = await call('platform', '/core/auth/register', 'POST', {
    phone: '13900008887',
    password,
    inviteCode: staff.body.data.code,
  });
  expect(independent.status, JSON.stringify(independent.body)).toBe(201);
  expect(independent.body.data.user.parentId).toBe(null);
  const [[row]] = await c.query<RowDataPacket[]>('SELECT created_by FROM users WHERE id=?', [
    independent.body.data.user.id,
  ]);
  expect(String(row.created_by)).toBe('4');
});
it('disabled shared users cannot silently sign back in with WeChat', async () => {
  await c.query('UPDATE users SET is_active=0 WHERE id=3');
  expect((await call('creator', '/core/auth/me')).status).toBe(401);
  expect((await call('creator', '/core/auth/wechat-login', 'POST')).status).toBe(403);
});

it('college starter lessons and details are readable by a new creator without a project', async () => {
  const hash = await bcrypt.hash(password, 4);
  await c.query(
    "INSERT INTO users(id,username,display_name,password_hash,role,must_change_pwd) VALUES(910,'college','学院测试达人',?,'creator',0)",
    [hash],
  );
  await login('college');
  expect((await call('college', '/core/projects')).body.data).toHaveLength(0);
  const list = await call('college', '/modules/zhihu/courses');
  expect(list.status).toBe(200);
  expect(list.body.data.total).toBe(7);
  expect(list.body.data.tiers.map((t: any) => t.courses.length)).toEqual([3, 2, 2]);
  for (const tier of list.body.data.tiers)
    for (const card of tier.courses) {
      expect(card.views).toBe(null);
      const detail = await call('college', '/modules/zhihu/courses/' + card.id);
      expect(detail.status).toBe(200);
      expect(detail.body.data.title).toBe(card.title);
      expect(detail.body.data.sections).toHaveLength(2);
    }
  expect((await call('college', '/modules/zhihu/courses/missing')).status).toBe(404);
  expect((await call('anonymous-college', '/modules/zhihu/courses')).status).toBe(401);
});

it('college retains project course membership, publication and enabled-project boundaries', async () => {
  await c.query("INSERT INTO projects(id,name,slug,is_enabled) VALUES(920,'隔离课程项目','college-test',1)");
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(920,2)');
  await c.query(
    "INSERT INTO project_courses(id,project_id,course_name,course_url,is_active) VALUES(921,920,'项目私有课','https://example.com/lesson',1),(922,920,'未上架',NULL,0)",
  );
  expect((await call('college', '/modules/zhihu/courses')).body.data.total).toBe(7);
  expect((await call('college', '/modules/zhihu/courses/921')).status).toBe(403);
  const list = await call('leader', '/modules/zhihu/courses');
  expect(list.body.data.total).toBe(8);
  expect(list.body.data.tiers.find((t: any) => t.key === '920').courses).toHaveLength(1);
  expect((await call('leader', '/modules/zhihu/courses/921')).body.data.url).toBe('https://example.com/lesson');
  expect((await call('leader', '/modules/zhihu/courses/922')).status).toBe(404);
  await c.query('UPDATE projects SET is_enabled=0 WHERE id=920');
  expect((await call('leader', '/modules/zhihu/courses')).body.data.total).toBe(7);
  expect((await call('leader', '/modules/zhihu/courses/921')).status).toBe(404);
  await c.query('UPDATE projects SET is_enabled=1 WHERE id=920');
  await c.query('UPDATE project_members SET left_at=NOW() WHERE project_id=920 AND user_id=2');
  expect((await call('leader', '/modules/zhihu/courses')).body.data.total).toBe(7);
  expect((await call('leader', '/modules/zhihu/courses/921')).status).toBe(403);
});

it('unpublished or deleted college lessons stay hidden across reads and migration reruns', async () => {
  await c.query("UPDATE college_courses SET published=0 WHERE id='seed-silver-1'");
  expect((await call('college', '/modules/zhihu/courses')).body.data.total).toBe(6);
  expect((await call('college', '/modules/zhihu/courses/seed-silver-1')).status).toBe(404);
  await c.query('UPDATE college_courses SET published=0');
  await c.query("DELETE FROM college_courses WHERE id='seed-elite-2'");
  await runMigrations(
    {
      host: container.getHost(),
      port: container.getPort(),
      user: container.getUsername(),
      password: container.getUserPassword(),
      database: container.getDatabase(),
    },
    path.resolve('schema/extensions'),
  );
  expect((await call('college', '/modules/zhihu/courses')).body.data).toEqual({ tiers: [], total: 0 });
  expect((await call('college', '/modules/zhihu/courses/seed-elite-2')).status).toBe(404);
  const [[count]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM college_courses');
  expect(count.n).toBe(6);
});
