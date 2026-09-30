import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';
vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn(async () => ({ id: 'isolated' })) }));
let actor: AuthUser;
vi.mock('../../src/auth/middleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = actor;
    next();
  },
}));
const user = (sub: string, role: AuthUser['role'], parentId: string | null = null): AuthUser => ({
  sub,
  role,
  parentId,
  username: 'u' + sub,
  displayName: 'u' + sub,
  jti: 'test',
});
const admin = user('1', 'admin'),
  leader = user('2', 'leader'),
  team = user('3', 'creator', '2'),
  direct = user('4', 'creator'),
  other = user('5', 'leader'),
  legacy = user('6', 'creator', '1'),
  outside = user('7', 'creator');
const scope = { projectId: '1', accountId: '' };
let container: StartedMySqlContainer,
  c: Connection,
  pool: typeof import('../../src/db').db,
  resources: typeof import('../../src/modules/zhihu/attribution/resources'),
  app: express.Express;
let serial = 0;
const key = () => crypto.randomUUID();
const input = (keyword = '自建独占词' + ++serial) => ({
  keyword,
  taskId: '1',
  channelId: '1',
  landingUrl: 'https://example.com/content',
  popularizeType: 0,
});
async function binding(id: string) {
  const [[b]] = await c.query<RowDataPacket[]>(
    'SELECT b.*,k.lifecycle_status,k.used_ever_at FROM zh_keywords k JOIN zh_keyword_bindings b ON b.id=k.current_binding_id WHERE k.id=?',
    [id],
  );
  return b;
}
async function ready(planId: string) {
  await c.query("UPDATE plans SET status='active',sync_status='synced',zhihu_plan_id=? WHERE id=?", [
    'upstream-' + planId,
    planId,
  ]);
  await resources.synchronizeKeywords(scope, planId);
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('self_create')
    .withUsername('test')
    .withUserPassword('test')
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
    OPC_MODULES: 'zhihu',
    DEV_DEMO_AUTH: '0',
  });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(1,'admin','unused','admin','管理',NULL),(2,'leader','unused','leader','团长',NULL),(3,'team','unused','creator','团队达人',2),(4,'direct','unused','creator','独立达人',NULL),(5,'other','unused','leader','其他团长',NULL),(6,'legacy','unused','creator','旧管理员下级',1),(7,'outside','unused','creator','非项目成员',NULL)",
  );
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,4),(1,5),(1,6)');
  const [[a]] = await c.query<RowDataPacket[]>('SELECT id FROM integration_accounts LIMIT 1');
  scope.accountId = String(a.id);
  await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'channel',1,'渠道')");
  await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'task','任务',NOW())");
  pool = (await import('../../src/db')).db;
  resources = await import('../../src/modules/zhihu/attribution/resources');
  const { attributionRouter } = await import('../../src/modules/zhihu/routes/attribution');
  const { errorHandler } = await import('../../src/middleware/errors');
  app = express().use(express.json()).use(attributionRouter).use(errorHandler);
}, 180000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

