import { accountRuntime } from '../support/accountRuntime';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
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

describe('reviewed member changes preserve old business ownership',()=>{
  async function fresh(role:'leader'|'creator'='creator',parentId:string|null=null){
    const name='changed_'+ ++serial;
    const [r]=await c.query<ResultSetHeader>('INSERT INTO users(username,password_hash,role,display_name,parent_id,is_active) VALUES(?,?,?,?,?,1)',[name,'unused',role,name,parentId]);
    const id=String(r.insertId);await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,?)',[id]);return user(id,role,parentId);
  }
  async function move(ids:string[],operation:import('../../src/services/member-changes.service').MemberChangeOperation){
    const service=await import('../../src/services/member-changes.service');
    const preview=await service.previewMemberChanges(admin,ids,operation,accountRuntime());
    expect(preview.items.every(i=>i.status==='ready'),JSON.stringify(preview)).toBe(true);
    const done=await service.executeMemberChanges(admin,preview.id,preview.reviewHash,accountRuntime());
    expect(done.items.every(i=>i.status==='succeeded'),JSON.stringify(done)).toBe(true);return done;
  }
  async function binding(id:string){return (await c.query<RowDataPacket[]>('SELECT * FROM zh_keyword_bindings WHERE id=?',[id]))[0][0];}
  async function amounts(b:RowDataPacket){
    const {withTransaction}=await import('../../src/db');const {quote}=await import('../../src/modules/zhihu/attribution/pricing');const {quoteActivation}=await import('../../src/modules/zhihu/attribution/activation-pricing');
    return withTransaction(async conn=>({newUser:await quote(conn,scope,'1',b,'2026-10-01','100'),activation:await quoteActivation(conn,scope,b,'2026-10-01','100',null)}));
  }
  it.each(['role', 'edit'] as const)('upgrades a creator via %s and preserves their old direct task, both prices and composition picker',async(kind)=>{
    const m=await fresh(),word=await keyword(m),old=await binding(word.bindingId),prices=await amounts(old);
    const {previewMemberChanges,executeMemberChanges}=await import('../../src/services/member-changes.service');
    const preview=await previewMemberChanges(admin,[m.sub],kind === 'role' ? {kind,role:'leader'} : {kind,role:'leader',displayName:'单人升级',phone:null,isActive:true},accountRuntime());
    expect(preview.items[0].status).toBe('ready');expect((await binding(word.bindingId)).access_preserved_at).toBeNull();
    await executeMemberChanges(admin,preview.id,preview.reviewHash,accountRuntime());
    const upgraded={...m,role:'leader' as const},saved=await binding(word.bindingId);
    expect(saved.access_preserved_at).toBeTruthy();expect(saved.path_type).toBe(old.path_type);expect(saved.executor_id).toBe(old.executor_id);expect(saved.leader_id).toBe(old.leader_id);expect(saved.relation_snapshot).toEqual(old.relation_snapshot);expect(await amounts(saved)).toEqual(prices);
    expect((await plans.listPlans(upgraded,{purpose:'composition'})).list.some(p=>String(p.id)===word.planId)).toBe(true);
    await resources.changeBinding(upgraded,scope,word.bindingId,crypto.randomUUID(),{action:'activate'});
    expect((await works.createComposition(upgraded,input(word.planId))).id).toBeTruthy();
    const next=await keyword();const reserved=await resources.claim(upgraded,scope,next.id,crypto.randomUUID());await resources.changeBinding(upgraded,scope,reserved.id,crypto.randomUUID(),{action:'assign',executorId:m.sub});
    expect((await binding(reserved.id)).path_type).toBe('leader_self');
    await expect(works.createComposition(other,input(word.planId))).rejects.toMatchObject({httpStatus:404});
  });
  it.each(['team', 'edit'] as const)('moves an executor via %s without giving the new leader access to old team works or old revenue',async(kind)=>{
    const oldLeader=await fresh('leader'),newLeader=await fresh('leader'),m=await fresh('creator',oldLeader.sub),word=await keyword();
    const assigned=await resources.claim(oldLeader,scope,word.id,crypto.randomUUID());await resources.changeBinding(oldLeader,scope,assigned.id,crypto.randomUUID(),{action:'assign',executorId:m.sub});
    const work=await works.createComposition(m,input(word.planId)),before=await binding(assigned.id),prices=await amounts(before);
    await move([m.sub],kind === 'team' ? {kind,parentId:newLeader.sub} : {kind,role:'creator',parentId:newLeader.sub,displayName:'单人转团',phone:null,isActive:true});const moved={...m,parentId:newLeader.sub};
    expect(await amounts(await binding(assigned.id))).toEqual(prices);
    expect((await works.listCompositions(oldLeader,{planId:word.planId})).total).toBe(1);
    expect((await works.listCompositions(newLeader,{planId:word.planId})).total).toBe(0);
    await expect(works.getComposition(newLeader,work.id)).rejects.toMatchObject({httpStatus:404});
    expect((await works.createComposition(moved,input(word.planId))).id).toBeTruthy();
    expect((await works.createComposition(oldLeader,input(word.planId))).id).toBeTruthy();
    await expect(works.createComposition(newLeader,input(word.planId))).rejects.toMatchObject({httpStatus:404});
    const next=await keyword(),newAssignment=await resources.claim(newLeader,scope,next.id,crypto.randomUUID());await resources.changeBinding(newLeader,scope,newAssignment.id,crypto.randomUUID(),{action:'assign',executorId:m.sub});
    expect(String((await binding(newAssignment.id)).leader_id)).toBe(newLeader.sub);
    await works.createComposition(moved,input(next.planId));expect((await works.listCompositions(oldLeader,{planId:next.planId})).total).toBe(0);
    const {listWorks}=await import('../../src/modules/zhihu/attribution/works');
    expect((await listWorks(newLeader,scope,1,20,{planId:word.planId})).total).toBe(0);
    expect((await listWorks(oldLeader,scope,1,20,{planId:word.planId})).total).toBe(3);
  });
  it('demotes a leader and relocates members while preserving self tasks and child execution',async()=>{
    const l=await fresh('leader'),m=await fresh('creator',l.sub),word=await keyword(),childWord=await keyword();
    const own=await resources.claim(l,scope,word.id,crypto.randomUUID());await resources.changeBinding(l,scope,own.id,crypto.randomUUID(),{action:'assign',executorId:l.sub});
    const child=await resources.claim(l,scope,childWord.id,crypto.randomUUID());await resources.changeBinding(l,scope,child.id,crypto.randomUUID(),{action:'assign',executorId:m.sub});
    await move([l.sub],{kind:'role',role:'creator',parentId:null,childrenParentId:null});
    expect((await works.createComposition({...l,role:'creator'},input(word.planId))).id).toBeTruthy();
    expect((await works.createComposition({...m,parentId:null},input(childWord.planId))).id).toBeTruthy();
    expect((await binding(own.id)).path_type).toBe('leader_self');expect(String((await binding(child.id)).leader_id)).toBe(l.sub);
  });
  it('blocks unassigned reservations and removed project access; rechecks new tasks after preview',async()=>{
    const service=await import('../../src/services/member-changes.service');
    const l=await fresh('leader'),free=await keyword();await resources.claim(l,scope,free.id,crypto.randomUUID());
    const reserved=await service.previewMemberChanges(admin,[l.sub],{kind:'role',role:'creator'},accountRuntime());expect(reserved.items[0].status).toBe('blocked');expect(reserved.items[0].message).toContain('待分配任务');
    const m=await fresh(),word=await keyword(m);const removal=await service.previewMemberChanges(admin,[m.sub],{kind:'projects',mode:'remove',projectIds:['1']},accountRuntime());expect(removal.items[0].status).toBe('blocked');
    const preview=await service.previewMemberChanges(admin,[m.sub],{kind:'role',role:'leader'},accountRuntime());await keyword(m);
    const result=await service.executeMemberChanges(admin,preview.id,preview.reviewHash,accountRuntime());expect(result.items[0].status).toBe('failed');expect((await binding(word.bindingId)).access_preserved_at).toBeNull();
  });
  it('rolls back descendant moves if a new reservation blocks the leader after preview',async()=>{
    const service=await import('../../src/services/member-changes.service');
    const l=await fresh('leader'),m=await fresh('creator',l.sub),word=await keyword();
    const assigned=await resources.claim(l,scope,word.id,crypto.randomUUID());await resources.changeBinding(l,scope,assigned.id,crypto.randomUUID(),{action:'assign',executorId:m.sub});
    const preview=await service.previewMemberChanges(admin,[l.sub],{kind:'role',role:'creator',childrenParentId:null},accountRuntime());expect(preview.items[0].status).toBe('ready');
    const free=await keyword();await resources.claim(l,scope,free.id,crypto.randomUUID());
    const done=await service.executeMemberChanges(admin,preview.id,preview.reviewHash,accountRuntime());expect(done.items[0].status).toBe('failed');
    expect(String((await c.query<RowDataPacket[]>('SELECT parent_id FROM users WHERE id=?',[m.sub]))[0][0].parent_id)).toBe(l.sub);
    expect((await binding(assigned.id)).access_preserved_at).toBeNull();
  });
  it('does not let an old leader reassign a preserved unused task after its executor moves',async()=>{
    const l=await fresh('leader'),nextLeader=await fresh('leader'),m=await fresh('creator',l.sub),replacement=await fresh('creator',l.sub),word=await keyword();
    const assigned=await resources.claim(l,scope,word.id,crypto.randomUUID());await resources.changeBinding(l,scope,assigned.id,crypto.randomUUID(),{action:'assign',executorId:m.sub});
    await move([m.sub],{kind:'team',parentId:nextLeader.sub});
    await expect(resources.changeBinding(l,scope,assigned.id,crypto.randomUUID(),{action:'assign',executorId:replacement.sub})).rejects.toMatchObject({httpStatus:409});
    expect(String((await binding(assigned.id)).executor_id)).toBe(m.sub);
    await resources.changeBinding({...m,parentId:nextLeader.sub},scope,assigned.id,crypto.randomUUID(),{action:'activate'});
  });
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
    await expect(updateMemberAccess(admin, direct.sub, {role:'leader'}, accountRuntime())).rejects.toMatchObject({httpStatus:409});
    await expect(updateMemberAccess(admin, direct.sub, {parentId:leader.sub}, accountRuntime())).rejects.toMatchObject({httpStatus:409});
    await expect(updateMemberAccess(admin, direct.sub, {projectIds:[]}, accountRuntime())).rejects.toMatchObject({httpStatus:409});
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
