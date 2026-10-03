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
  await ready(self.planId);
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
it('upstream failure blocks leader assignment and all work entry points before any usage is recorded', async () => {
  const {createComposition,createCompositionBatch}=await import('../../src/modules/zhihu/services/compositions.service');
  const {compositionPlanScope}=await import('../../src/modules/zhihu/services/composition-access');
  const work=(planId:string)=>({planId,mediaType:'KOC抖音',mediaAccount:'isolated',compositionType:1,compositionSubType:1,promoUrl:'https://example.com/gates/'+planId,releaseTime:'2026-10-03 12:00:00'});
  for(const status of ['local','syncing','failed','synced']) {
    const word=await resources.createKeyword(leader,scope,key(),input());
    const b=await binding(word.id);
    await c.query("UPDATE plans SET sync_status=?,sync_error='HTTP 400 / code 400402: private diagnostic',zhihu_plan_id=NULL WHERE id=?",[status,word.planId]);
    await expect(resources.changeBinding(leader,scope,String(b.id),key(),{action:'assign',executorId:'3'})).rejects.toMatchObject({httpStatus:409});
    // Reproduce an assignment made by the old defective version.
    await c.query("UPDATE zh_keyword_bindings SET path_type='team_creator',executor_id=3 WHERE id=?",[b.id]);
    await c.query("UPDATE zh_keywords SET lifecycle_status='assigned' WHERE id=?",[word.id]);
    await expect(resources.changeBinding(team,scope,String(b.id),key(),{action:'activate'})).rejects.toMatchObject({httpStatus:409});
    for(const who of [team,leader,admin]) await expect(createComposition(who,work(word.planId))).rejects.toMatchObject({httpStatus:409});
    await expect(createCompositionBatch(team,[work(word.planId)])).rejects.toMatchObject({httpStatus:409});
    const access=compositionPlanScope(team);
    const [picker]=await c.query<RowDataPacket[]>(`SELECT p.id FROM plans p WHERE p.id=? AND ${access.clause}`,[word.planId,...access.bindings]);
    expect(picker).toHaveLength(0);
    const saved=await binding(word.id);expect(saved.used_at).toBeNull();expect(saved.used_ever_at).toBeNull();
    const row=(await resources.listKeywords(team,scope,1,100)).list.find(r=>r.id===word.id)!;
    expect(row.usage_ready).toBe(0);
    if(status==='failed') expect(String(row.sync_error)).toContain('未返回可识别的具体原因');
    await ready(word.planId);
    expect((await createComposition(team,work(word.planId))).id).toBeTruthy();
    await expect(resources.changeBinding(leader,scope,String(b.id),key(),{action:'assign',executorId:'2'})).rejects.toThrow('保留原归属');
  }
});
it('historical works and order facts cannot be recycled, including stale available lifecycle and pagination',async()=>{
  const prefix='历史保护'+Date.now();
  for(const history of ['work','fact']) {
    const word=await resources.createKeyword(admin,scope,key(),input(prefix+history));await ready(word.planId);
    await c.query('UPDATE zh_keywords SET priority_until=TIMESTAMPADD(HOUR,-1,NOW()) WHERE id=?',[word.id]);
    if(history==='work') await c.query("INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,composition_sub_type,promo_url) VALUES(?,4,'KOC抖音','isolated',1,1,?)",[word.planId,'https://example.com/old/'+word.id]);
    else await c.query("INSERT INTO zh_metric_facts(account_id,project_id,channel_mapping_id,keyword_id,business_date) SELECT account_id,project_id,channel_mapping_id,id,'2026-10-03' FROM zh_keywords WHERE id=?",[word.id]);
    const pool=(await resources.listKeywords(leader,scope,1,1,prefix,'available'));expect(pool.total).toBe(0);
    const all=(await resources.listKeywords(admin,scope,1,20,prefix)).list.find(r=>r.id===word.id)!;
    expect(all.allocation_ready).toBe(0);expect(all.read_only).toBe(1);expect(all.lifecycle_status).toBe('historical');
    await expect(resources.claim(leader,scope,word.id,key())).rejects.toThrow('保留原归属');
    await expect(resources.distribute(admin,scope,word.id,key(),'4')).rejects.toThrow('保留原归属');
  }
  const free=await resources.createKeyword(admin,scope,key(),input(prefix+'free'));await ready(free.planId);
  const page=await resources.listKeywords(leader,scope,1,1,prefix,'available');expect(page.total).toBe(1);expect(page.list[0].id).toBe(free.id);
  expect((await resources.listKeywords(admin,scope,1,1,prefix,'registered')).total).toBe(1);
  expect((await resources.listKeywords(admin,scope,1,1,prefix,'retired')).total).toBe(0);
  const concurrent=await Promise.allSettled([resources.claim(leader,scope,free.id,key()),resources.claim(other,scope,free.id,key())]);
  expect(concurrent.filter(r=>r.status==='fulfilled')).toHaveLength(1);
});
it('release and reassignment detect historical works even if usage markers were missing',async()=>{
  const word=await resources.createKeyword(leader,scope,key(),input());await ready(word.planId);const b=await binding(word.id);
  await resources.changeBinding(leader,scope,String(b.id),key(),{action:'assign',executorId:'3'});
  await c.query("INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,composition_sub_type,promo_url) VALUES(?,3,'KOC抖音','isolated',1,1,?)",[word.planId,'https://example.com/missing-marker/'+word.id]);
  await expect(resources.changeBinding(leader,scope,String(b.id),key(),{action:'assign',executorId:'2'})).rejects.toThrow('保留原归属');
  await expect(resources.changeBinding(leader,scope,String(b.id),key(),{action:'request-release',reason:'test'})).rejects.toThrow('保留原归属');
});