it('creator, team creator and leader routes create exactly one initial owner without accepting ownership injection', async () => {
  for (const who of [direct, team, leader, legacy]) {
    actor = who;
    const payload = { ...scope, ...input(), requestKey: key(), executorId: '5', leaderId: '5' };
    const r = await request(app).post('/keywords').send(payload);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const b = await binding(r.body.data.id);
    expect(b.used_at).toBeNull();
    expect(b.path_type).toBe(who === leader ? 'reserved' : who === team ? 'team_creator' : 'direct_creator');
    expect(b.executor_id === null ? null : String(b.executor_id)).toBe(who === leader ? null : who.sub);
    expect(b.leader_id === null ? null : String(b.leader_id)).toBe(who === team || who === leader ? '2' : null);
    const repeated = await request(app).post('/keywords').send(payload);
    expect(repeated.body.data).toEqual(r.body.data);
    await ready(r.body.data.planId);
    const own = await resources.listKeywords(who, scope, 1, 25, payload.keyword);
    expect(own.total).toBe(1);
    expect(own.list[0].allocation_ready).toBe(0);
    expect((await resources.listKeywords(other, scope, 1, 25, payload.keyword)).total).toBe(0);
    await expect(resources.claim(other, scope, r.body.data.id, key())).rejects.toThrow('已被占用');
    await expect(resources.distribute(admin, scope, r.body.data.id, key(), other.sub)).rejects.toThrow('已分配');
  }
});
it('parallel creators cannot create or use the same keyword twice; existing legacy plans also reserve their words', async () => {
  const data = input();
  const result = await Promise.allSettled([
    resources.createKeyword(team, scope, key(), data),
    resources.createKeyword(direct, scope, key(), data),
    resources.createKeyword(leader, scope, key(), data),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const [[n]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM plans WHERE keyword=?', [data.keyword]);
  expect(n.n).toBe(1);
  await c.query(
    "INSERT INTO plans(project_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by) VALUES(1,'task','channel','历史唯一词','https://example.com',0,1,1)",
  );
  await expect(resources.createKeyword(direct, scope, key(), input('历史唯一词'))).rejects.toThrow('已存在');
});
it('creation validates project membership and actual team leader membership, including scope options', async () => {
  actor = outside;
  expect(
    (
      await request(app)
        .post('/keywords')
        .send({ ...scope, ...input(), requestKey: key() })
    ).status,
  ).toBe(403);
  for (const who of [direct, team, leader]) expect((await resources.options(who, scope)).channels).toHaveLength(1);
  expect((await resources.options(legacy, scope)).hasTeamLeader).toBe(false);
  expect((await resources.options(team, scope)).hasTeamLeader).toBe(true);
  await c.query('UPDATE project_members SET left_at=NOW() WHERE user_id=2');
  await expect(resources.createKeyword(team, scope, key(), input())).rejects.toThrow('团长加入项目');
  await c.query('UPDATE project_members SET left_at=NULL WHERE user_id=2');
  await expect(resources.createKeyword(direct, scope, key(), { ...input(), taskId: '99999' })).rejects.toThrow(
    '当前范围',
  );
});
it('leaders assign self-created keywords to their own team or themselves, and used words cannot change ownership', async () => {
  const word = await resources.createKeyword(leader, scope, key(), input());
  await ready(word.planId);
  const b = await binding(word.id);
  await expect(
    resources.changeBinding(other, scope, String(b.id), key(), { action: 'assign', executorId: '4' }),
  ).rejects.toThrow();
  await expect(
    resources.changeBinding(leader, scope, String(b.id), key(), { action: 'assign', executorId: '4' }),
  ).rejects.toThrow();
  await resources.changeBinding(leader, scope, String(b.id), key(), { action: 'assign', executorId: '3' });
  await resources.changeBinding(team, scope, String(b.id), key(), { action: 'activate' });
  await expect(
    resources.changeBinding(leader, scope, String(b.id), key(), { action: 'assign', executorId: '2' }),
  ).rejects.toThrow();
  await expect(
    resources.changeBinding(team, scope, String(b.id), key(), { action: 'request-release', reason: '不能转用' }),
  ).rejects.toThrow('保留原归属');
  const self = await resources.createKeyword(leader, scope, key(), input());
  const selfB = await binding(self.id);
  await resources.changeBinding(leader, scope, String(selfB.id), key(), { action: 'assign', executorId: '2' });
  expect((await binding(self.id)).path_type).toBe('leader_self');
});
it('independent creators with a legacy admin parent can claim and register, and self-created works retain executor attribution', async () => {
  const { createComposition } = await import('../../src/modules/zhihu/services/compositions.service');
  const { compositionPlanScope } = await import('../../src/modules/zhihu/services/composition-access');
  for (const who of [direct, team, legacy]) {
    const word = await resources.createKeyword(who, scope, key(), input());
    await ready(word.planId);
    const access = compositionPlanScope(who, true);
    const [plans] = await c.query<RowDataPacket[]>(`SELECT p.id FROM plans p WHERE p.id=? AND ${access.clause}`, [
      word.planId,
      ...access.bindings,
    ]);
    expect(plans).toHaveLength(1);
    const work = await createComposition(who, {
      planId: word.planId,
      mediaType: 'KOC抖音',
      mediaAccount: 'isolated',
      compositionType: 1,
      compositionSubType: 1,
      promoUrl: 'https://example.com/work/' + word.id,
      releaseTime: '2026-09-30 12:00:00',
    });
    const [[saved]] = await c.query<RowDataPacket[]>('SELECT owner_id FROM compositions WHERE id=?', [work.id]);
    expect(String(saved.owner_id)).toBe(who.sub);
    expect((await binding(word.id)).used_at).not.toBeNull();
  }
  const word = await resources.createKeyword(admin, scope, key(), input());
  await ready(word.planId);
  await c.query('UPDATE zh_keywords SET priority_until=TIMESTAMPADD(HOUR,-1,NOW()) WHERE id=?', [word.id]);
  expect(
    (
      await resources.listKeywords(
        legacy,
        scope,
        1,
        25,
        (await c.query<RowDataPacket[]>('SELECT keyword FROM zh_keywords WHERE id=?', [word.id]))[0][0].keyword,
      )
    ).total,
  ).toBe(1);
  const claimed = await resources.claim(legacy, scope, word.id, key());
  await resources.changeBinding(legacy, scope, claimed.id, key(), { action: 'activate' });
  expect((await binding(word.id)).path_type).toBe('direct_creator');
});
it('simulation worker preserves self-created bindings and public pool creation retains its priority window', async () => {
  await c.query("UPDATE zhihu_account_settings SET config_json=JSON_OBJECT('mode','simulation') WHERE project_id=1");
  const { pushPlan } = await import('../../src/modules/zhihu/jobs/pushPlan');
  for (const who of [direct, leader, admin]) {
    const word = await resources.createKeyword(who, scope, key(), input());
    await pushPlan({ planId: word.planId });
    const [[row]] = await c.query<RowDataPacket[]>(
      'SELECT k.current_binding_id,k.lifecycle_status,k.priority_until,k.created_at,p.sync_status FROM zh_keywords k JOIN plans p ON p.id=k.plan_id WHERE k.id=?',
      [word.id],
    );
    expect(row.sync_status).toBe('simulated');
    expect(row.lifecycle_status).toBe(who === direct ? 'assigned' : who === leader ? 'reserved' : 'available');
    if (who === admin) {
      expect(row.current_binding_id).toBeNull();
      expect(new Date(row.priority_until).getTime() - new Date(row.created_at).getTime()).toBe(1800000);
    } else expect(row.current_binding_id).not.toBeNull();
  }
});
