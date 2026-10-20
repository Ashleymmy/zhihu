import { afterAll, beforeAll, expect, it } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { Router, type Express } from 'express';
import type { ModuleManifest } from '../../src/core/contracts';
import { runOpcMigrations } from '../../scripts/opcMigrations';

let container: StartedMySqlContainer, c: mysql.Connection, app: Express;
let db: typeof import('../../src/db').db;
const headers: Record<string, Record<string, string>> = {};
// 1 完整管理员；2 团长 A；3 达人 B（A 邀请，A 团队）；4、5 达人（B 邀请，A 团队）；6 达人（B 邀请，平台直管）；
// 7 运营岗位；8 财务岗位；9 独立达人
const people = [
  { sub: '1', role: 'admin', adminDuty: 'all' },
  { sub: '2', role: 'leader', adminDuty: 'all' },
  { sub: '3', role: 'creator', adminDuty: 'all' },
  { sub: '4', role: 'creator', adminDuty: 'all' },
  { sub: '5', role: 'creator', adminDuty: 'all' },
  { sub: '6', role: 'creator', adminDuty: 'all' },
  { sub: '7', role: 'admin', adminDuty: 'operations' },
  { sub: '8', role: 'admin', adminDuty: 'finance' },
  { sub: '9', role: 'creator', adminDuty: 'all' },
] as const;
const api = (who: string | null, method: 'get' | 'post' | 'patch', path: string) => {
  const r = request(app)[method]('/api/v1/core' + path);
  return who ? r.set(headers[who]) : r;
};
const manifest: ModuleManifest = {
  id: 'sample',
  name: '示例项目',
  version: '1',
  contractVersion: 2,
  roles: ['admin', 'creator', 'leader'],
  permissions: {},
  capabilities: [],
  entryPath: '/tasks',
};
const q = async (sql: string, args: unknown[] = []) => (await c.query<mysql.RowDataPacket[]>(sql, args))[0];
const login = async (person: (typeof people)[number]) => {
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions'),
    { signToken } = await import('../../src/auth/jwt');
  const client = 'promotion-client-' + person.sub,
    session = await issueRefreshSession(person.sub, { type: 'web', id: client });
  headers[person.sub] = {
    'X-Client-Id': client,
    Authorization:
      'Bearer ' +
      (await signToken({ ...person, id: person.sub, username: 'user' + person.sub, displayName: '人员' + person.sub, parentId: null, sessionId: session.familyId })),
  };
};

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withCommand(['--log-bin-trust-function-creators=1'])
    .withDatabase('core_promotions')
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
    NODE_ENV: 'test',
    OPC_MODULES: '',
    QUEUE_DRIVER: 'memory',
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
    JWT_SECRET: 'promotions_isolated_secret_over_32_characters',
  });
  delete process.env.DEV_DEMO_AUTH;
  await runOpcMigrations(target, []);
  c = await mysql.createConnection(target);
  for (const person of people)
    await c.query('INSERT INTO users(id,username,password_hash,role,admin_duty,display_name) VALUES(?,?,?,?,?,?)', [
      person.sub, 'user' + person.sub, 'unused', person.role, person.adminDuty, '人员' + person.sub,
    ]);
  await c.query('UPDATE users SET parent_id=2 WHERE id IN (3,4,5)');
  const dbModule = await import('../../src/db');
  db = dbModule.db;
  const rel = await import('../../src/core/member-relations');
  const inviter: Record<string, string> = { '3': '2', '4': '3', '5': '3', '6': '3' };
  await dbModule.withTransaction(async (conn) => {
    for (const p of people)
      await rel.recordRegistration(conn, {
        userId: p.sub,
        role: p.role,
        parentId: ['3', '4', '5'].includes(p.sub) ? '2' : null,
        inviterId: inviter[p.sub] ?? null,
        channel: 'organic',
      });
  });
  // B 昨天完成两条业绩；团长 A 那一行是团队收益，不算 B 的业绩
  const yesterday = new Date(Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())) - 86400000)
    .toISOString()
    .slice(0, 10);
  await c.query("INSERT INTO projects(id,name,slug) VALUES(1,'项目一','one')");
  await c.query("INSERT INTO module_installations(module_id,version) VALUES('sample','1')");
  await c.query("INSERT INTO integration_accounts(id,module_id,account_key,name,created_by) VALUES(1,'sample','one','来源',1)");
  for (const [sid, qty] of [[1, 120], [2, 30]]) {
    await c.query(
      `INSERT INTO opc_earning_sources(id,module_id,project_id,account_id,source_key,current_version,business_date,task_id,task_name,metric_type,metric_label,quantity_unit)
       VALUES(?,'sample',1,1,?,'v1',?,'t1','任务','read','阅读','次')`,
      [sid, 'k' + sid, yesterday],
    );
    await c.query(
      `INSERT INTO opc_earning_lines(source_id,source_version,payee_id,performer_id,performer_name,rule_code,quantity,amount)
       VALUES(?,'v1',3,3,'人员3','task',?,1.5),(?,'v1',2,3,'人员3','team',?,0.3)`,
      [sid, qty, sid, qty],
    );
  }
  // B 名下有一条小程序邀请链接，跟随成员 4 也有一条
  await c.query(
    "INSERT INTO member_invitations(id,owner_user_id,team_leader_id,token_hash,label,max_uses,expires_at,source) VALUES(1,3,2,REPEAT('b',64),'B 的链接',10,'2099-01-01','mini'),(2,4,2,REPEAT('c',64),'4 的链接',10,'2099-01-01','mini')",
  );
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    { createCoreApp } = await import('../../src/core/app');
  const runtime = new ModuleRuntime([manifest]);
  // 成员 5 在项目里还有进行中的工作，不能调整团队
  runtime.register({
    manifest,
    router: Router(),
    accountLifecycle: {
      accessChangeBlockers: async (_c, userId) => (userId === '5' ? ['仍有进行中的任务'] : []),
      closureBlockers: async () => [],
      erasePersonalData: async () => {},
    },
  });
  app = createCoreApp(runtime);
  for (const person of people) await login(person);
}, 90000);
afterAll(async () => {
  await db?.end();
  await c?.end();
  await container?.stop();
}, 30000);

