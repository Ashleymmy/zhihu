import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';

vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn(async () => ({ id: 'test' })) }));
let actor: AuthUser;
// Keep the real routes, permission middleware, services and SQL; only authentication is supplied locally.
vi.mock('../../src/auth/middleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = actor;
    next();
  },
}));
const user = (sub: string, role: AuthUser['role'], parentId: string | null = null): AuthUser => ({
  sub, role, parentId, username: 'u' + sub, displayName: 'u' + sub, jti: 'isolated-test',
});
const admin = user('1', 'admin'), leader = user('2', 'leader'), team = user('3', 'creator', '2'),
  direct = user('4', 'creator'), otherLeader = user('5', 'leader'), otherTeam = user('6', 'creator', '5'),
  operator = user('7', 'operator', '2'), developer = user('8', 'developer');
let container: StartedMySqlContainer, c: Connection, pool: typeof import('../../src/db').db;
let resources: typeof import('../../src/modules/zhihu/attribution/resources');
let statements: typeof import('../../src/modules/zhihu/attribution/statements');
let app: express.Express, serial = 0;
const scope = { projectId: '1', accountId: '' };
const secondScope = { projectId: '2', accountId: '' };
const key = () => crypto.randomUUID();
async function keyword() {
  const word = await resources.createKeyword(admin, scope, key(), {
    keyword: '运营范围回归' + ++serial, taskId: '1', channelId: '1',
    landingUrl: 'https://example.com', popularizeType: 0,
  });
  await c.query("UPDATE plans SET status='active',sync_status='synced',zhihu_plan_id=? WHERE id=?", ['upstream-' + word.planId, word.planId]);
  return word;
}
async function evidence(executor: AuthUser) {
  const word = await keyword();
  const binding = await resources.distribute(admin, scope, word.id, key(), executor.sub);
  await resources.changeBinding(executor, scope, binding.id, key(), { action: 'activate' });
  const url = 'https://example.com/work/' + word.id;
  const saved = await statements.submitEvidence(executor, scope, key(), {
    bindingId: binding.id, url, description: '跨团队作品核验',
  });
  await c.query("INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,composition_sub_type,promo_url) VALUES(?,?,'KOC抖音','isolated',1,1,?)", [word.planId, executor.sub, url]);
  return { ...saved, bindingId: binding.id };
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0').withDatabase('operator_scope_test')
    .withUsername('test').withUserPassword('isolated_test').start();
  const target = { host: container.getHost(), port: container.getPort(), database: container.getDatabase(),
    user: container.getUsername(), password: container.getUserPassword() };
  Object.assign(process.env, { DB_HOST: target.host, DB_PORT: String(target.port), DB_NAME: target.database,
    DB_USER: target.user, DB_PASS: target.password, OPC_MODULES: 'zhihu', DEV_DEMO_AUTH: '0' });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  await c.query(`INSERT INTO users(id,username,password_hash,role,display_name,parent_id,is_active) VALUES
    (1,'admin','unused','admin','管理员',NULL,1),(2,'leader','unused','leader','团长甲',NULL,1),
    (3,'team','unused','creator','团队达人甲',2,1),(4,'direct','unused','creator','独立达人',NULL,1),
    (5,'other-leader','unused','leader','团长乙',NULL,1),(6,'other-team','unused','creator','团队达人乙',5,1),
    (7,'operator','unused','operator','运营旧绑定',2,1),(8,'developer','unused','developer','开发者',NULL,1),
    (9,'outside','unused','creator','未加入项目',NULL,1),(10,'disabled','unused','creator','停用成员',NULL,0),
    (11,'left','unused','creator','已退出成员',NULL,1),(12,'other-project','unused','creator','其他项目成员',NULL,1)`);
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,4),(1,5),(1,6),(1,10),(1,11)');
  await c.query('UPDATE project_members SET left_at=NOW() WHERE user_id=11');
  const [accounts] = await c.query<RowDataPacket[]>('SELECT id FROM integration_accounts LIMIT 1');
  scope.accountId = String(accounts[0].id);
  secondScope.accountId = scope.accountId;
  await c.query("INSERT INTO projects(id,name,slug) VALUES(2,'另一项目','operator-scope-other')");
  await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(2,?)', [scope.accountId]);
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(2,12)');
  await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'channel',1,'渠道')");
  await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'task','任务',NOW())");
  pool = (await import('../../src/db')).db;
  resources = await import('../../src/modules/zhihu/attribution/resources');
  statements = await import('../../src/modules/zhihu/attribution/statements');
  const { attributionRouter } = await import('../../src/modules/zhihu/routes/attribution');
  const { errorHandler } = await import('../../src/middleware/errors');
  app = express().use(express.json()).use(attributionRouter).use(errorHandler);
  for (const executor of [team, direct, otherTeam]) await evidence(executor);
}, 180000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