it('failed words can be edited in place with ownership and form fields preserved, but not stolen or duplicated',async()=>{
  const original=input();const word=await resources.createKeyword(leader,scope,key(),original);const b=await binding(word.id);
  await c.query("UPDATE plans SET sync_status='failed',sync_error='code 400402' WHERE id=?",[word.planId]);
  await expect(resources.editFailedKeyword(other,scope,word.id,key(),'越权改名')).rejects.toMatchObject({httpStatus:403});
  const taken=input();await resources.createKeyword(admin,scope,key(),taken);
  await expect(resources.editFailedKeyword(leader,scope,word.id,key(),taken.keyword)).rejects.toThrow('已存在');
  const retryKey=key(),edited=input().keyword;
  actor=leader;
  const response=await request(app).post(`/keywords/${word.id}/edit-retry`).send({...scope,keyword:edited,requestKey:retryKey});
  expect(response.status,JSON.stringify(response.body)).toBe(200);
  expect(await resources.editFailedKeyword(leader,scope,word.id,retryKey,edited)).toEqual({id:word.id,planId:word.planId});
  const [[p]]=await c.query<RowDataPacket[]>('SELECT * FROM plans WHERE id=?',[word.planId]);
  expect(p.keyword).toBe(edited);expect(p.landing_url).toBe(original.landingUrl);expect(p.zhihu_task_id).toBe('task');expect(p.channel_id).toBe('channel');expect(p.sync_status).toBe('local');
  expect(String((await binding(word.id)).id)).toBe(String(b.id));
  await expect(resources.changeBinding(leader,scope,String(b.id),key(),{action:'assign',executorId:'3'})).rejects.toMatchObject({httpStatus:409});
  await ready(word.planId);
  await expect(resources.deleteFailedKeyword(leader,scope,word.id,key())).rejects.toThrow('仅可处理');
  // Legacy plan-only rows cannot be sent to the exclusive-keyword mutation API.
  const oldWord=input().keyword;
  await c.query("INSERT INTO plans(project_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by,sync_status) VALUES(1,'task','channel',?,'https://example.com',0,1,1,'failed')",[oldWord]);
  const old=(await resources.listKeywords(admin,scope,1,20,oldWord)).list[0];
  expect(String(old.id)).toMatch(/^plan:/);expect(old).toMatchObject({read_only:1,can_edit_failed:0,can_copy_failed:0,can_delete_failed:0});
});
it('failed used records can be copied or hidden without changing historical attribution or deleting works',async()=>{
  const original=input();const word=await resources.createKeyword(direct,scope,key(),original);await ready(word.planId);
  const {createComposition}=await import('../../src/modules/zhihu/services/compositions.service');
  const work=await createComposition(direct,{planId:word.planId,mediaType:'KOC抖音',mediaAccount:'isolated',compositionType:1,compositionSubType:1,promoUrl:'https://example.com/correction/'+word.id,releaseTime:'2026-10-03 12:00:00'});
  await c.query("UPDATE plans SET sync_status='failed',zhihu_plan_id=NULL,sync_error='code 400402' WHERE id=?",[word.planId]);
  await expect(resources.editFailedKeyword(direct,scope,word.id,key(),input().keyword)).rejects.toThrow('保留原归属');
  const copy=await resources.copyFailedKeyword(direct,scope,word.id,key(),input().keyword);
  expect(copy.id).not.toBe(word.id);expect(String((await binding(copy.id)).executor_id)).toBe(direct.sub);
  const [[copied]]=await c.query<RowDataPacket[]>('SELECT landing_url,channel_id FROM plans WHERE id=?',[copy.planId]);expect(copied.landing_url).toBe(original.landingUrl);expect(copied.channel_id).toBe('channel');
  await expect(resources.deleteFailedKeyword(other,scope,word.id,key())).rejects.toMatchObject({httpStatus:403});
  const deletion=key();await resources.deleteFailedKeyword(direct,scope,word.id,deletion);await resources.deleteFailedKeyword(direct,scope,word.id,deletion);
  expect((await resources.listKeywords(direct,scope,1,25,original.keyword)).total).toBe(0);
  const [rows]=await c.query<RowDataPacket[]>('SELECT owner_id FROM compositions WHERE id=?',[work.id]);expect(rows).toHaveLength(1);expect(String(rows[0].owner_id)).toBe(direct.sub);
  const b=await binding(word.id);expect(b.lifecycle_status).toBe('archived');expect(b.stop_new_use_at).not.toBeNull();expect(b.released_at).toBeNull();expect(b.used_ever_at).not.toBeNull();
  await expect(resources.retryKeyword(admin,scope,word.id,key())).rejects.toThrow('已删除');
  await expect(resources.claim(leader,scope,word.id,key())).rejects.toThrow('不可领取');
  const {pushPlan}=await import('../../src/modules/zhihu/jobs/pushPlan');await pushPlan({planId:word.planId});
  const [[p]]=await c.query<RowDataPacket[]>('SELECT status,sync_status FROM plans WHERE id=?',[word.planId]);expect(p.status).toBe('ended');expect(p.sync_status).toBe('failed');
});
it('historical works belonging to another owner block new use while preserving records',async()=>{
  const word=await resources.createKeyword(direct,scope,key(),input());await ready(word.planId);
  await c.query("INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,composition_sub_type,promo_url) VALUES(?,1,'KOC抖音','historical',1,1,?)",[word.planId,'https://example.com/conflict/'+word.id]);
  const b=await binding(word.id);
  await expect(resources.changeBinding(direct,scope,String(b.id),key(),{action:'activate'})).rejects.toThrow('归属与当前使用人不一致');
  const row=(await resources.listKeywords(direct,scope,1,100)).list.find(r=>r.id===word.id)!;expect(row.usage_ready).toBe(0);expect(Number(row.ownership_conflict)).toBe(1);
});