it('提名前可看近 30 天业绩指标和直接邀请成员的默认去向；只有运营岗位可以使用', async () => {
  const preview = await api('7', 'get', '/promotions/nominee/3');
  expect(preview.status, preview.text).toBe(200);
  expect(preview.body.data).toMatchObject({
    nominable: true,
    openPromotionId: null,
    metrics: { activeDays: 1, records: 2, quantities: [{ label: '阅读', unit: '次', quantity: '150' }] },
  });
  expect(preview.text).not.toContain('amount');
  expect(Object.fromEntries(preview.body.data.members.map((m: { id: string; defaultAction: string }) => [m.id, m.defaultAction]))).toEqual({
    '4': 'follow', '5': 'follow', '6': 'stay',
  });
  for (const who of ['2', '3', '8']) {
    expect((await api(who, 'get', '/promotions')).status).toBe(403);
    expect((await api(who, 'get', '/promotions/nominee/3')).status).toBe(403);
    expect((await api(who, 'post', '/promotions').send({ userId: '9', note: '业绩稳定' })).status).toBe(403);
  }
  expect((await api(null, 'get', '/promotions')).status).toBe(401);
  expect((await api('7', 'get', '/promotions').query({ view: 'all' })).status).toBe(422);
});

it('达人不能在账号编辑里直接改成团长，需要走提名', async () => {
  const res = await api('1', 'patch', '/team/members/9/access').send({ role: 'leader' });
  expect(res.status, res.text).toBe(409);
  expect((await q('SELECT role FROM users WHERE id=9'))[0]?.role).toBe('creator');
  const list = await api('1', 'get', '/team/members');
  expect(list.body.data.find((m: { id: string }) => m.id === '9').editableRoles).not.toContain('leader');
});

it('提名需要理由；同一人只能有一张审核中的提名；只能提名在用的达人；提名人不能自己审核', async () => {
  expect((await api('7', 'post', '/promotions').send({ userId: '3', note: '' })).status).toBe(422);
  expect((await api('7', 'post', '/promotions').send({ userId: '2', note: '已经是团长' })).status).toBe(409);
  const created = await api('7', 'post', '/promotions').send({ userId: '3', note: '近一个月稳定产出，带新人积极' });
  expect(created.status, created.text).toBe(201);
  const id = created.body.data.id;
  expect((await api('1', 'post', '/promotions').send({ userId: '3', note: '重复提名' })).status).toBe(409);
  const mine = await api('7', 'get', '/promotions/' + id);
  expect(mine.body.data).toMatchObject({ status: 'proposed', canReview: false, fromLeader: { id: '2' }, user: { id: '3' } });
  expect((await api('7', 'post', `/promotions/${id}/approve`).send({ follow: [] })).status).toBe(403);
  expect((await api('7', 'post', `/promotions/${id}/reject`).send({ reason: '自己退回' })).status).toBe(403);
  expect((await api('1', 'get', '/promotions/' + id)).body.data.canReview).toBe(true);
  // 提名人可以撤回，撤回后可以重新提名
  expect((await api('7', 'post', `/promotions/${id}/cancel`).send({ reason: '信息有误，重新提名' })).status).toBe(200);
  expect((await api('7', 'post', `/promotions/${id}/cancel`).send({ reason: '再撤一次' })).status).toBe(409);
  expect((await api('7', 'post', '/promotions').send({ userId: '9', note: '独立达人，业绩稳定' })).status).toBe(201);
});