describe('运营跨团队业务范围', () => {
  it.each([admin, operator, developer])('$role 可选择当前项目有效成员及本人，不增加其他管理账号', async viewer => {
    actor = viewer;
    const result = await request(app).get('/attribution-options').query(scope);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data.users.map((u: { id: string }) => u.id)).toEqual(['2', '3', '4', '5', '6', viewer.sub]);
  });
  it('团长仅可选择自己及直属达人，达人不返回分配对象', async () => {
    expect((await resources.options(leader, scope)).users.map(u => u.id)).toEqual(['2', '3']);
    expect((await resources.options(otherLeader, scope)).users.map(u => u.id)).toEqual(['5', '6']);
    expect((await resources.options(team, scope)).users).toEqual([]);
  });
  it.each([operator, developer])('$role 的作品核验列表与管理员一致，已登记作品不降级或重复展示', async viewer => {
    for (const path of ['/evidence', '/workbench/works']) {
      actor = admin;
      const baseline = await request(app).get(path).query(scope);
      actor = viewer;
      const result = await request(app).get(path).query(scope);
      expect(baseline.status).toBe(200);
      expect(baseline.body.data.total).toBe(3);
      expect(result.status).toBe(200);
      expect(result.body.data).toEqual(baseline.body.data);
      if (path === '/workbench/works') expect(result.body.data.list.every((row: { source: string }) => row.source === 'evidence')).toBe(true);
    }
  });
  it('保留作品的项目隔离、团长范围及达人本人范围', async () => {
    const { listWorks } = await import('../../src/modules/zhihu/attribution/works');
    for (const list of [statements.listEvidence, listWorks]) {
      for (const viewer of [leader, otherLeader, team, direct]) expect((await list(viewer, scope, 1, 100)).total).toBe(1);
      expect((await list(operator, secondScope, 1, 100)).total).toBe(0);
      await expect(list(team, secondScope, 1, 100)).rejects.toMatchObject({ httpStatus: 403 });
      await expect(list(operator, { ...scope, accountId: '999' }, 1, 100)).rejects.toMatchObject({ httpStatus: 403 });
    }
    expect((await resources.options(operator, secondScope)).users.map(u => u.id)).toEqual(['12', operator.sub]);
  });
  it.each([leader, team, direct, otherLeader, otherTeam])('运营可通过路由给成员 $sub 分发且保留真实归属', async target => {
    const word = await keyword();
    actor = operator;
    const result = await request(app).post(`/keywords/${word.id}/distribute`).set('Idempotency-Key', key()).send({ ...scope, targetId: target.sub });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const [rows] = await c.query<RowDataPacket[]>('SELECT path_type,leader_id,executor_id FROM zh_keyword_bindings WHERE id=?', [result.body.data.id]);
    expect(rows[0]).toMatchObject({
      path_type: target.role === 'leader' ? 'reserved' : target.parentId ? 'team_creator' : 'direct_creator',
      leader_id: target.role === 'leader' ? Number(target.sub) : target.parentId ? Number(target.parentId) : null,
      executor_id: target.role === 'leader' ? null : Number(target.sub),
    });
  });
  it('不向停用、离项、其他项目或其他管理账号分发；本人执行仍独立于旧上级关系', async () => {
    const word = await keyword();
    actor = operator;
    for (const targetId of ['9', '10', '11', '12', '1', '8']) {
      const result = await request(app).post(`/keywords/${word.id}/distribute`).set('Idempotency-Key', key()).send({ ...scope, targetId });
      expect(result.status).toBe(403);
    }
    const own=await request(app).post(`/keywords/${word.id}/distribute`).set('Idempotency-Key',key()).send({...scope,targetId:operator.sub});
    expect(own.status,own.text).toBe(200);
    const [ownRows]=await c.query<RowDataPacket[]>('SELECT path_type,leader_id,executor_id FROM zh_keyword_bindings WHERE id=?',[own.body.data.id]);
    expect(ownRows[0]).toMatchObject({path_type:'staff_self',leader_id:null,executor_id:7});
    actor = leader;
    expect((await request(app).post(`/keywords/${word.id}/distribute`).set('Idempotency-Key', key()).send({ ...scope, targetId: '4' })).status).toBe(403);
  });
  it('运营可核验另一团队及独立达人作品，团长不能跨团队，达人不能自审', async () => {
    for (const executor of [otherTeam, direct]) {
      const saved = await evidence(executor);
      const review = (body = scope) => request(app).post(`/evidence/${saved.id}/review`).set('Idempotency-Key', key()).send({ ...body, accept: true, reason: '隔离库核验' });
      actor = leader;
      expect((await review()).status).toBe(403);
      actor = executor;
      expect((await review()).status).toBe(403);
      actor = operator;
      expect((await review(secondScope)).status).toBe(404);
      const result = await review();
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      const [rows] = await c.query<RowDataPacket[]>('SELECT status,reviewed_by FROM zh_evidence WHERE id=?', [saved.id]);
      expect(rows[0]).toMatchObject({ status: 'passed', reviewed_by: 7 });
    }
  });
  it('运营可处理另一团长的分配及释放审核，仍不能破坏团队归属', async () => {
    const word = await keyword();
    const binding = await resources.distribute(operator, scope, word.id, key(), otherLeader.sub);
    await resources.changeBinding(operator, scope, binding.id, key(), { action: 'assign', executorId: otherTeam.sub });
    await expect(resources.changeBinding(operator, scope, binding.id, key(), { action: 'assign', executorId: team.sub })).rejects.toMatchObject({ httpStatus: 403 });
    await resources.changeBinding(otherTeam, scope, binding.id, key(), { action: 'request-release', reason: '未使用' });
    actor = operator;
    const result = await request(app).post(`/bindings/${binding.id}/release`).set('Idempotency-Key', key()).send({ ...scope, reason: '已核实未使用' });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const [rows] = await c.query<RowDataPacket[]>('SELECT release_status FROM zh_keyword_bindings WHERE id=?', [binding.id]);
    expect(rows[0].release_status).toBe('approved');
  });
  it('运营的业务范围扩大不授予财务确认或引擎配置权限', async () => {
    actor = operator;
    for (const path of ['/statements/preview', '/statements/1/confirm', '/engine-route']) {
      expect((await request(app).post(path).set('Idempotency-Key', key()).send(scope)).status).toBe(403);
    }
    const { hasPermission } = await import('../../src/auth/permissions');
    expect(hasPermission('operator', 'project.manage')).toBe(false);
    expect(hasPermission('operator', 'system.develop')).toBe(false);
  });
});