it('failed keyword can change task, channel and URL while keeping its exclusive owner',async()=>{
  await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(2,1,'task-two','另一任务',NOW())");
  await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(2,1,'channel-two',1,'另一渠道')");
  const original=input();const word=await resources.createKeyword(leader,scope,key(),original);const owner=await binding(word.id);
  await c.query("UPDATE plans SET sync_status='failed',sync_error='code 400402' WHERE id=?",[word.planId]);
  const patch={taskId:'2',channelId:'2',landingUrl:'https://example.com/new-content',popularizeType:0};
  actor=leader;
  await expect(resources.editFailedKeyword(leader,scope,word.id,key(),original.keyword,{...patch,taskId:'99999'})).rejects.toThrow('可用的任务和渠道');
  const r=await request(app).post(`/keywords/${word.id}/edit-retry`).send({...scope,...patch,keyword:original.keyword,requestKey:key()});
  expect(r.status,JSON.stringify(r.body)).toBe(200);
  const [[plan]]=await c.query<RowDataPacket[]>('SELECT * FROM plans WHERE id=?',[word.planId]);
  expect(plan).toMatchObject({keyword:original.keyword,zhihu_task_id:'task-two',channel_id:'channel-two',landing_url:patch.landingUrl,sync_status:'local'});
  expect(String((await binding(word.id)).id)).toBe(String(owner.id));
  const row=(await resources.listKeywords(leader,scope,1,100,original.keyword)).list[0];
  expect(String(row.task_id)).toBe('2');expect(row.landing_url).toBe(patch.landingUrl);expect(String(row.mapping_id)).toBeTruthy();
});
it('work editing retains attribution, updates every field and rejects other owners or mismatched platform links',async()=>{
  const {createComposition,updateComposition,listCompositions}=await import('../../src/modules/zhihu/services/compositions.service');
  const {listWorks}=await import('../../src/modules/zhihu/attribution/works');
  const word=await resources.createKeyword(team,scope,key(),input());await ready(word.planId);
  const bad={planId:word.planId,mediaType:'KOC抖音',mediaAccount:'old',compositionType:1,compositionSubType:1,promoUrl:'https://www.tiktok.com/@example/video/123',releaseTime:'2026-10-03T12:00:00+08:00'};
  await expect(createComposition(team,bad)).rejects.toThrow('链接来自“TikTok”');expect((await binding(word.id)).used_at).toBeNull();
  const original={...bad,promoUrl:'https://www.douyin.com/video/123'};const work=await createComposition(team,original);const b=await binding(word.id);
  await c.query('INSERT INTO zh_evidence(binding_id,work_url,description,submitted_by) VALUES(?,?,?,3)',[b.id,original.promoUrl,'旧描述']);
  await c.query("UPDATE compositions SET sync_status='failed',sync_error='知乎接口失败（HTTP 400 / code 400402）：关键词不符合知乎规则，请更换关键词' WHERE id=?",[work.id]);
  expect(((await listCompositions(team,{planId:word.planId})).list[0] as RowDataPacket).failure_reason).toContain('旧版提示未保留具体原因');
  const patch={mediaType:'KOC小红书',mediaAccount:'new',compositionType:2,compositionSubType:6,promoUrl:'https://www.xiaohongshu.com/explore/abc',releaseTime:'2026-10-02T12:30:00+08:00',title:'修改标题'};
  await expect(updateComposition(direct,work.id,patch)).rejects.toMatchObject({httpStatus:404});
  await expect(updateComposition(team,work.id,{...patch,mediaType:'KOC抖音'})).rejects.toThrow('发布平台与作品链接不一致');
  const saved=await updateComposition(team,work.id,patch) as RowDataPacket;
  expect(saved).toMatchObject({media_type:patch.mediaType,media_account:'new',promo_url:patch.promoUrl,composition_type:2,composition_sub_type:6,title:patch.title,sync_status:'local',sync_error:null});
  expect(String(saved.owner_id)).toBe(team.sub);expect(String(saved.plan_id)).toBe(word.planId);
  const joined=(await listWorks(team,scope,1,100)).list.filter(r=>r.composition_id===work.id);expect(joined).toHaveLength(1);expect(joined[0].work_url).toBe(patch.promoUrl);
  await updateComposition(team,work.id,{title:null});
  const cleared=(await listWorks(team,scope,1,100)).list.find(r=>r.composition_id===work.id);expect(cleared?.description).toBe('');
  await c.query("UPDATE compositions SET sync_status='syncing' WHERE id=?",[work.id]);
  await expect(updateComposition(team,work.id,{title:'too soon'})).rejects.toThrow('正在提交');
  await expect(resources.changeBinding(leader,scope,String(b.id),key(),{action:'assign',executorId:'2'})).rejects.toThrow('保留原归属');
});
it('successful submission automatically checks routine ownership; failed, conflicting and disputed works remain untouched',async()=>{
  const {createComposition}=await import('../../src/modules/zhihu/services/compositions.service');
  const {confirmSubmittedWorks}=await import('../../src/modules/zhihu/services/automatic-work-check');
  for(const mode of ['normal','web','failed','missing-id','disputed','rejected','conflicting','ended']){
    const word=await resources.createKeyword(direct,scope,key(),input());await ready(word.planId);
    const url='https://example.com/auto/'+word.id;
    const work=await createComposition(direct,{planId:word.planId,mediaType:'KOC抖音',mediaAccount:'test',compositionType:1,compositionSubType:1,promoUrl:url,releaseTime:'2026-10-03T12:00:00+08:00'});const b=await binding(word.id);
    if(mode!=='web')await c.query('INSERT INTO zh_evidence(binding_id,work_url,description,submitted_by,status) VALUES(?,?,?,4,?)',[b.id,url,'test',mode==='rejected'?'rejected':'pending']);
    await c.query('UPDATE compositions SET sync_status=?,zhihu_composition_id=?,status=? WHERE id=?',[mode==='failed'?'failed':'synced',mode==='missing-id'?null:String(2089756298078437900n+BigInt(work.id)),mode==='ended'?'ended':'pending',work.id]);
    if(mode==='disputed')await c.query("UPDATE zh_keyword_bindings SET verification_status='disputed' WHERE id=?",[b.id]);
    if(mode==='conflicting')await c.query("INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,composition_sub_type,promo_url) VALUES(?,3,'KOC抖音','other',1,1,?)",[word.planId,url+'/other']);
    await confirmSubmittedWorks(work.id);await confirmSubmittedWorks(work.id);
    expect((await binding(word.id)).verification_status,mode).toBe(['normal','web'].includes(mode)?'passed':mode==='disputed'?'disputed':'pending');
    if(mode!=='web'){const [[e]]=await c.query<RowDataPacket[]>('SELECT status,reviewed_by FROM zh_evidence WHERE binding_id=?',[b.id]);expect(e.status,mode).toBe(mode==='normal'?'passed':mode==='rejected'?'rejected':'pending');expect(e.reviewed_by).toBeNull();}
  }
});