it('审核通过：B 成为平台直管的团长，选中的成员跟随，留下的不变；邀请关系不变；历史、链接和登录状态同步更新', async () => {
  const created = await api('7', 'post', '/promotions').send({ userId: '3', note: '近一个月稳定产出' });
  const id = created.body.data.id;
  expect((await api('1', 'post', `/promotions/${id}/approve`).send({ follow: ['4', '9'] })).status).toBe(422);
  const blocked = await api('1', 'post', `/promotions/${id}/approve`).send({ follow: ['4', '5'] });
  expect(blocked.status).toBe(409);
  expect(blocked.body.message).toContain('人员5：仍有进行中的任务');
  expect((await q('SELECT role FROM users WHERE id=3'))[0]?.role).toBe('creator');
  const res = await api('1', 'post', `/promotions/${id}/approve`).send({ follow: ['4'], note: '同意' });
  expect(res.status, res.text).toBe(200);
  expect(res.body.data).toEqual({ followed: 1, stayed: 2 });
  const users = await q('SELECT id,role,CAST(parent_id AS CHAR) parent FROM users WHERE id IN (3,4,5,6) ORDER BY id');
  expect(users).toEqual([
    { id: 3, role: 'leader', parent: null },
    { id: 4, role: 'creator', parent: '3' },
    { id: 5, role: 'creator', parent: '2' },
    { id: 6, role: 'creator', parent: null },
  ]);
  const open = await q('SELECT user_id,CAST(leader_id AS CHAR) leader,source FROM team_memberships WHERE open_user IN (3,4,5) ORDER BY user_id');
  expect(open).toEqual([
    { user_id: 3, leader: null, source: 'promotion' },
    { user_id: 4, leader: '3', source: 'promotion' },
    { user_id: 5, leader: '2', source: 'registration' },
  ]);
  expect((await q("SELECT CAST(promotion_id AS CHAR) p FROM member_role_history WHERE user_id=3 AND reason='promotion'"))[0]?.p).toBe(String(id));
  expect((await q('SELECT CAST(inviter_id AS CHAR) i FROM member_referrals WHERE user_id=4'))[0]?.i).toBe('3');
  expect((await q('SELECT id,CAST(team_leader_id AS CHAR) t FROM member_invitations ORDER BY id'))).toEqual([
    { id: 1, t: '3' },
    { id: 2, t: '3' },
  ]);
  for (const user of [3, 4])
    expect((await q('SELECT COUNT(*) n FROM token_sessions WHERE user_id=? AND revoked_at IS NULL', [user]))[0]?.n).toBe(0);
  expect((await q('SELECT COUNT(*) n FROM token_sessions WHERE user_id=5 AND revoked_at IS NULL'))[0]?.n).toBe(1);
  const done = await api('7', 'get', '/promotions').query({ view: 'done' });
  const item = done.body.data.find((p: { id: string }) => p.id === String(id));
  expect(item).toMatchObject({ status: 'approved', followed: 1, reviewer: { id: '1' }, canReview: false });
  const detail = await api('7', 'get', '/promotions/' + id);
  expect(detail.body.data.members.map((m: { id: string; defaultAction: string }) => [m.id, m.defaultAction])).toEqual([
    ['4', 'follow'], ['5', 'stay'], ['6', 'stay'],
  ]);
  expect((await api('1', 'post', `/promotions/${id}/approve`).send({ follow: [] })).status).toBe(409);
  const rel = await import('../../src/core/member-relations'), { withTransaction } = await import('../../src/db');
  expect((await withTransaction((conn) => rel.checkMemberRelations(conn))).ok).toBe(true);
});

it('退回需要写明原因，退回后记录保留', async () => {
  const [open] = (await api('1', 'get', '/promotions')).body.data;
  expect(open.user.id).toBe('9');
  const todos = await api('7', 'get', '/dashboard');
  expect(todos.status, todos.text).toBe(200);
  expect(todos.body.data.todos).toEqual([expect.objectContaining({ kind: 'promotion.review', count: 1, path: '/team/promotions' })]);
  expect((await api('8', 'get', '/dashboard')).body.data.todos).toEqual([]);
  expect((await api('1', 'post', `/promotions/${open.id}/reject`).send({})).status).toBe(422);
  expect((await api('1', 'post', `/promotions/${open.id}/reject`).send({ reason: '再观察一个月' })).status).toBe(200);
  const done = (await api('7', 'get', '/promotions').query({ view: 'done' })).body.data;
  expect(done.find((p: { id: string }) => p.id === open.id)).toMatchObject({ status: 'rejected', reviewNote: '再观察一个月' });
  expect((await q('SELECT role FROM users WHERE id=9'))[0]?.role).toBe('creator');
});
