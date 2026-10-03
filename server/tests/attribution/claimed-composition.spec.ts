import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';
import { importOptionsSchema } from '../../src/modules/zhihu/services/composition-import-parser';

vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn(async () => ({ id: 'test' })) }));
let actor: AuthUser;
vi.mock('../../src/auth/middleware', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = actor;
    next();
  },
}));
const user = (sub: string, role: AuthUser['role'], parentId: string | null = null): AuthUser => ({
  sub,
  role,
  parentId,
  username: 'user' + sub,
  displayName: 'user' + sub,
  jti: 'isolated-test',
});
const admin = user('1', 'admin'),
  leader = user('2', 'leader'),
  team = user('3', 'creator', '2'),
  direct = user('4', 'creator'),
  other = user('5', 'creator');
let container: StartedMySqlContainer, c: Connection, pool: typeof import('../../src/db').db;
let resources: typeof import('../../src/modules/zhihu/attribution/resources');
let works: typeof import('../../src/modules/zhihu/services/compositions.service');
let imports: typeof import('../../src/modules/zhihu/services/composition-import.service');
let plans: typeof import('../../src/modules/zhihu/services/plans.service');
let app: express.Express,
  scope = { projectId: '1', accountId: '' },
  mappingId = '',
  serial = 0;
const input = (planId: string) => ({
  planId,
  mediaType: 'KOC小红书',
  mediaAccount: 'test-only',
  compositionType: 1,
  compositionSubType: 1,
  promoUrl: 'https://example.com/work/' + ++serial,
  releaseTime: '2026-09-29T12:00:00+08:00',
});
async function keyword(executor?: AuthUser) {
  const item = await resources.createKeyword(admin, scope, crypto.randomUUID(), {
    keyword: '登记回归' + ++serial,
    taskId: '1',
    mappingId,
    landingUrl: 'https://example.com',
    popularizeType: 0,
  });
  await c.query("UPDATE plans SET status='active',sync_status='synced',zhihu_plan_id=? WHERE id=?", [
    'upstream-' + item.planId,
    item.planId,
  ]);
  await c.query('UPDATE zh_keywords SET priority_until=TIMESTAMPADD(HOUR,-1,NOW()) WHERE id=?', [item.id]);
  await resources.synchronizeKeywords(scope,item.planId);
  let bindingId = '';
  if (executor) {
    const claimant = executor === team || executor === leader ? leader : executor;
    bindingId = (await resources.claim(claimant, scope, item.id, crypto.randomUUID())).id;
    if (claimant === leader)
      await resources.changeBinding(leader, scope, bindingId, crypto.randomUUID(), {
        action: 'assign',
        executorId: executor.sub,
      });
  }
  return { ...item, bindingId };
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('claimed_composition_test')
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
    OPC_MODULES: 'zhihu',
    DEV_DEMO_AUTH: '0',
  });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(1,'admin','unused','admin','管理员',NULL),(2,'leader','unused','leader','团长',NULL),(3,'team','unused','creator','团队达人',2),(4,'direct','unused','creator','天舒回归',NULL),(5,'other','unused','creator','他人',NULL)",
  );
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,4),(1,5)');
  const [accounts] = await c.query<RowDataPacket[]>('SELECT id FROM integration_accounts LIMIT 1');
  scope.accountId = String(accounts[0].id);
  await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'channel',1,'渠道')");
  await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'task','任务',NOW())");
  pool = (await import('../../src/db')).db;
  resources = await import('../../src/modules/zhihu/attribution/resources');
  works = await import('../../src/modules/zhihu/services/compositions.service');
  imports = await import('../../src/modules/zhihu/services/composition-import.service');
  plans = await import('../../src/modules/zhihu/services/plans.service');
  mappingId = (
    await resources.createMapping(admin, scope, crypto.randomUUID(), {
      channelId: '1',
      name: '渠道',
      from: '2020-01-01',
    })
  ).id;
  const { compositionsRouter } = await import('../../src/modules/zhihu/routes/compositions');
  const { plansRouter } = await import('../../src/modules/zhihu/routes/plans');
  const { errorHandler } = await import('../../src/middleware/errors');
  app = express()
    .use(express.json())
    .use('/compositions', compositionsRouter)
    .use('/plans', plansRouter)
    .use(errorHandler);
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