it('staff imports public-pool history without a claim, preserving its platform owner and permanent exclusive use',async()=>{
  const XLSX=await import('xlsx');
  const {analyzeCompositionImport,commitCompositionImport}=await import('../../src/modules/zhihu/services/composition-import.service');
  const {importOptionsSchema}=await import('../../src/modules/zhihu/services/composition-import-parser');
  const {createComposition,updateComposition,insertComposition}=await import('../../src/modules/zhihu/services/compositions.service');
  const word=await resources.createKeyword(admin,scope,key(),input());await ready(word.planId);
  const item={planId:word.planId,mediaType:'KOC抖音',mediaAccount:'public-history',compositionType:2,compositionSubType:9,promoUrl:'https://v.douyin.com/history'+word.id+'/',releaseTime:'2026-10-03T12:00:00+08:00'};
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
    ['推广计划','关键词','媒体类型','媒体账号','推广链接','作品分类','作品子分类','发布时间'],
    ['',input().keyword,'抖音','public-history',item.promoUrl,'视频','解压','2026-10-03 12:00']
  ]),'作品');
  book.Sheets['作品'].B2.v=(await c.query<RowDataPacket[]>('SELECT keyword FROM plans WHERE id=?',[word.planId]))[0][0].keyword;
  const file={originalname:'history.xlsx',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer},opts=importOptionsSchema.parse({});
  const preview=await analyzeCompositionImport(admin,file,opts);expect(preview.ready).toBe(1);expect(preview.rows[0].notes).toContain('登记后保留平台原归属，该关键词不再开放领取');
  for(const who of [leader,direct,team]){expect((await analyzeCompositionImport(who,file,opts)).ready).toBe(0);await expect(createComposition(who,item)).rejects.toMatchObject({httpStatus:404});}
  const imported=await commitCompositionImport(admin,file,opts);expect(imported.created).toBe(1);
  const [[saved]]=await c.query<RowDataPacket[]>('SELECT c.owner_id,p.owner_id plan_owner,k.current_binding_id,k.used_ever_at FROM compositions c JOIN plans p ON p.id=c.plan_id JOIN zh_keywords k ON k.plan_id=p.id WHERE c.id=?',[imported.ids[0]]);
  expect(String(saved.owner_id)).toBe('1');expect(String(saved.plan_owner)).toBe('1');expect(saved.current_binding_id).toBeNull();expect(saved.used_ever_at).not.toBeNull();
  expect((await resources.listKeywords(leader,scope,1,100,preview.rows[0].keyword,'available')).total).toBe(0);
  await expect(resources.claim(leader,scope,word.id,key())).rejects.toMatchObject({httpStatus:409});
  await expect(resources.distribute(admin,scope,word.id,key(),'4')).rejects.toMatchObject({httpStatus:409});
  expect((await commitCompositionImport(admin,file,opts)).duplicate).toBe(1);
  await updateComposition(admin,imported.ids[0],{title:'历史作品修正'});
  // Additional works may retain the same owner; never grant a creator access to the used pool word.
  expect((await createComposition(admin,{...item,promoUrl:item.promoUrl+'second'})).id).toBeTruthy();
  await expect(createComposition(direct,item)).rejects.toMatchObject({httpStatus:404});
  const assigned=await resources.createKeyword(direct,scope,key(),input());await ready(assigned.planId);
  const owned=await createComposition(admin,{...item,planId:assigned.planId,promoUrl:item.promoUrl+'assigned'});
  expect(String((await c.query<RowDataPacket[]>('SELECT owner_id FROM compositions WHERE id=?',[owned.id]))[0][0].owner_id)).toBe('4');
  const failed=await resources.createKeyword(admin,scope,key(),input());
  await expect(createComposition(admin,{...item,planId:failed.planId})).rejects.toMatchObject({httpStatus:404});
  // A claim after a spreadsheet snapshot must not silently award history to the new claimant.
  const raced=await resources.createKeyword(admin,scope,key(),input());await ready(raced.planId);
  const tx=await pool.getConnection();await tx.beginTransaction();
  try {
    await tx.query('SELECT owner_id FROM plans WHERE id=?',[raced.planId]);
    await resources.claim(leader,scope,raced.id,key());
    const b=await binding(raced.id);await resources.changeBinding(leader,scope,String(b.id),key(),{action:'assign',executorId:'2'});
    await expect(insertComposition(admin,{...item,planId:raced.planId},tx,'1')).rejects.toThrow('归属刚发生变化');
  } finally {await tx.rollback();tx.release();}
  expect((await binding(raced.id)).used_at).toBeNull();
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