describe('领取关键词后登记作品', () => {
  it('直属达人通过真实路由登记管理员创建的已领计划，作品归本人并锁定使用关系', async () => {
    const word = await keyword(direct);
    actor = direct;
    const result = await request(app).post('/compositions').send(input(word.planId));
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const [saved] = await c.query<RowDataPacket[]>('SELECT owner_id FROM compositions WHERE plan_id=?', [word.planId]);
    expect(String(saved[0].owner_id)).toBe(direct.sub);
    expect((await works.listCompositions(direct, { planId: word.planId })).total).toBe(1);
    expect((await works.listCompositions(other, { planId: word.planId })).total).toBe(0);
    const [state] = await c.query<RowDataPacket[]>(
      'SELECT k.used_ever_at,b.used_at FROM zh_keywords k JOIN zh_keyword_bindings b ON b.id=k.current_binding_id WHERE k.id=?',
      [word.id],
    );
    expect(state[0].used_ever_at).not.toBeNull();
    expect(state[0].used_at).not.toBeNull();
    const [p] = await c.query<RowDataPacket[]>('SELECT owner_id FROM plans WHERE id=?', [word.planId]);
    expect(Number(p[0].owner_id)).toBe(1);
    const { updateMemberAccess } = await import('../../src/services/member-access.service');
    await expect(updateMemberAccess(admin, direct.sub, {role:'leader'})).rejects.toMatchObject({httpStatus:409});
    await expect(updateMemberAccess(admin, direct.sub, {parentId:leader.sub})).rejects.toMatchObject({httpStatus:409});
    await expect(updateMemberAccess(admin, direct.sub, {projectIds:[]})).rejects.toMatchObject({httpStatus:409});
  });
  it('团队达人、团长自用、团长及管理员代登记均归当前执行人', async () => {
    for (const [executor, submitter] of [
      [team, team],
      [leader, leader],
      [team, leader],
      [direct, admin],
    ]) {
      const word = await keyword(executor);
      const saved = await works.createComposition(submitter, input(word.planId));
      const [rows] = await c.query<RowDataPacket[]>('SELECT owner_id FROM compositions WHERE id=?', [saved.id]);
      expect(String(rows[0].owner_id)).toBe(executor.sub);
    }
  });
  it('可领取词只在关键词入口出现，我的计划不能浏览未领取和他人绑定', async () => {
    const free = await keyword(),
      taken = await keyword(other);
    expect(
      (await plans.listPlans(direct, { keyword: '登记回归' })).list.some((p) => String(p.id) === free.planId),
    ).toBe(false);
    expect((await resources.listKeywords(direct,scope,1,100)).list.some(w => String(w.plan_id) === free.planId)).toBe(true);
    await expect(plans.getPlan(direct,free.planId)).rejects.toMatchObject({httpStatus:404});
    for (const id of [free.planId, taken.planId])
      await expect(works.createComposition(direct, input(id))).rejects.toMatchObject({ httpStatus: 404 });
  });
  it('作品下拉与写入使用相同授权，不展示仅能浏览的待领取词', async () => {
    const mine = await keyword(direct),
      free = await keyword();
    actor = direct;
    const result = await request(app).get('/plans').query({ purpose: 'composition', pageSize: 100 });
    expect(result.status).toBe(200);
    expect(result.body.data.list.some((p: any) => String(p.id) === mine.planId)).toBe(true);
    expect(result.body.data.list.some((p: any) => String(p.id) === free.planId)).toBe(false);
  });
  it('达人计划维护接口拒绝写入，关键词入口隐藏不可领取词且保留本人历史', async () => {
    const free=await keyword(), mine=await keyword(direct), taken=await keyword(other);
    actor=direct;
    for(const result of [await request(app).post('/plans').send({}),await request(app).patch('/plans/'+mine.planId).send({name:'forbidden'}),await request(app).delete('/plans/'+mine.planId),await request(app).post('/plans/'+mine.planId+'/retry-sync').send({})])expect(result.status).toBe(403);
    await c.query("UPDATE plans SET sync_status='failed',sync_error='upstream diagnostic' WHERE id=?",[free.planId]);
    expect((await resources.listKeywords(direct,scope,1,100)).list.some(w=>String(w.plan_id)===free.planId)).toBe(false);
    await c.query("INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,composition_sub_type,promo_url) VALUES(?,4,'KOC抖音','historical',1,1,'https://example.com/historical-scope')",[taken.planId]);
    await c.query("UPDATE plans SET status='ended' WHERE id=?",[taken.planId]);
    const visible=await plans.listPlans(direct,{pageSize:100});
    expect(visible.list.find(p=>String(p.id)===mine.planId)).toMatchObject({can_register:true});
    expect(visible.list.find(p=>String(p.id)===taken.planId)).toMatchObject({can_register:false});
    for(const plan of visible.list) expect(plan).toMatchObject({sync_error:null});
    await c.query('UPDATE project_members SET left_at=NOW(3) WHERE project_id=1 AND user_id=4');
    expect((await plans.listPlans(direct,{pageSize:100})).total).toBe(0);
    expect((await plans.listPlans(direct,{purpose:'composition',pageSize:100})).total).toBe(0);
    await c.query('UPDATE project_members SET left_at=NULL WHERE project_id=1 AND user_id=4');
  });
  it('Excel 分析、导入和重复导入支持已领取词并保持执行人归属', async () => {
    const word = await keyword(direct);
    const [p] = await c.query<RowDataPacket[]>('SELECT keyword FROM plans WHERE id=?', [word.planId]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['日期', '平台id', '平台', '视频链接', '关键词'],
        ['2026-09-29', 'account', '小红书', 'https://xhslink.cn/o/claimed-test', p[0].keyword],
      ]),
      '作品',
    );
    const file = {
      originalname: '作品.xlsx',
      buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    };
    const options = importOptionsSchema.parse({ categoryMode: 'rotate-video' });
    expect((await imports.analyzeCompositionImport(direct, file, options)).ready).toBe(1);
    expect((await imports.commitCompositionImport(direct, file, options)).created).toBe(1);
    expect((await imports.commitCompositionImport(direct, file, options)).created).toBe(0);
    expect((await works.listCompositions(direct, { planId: word.planId })).total).toBe(1);
  });
  it.each(['stopped', 'released', 'release-requested', 'left-project', 'changed-team', 'disabled-account', 'ended'])(
    '拒绝失效关系：%s',
    async (reason) => {
      const word = await keyword(team);
      const reset: (() => Promise<unknown>)[] = [];
      if (reason === 'stopped')
        await c.query('UPDATE zh_keyword_bindings SET stop_new_use_at=NOW() WHERE id=?', [word.bindingId]);
      if (reason === 'released')
        await c.query('UPDATE zh_keyword_bindings SET released_at=NOW() WHERE id=?', [word.bindingId]);
      if (reason === 'release-requested')
        await c.query("UPDATE zh_keyword_bindings SET release_status='requested' WHERE id=?", [word.bindingId]);
      if (reason === 'left-project') {
        await c.query('UPDATE project_members SET left_at=NOW() WHERE project_id=1 AND user_id=3');
        reset.push(() => c.query('UPDATE project_members SET left_at=NULL WHERE project_id=1 AND user_id=3'));
      }
      if (reason === 'changed-team') {
        await c.query('UPDATE users SET parent_id=NULL WHERE id=3');
        reset.push(() => c.query('UPDATE users SET parent_id=2 WHERE id=3'));
      }
      if (reason === 'disabled-account') {
        await c.query("UPDATE integration_accounts SET status='disabled' WHERE id=?", [scope.accountId]);
        reset.push(() => c.query("UPDATE integration_accounts SET status='active' WHERE id=?", [scope.accountId]));
      }
      if (reason === 'ended') await c.query("UPDATE plans SET status='ended' WHERE id=?", [word.planId]);
      try {
        await expect(works.createComposition(team, input(word.planId))).rejects.toMatchObject({ httpStatus: 404 });
      } finally {
        for (const fn of reset) await fn();
      }
    },
  );
  it('旧个人计划与管理端公池登记保留原归属，达人批量失败整体回滚', async () => {
    await c.query(
      "INSERT INTO plans(id,project_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by) VALUES(9001,1,'task','channel','历史个人','https://example.com',0,4,4)",
    );
    expect((await works.createComposition(direct, input('9001'))).id).toBeTruthy();
    const free = await keyword();
    const registered=await works.createComposition(admin,input(free.planId));
    expect(String((await c.query<RowDataPacket[]>('SELECT owner_id FROM compositions WHERE id=?',[registered.id]))[0][0].owner_id)).toBe(admin.sub);
    await expect(resources.distribute(admin,scope,free.id,crypto.randomUUID(),direct.sub)).rejects.toMatchObject({httpStatus:409});
    const mine = await keyword(direct),
      notMine = await keyword(other);
    await expect(
      works.createCompositionBatch(direct, [input(mine.planId), input(notMine.planId)]),
    ).rejects.toMatchObject({ httpStatus: 404 });
    const [count] = await c.query<RowDataPacket[]>('SELECT COUNT(*) total FROM compositions WHERE plan_id=?', [
      mine.planId,
    ]);
    expect(Number(count[0].total)).toBe(0);
    const [state] = await c.query<RowDataPacket[]>('SELECT used_ever_at FROM zh_keywords WHERE id=?', [mine.id]);
    expect(state[0].used_ever_at).toBeNull();
  });
  it('Excel 预览快照之后绑定被撤回时，提交必须重新校验当前关系', async () => {
    const word = await keyword(direct),
      connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('SELECT * FROM zh_keywords WHERE id=?', [word.id]);
      await connection.query('SELECT * FROM zh_keyword_bindings WHERE id=?', [word.bindingId]);
      await c.query('UPDATE zh_keyword_bindings SET stop_new_use_at=NOW() WHERE id=?', [word.bindingId]);
      await expect(works.insertComposition(direct, input(word.planId), connection)).rejects.toMatchObject({
        httpStatus: 404,
      });
    } finally {
      await connection.rollback();
      connection.release();
    }
  });
});
