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
  await resources.synchronizeKeywords(scope, item.planId);
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
  const {ModuleRuntime}=await import('../../src/core/module-runtime');
  const {zhihuManifest}=await import('../../src/modules/zhihu/manifest');
  const runtime=new ModuleRuntime([zhihuManifest]);
  runtime.register({manifest:zhihuManifest,router:express.Router(),dataProvider:{keywordBindings:(await import('../../src/modules/zhihu/attribution/keyword-exports')).keywordBindings,...(await import('../../src/modules/zhihu/attribution/provider')).attributionDataProvider,workRegistrations:(await import('../../src/modules/zhihu/attribution/works')).workRegistrations}});
  app = express()
    .use(express.json())
    .use('/core/activity',(req,_res,next)=>{req.user=actor;next();},(await import('../../src/core/activity-routes')).createActivityRouter(runtime))
    .use('/core/work-registrations',(req,_res,next)=>{req.user=actor;next();},(await import('../../src/core/work-registration-routes')).createWorkRegistrationRouter(runtime))
    .use('/core/keyword-bindings',(req,_res,next)=>{req.user=actor;next();},(await import('../../src/core/work-registration-routes')).createKeywordBindingRouter(runtime))
    .use('/compositions', compositionsRouter)
    .use('/activity', (await import('../../src/modules/zhihu/routes/attribution')).attributionRouter)
    .use('/plans', plansRouter)
    .use(errorHandler);
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

const period = { from: '2026-10-01', to: '2026-10-03' };
let activity: typeof import('../../src/modules/zhihu/attribution/works'),
  ids: string[] = [],
  word: any;
beforeAll(async () => {
  activity = await import('../../src/modules/zhihu/attribution/works');
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(6,'zero','unused','creator','零作品成员',2)",
  );
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,6)');
  for (const [executor, status, date] of [
    [team, 'synced', '2026-10-01 00:00:00'],
    [team, 'failed', '2026-10-03 23:59:59'],
    [team, 'local', '2026-10-02 12:00:00'],
    [leader, 'synced', '2026-10-02 12:00:00'],
    [direct, 'synced', '2026-10-02 12:00:00'],
    [other, 'synced', '2026-10-02 12:00:00'],
    [team, 'synced', '2026-09-30 23:59:59'],
    [team, 'synced', '2026-10-04 00:00:00'],
  ] as const) {
    const k = await keyword(executor);
    const saved = await works.createComposition(executor, input(k.planId));
    ids.push(saved.id);
    await c.query('UPDATE compositions SET created_at=?,sync_status=? WHERE id=?', [date, status, saved.id]);
    if (ids.length === 1) word = k;
  }
}, 90000);
it('self/team counts distinguish failures and use inclusive China-date boundaries', async () => {
  const own = await activity.workActivity(team, scope, { ...period, view: 'self' }, 1, 25);
  expect(own.summary).toBeNull();
  expect(own.list.every(row => !('registered' in row) && !('submitted' in row))).toBe(true);
  expect((await activity.workActivity(admin, scope, { ...period, ownerId: team.sub }, 1, 25)).summary).toEqual({ registered: 3, submitted: 1, failed: 1, pending: 1 });
  expect((await activity.workActivity(leader, scope, { ...period, view: 'self' }, 1, 25)).summary).toBeNull();
  const group = await activity.workActivity(leader, scope, { ...period, view: 'team' }, 1, 25);
  expect(group.summary).toEqual(own.summary);
  expect(group.list.map((x) => String(x.id))).toEqual(['3', '6']);
  expect(group.list[1]).not.toHaveProperty('registered');
});
it('project totals equal member totals and result/member drilldown totals', async () => {
  const all = await activity.workActivity(admin, scope, { ...period, view: 'all' }, 1, 25);
  expect(all.summary).toEqual({ registered: 6, submitted: 4, failed: 1, pending: 1 });
  expect(all.list.reduce((s, r) => s + Number(r.registered), 0)).toBe(6);
  for (const m of all.list)
    expect(
      (await activity.listWorks(admin, scope, 1, 25, { ...period, registeredOnly: true, ownerId: String(m.id) })).total,
    ).toBe(m.registered);
  for (const result of ['submitted', 'failed', 'pending'] as const)
    expect((await activity.listWorks(admin, scope, 1, 25, { ...period, registeredOnly: true, result })).total).toBe(
      all.summary![result],
    );
});
it('pagination preserves totals and produces distinct records', async () => {
  const a = await activity.workActivity(admin, scope, { ...period, view: 'all' }, 1, 2),
    b = await activity.workActivity(admin, scope, { ...period, view: 'all' }, 2, 2);
  expect(a.total).toBe(5);
  expect(a.summary).toEqual(b.summary);
  expect(new Set([...a.list, ...b.list].map((x) => x.id)).size).toBe(4);
  const first = await activity.listWorks(team, scope, 1, 2, { ...period, registeredOnly: true }),
    next = await activity.listWorks(team, scope, 2, 2, { ...period, registeredOnly: true });
  expect(first.total).toBe(3);
  expect(new Set([...first.list, ...next.list].map((x) => x.composition_id)).size).toBe(3);
});
it('forged filters cannot expand role visibility', async () => {
  expect((await activity.workActivity(team, scope, { ...period, view: 'all' }, 1, 25)).summary).toBeNull();
  expect((await activity.workActivity(leader, scope, { ...period, ownerId: '4' }, 1, 25)).list).toEqual([]);
  expect((await activity.listWorks(team, scope, 1, 25, { ownerId: '4' })).total).toBe(0);
  for (const actor of [team, leader])
    await expect(activity.workDetail(actor, scope, 'composition:' + ids[4])).rejects.toMatchObject({ httpStatus: 404 });
});
it('details expose complete context but finance staff cannot edit', async () => {
  const detail = await activity.workDetail(leader, scope, 'composition:' + ids[0]);
  expect(detail.executor_name).toBe('团队达人');
  expect(detail.task_name).toBe('任务');
  expect(detail.composition_type).toBe(1);
  expect(detail.release_time).toBeTruthy();
  expect(detail.can_edit).toBe(true);
  expect((await activity.workDetail({ ...admin, adminDuty: 'finance' }, scope, 'composition:' + ids[0])).can_edit).toBe(
    false,
  );
});
it('wrong project/account and unknown record are denied', async () => {
  await expect(
    activity.workDetail(admin, { ...scope, projectId: '999' }, 'composition:' + ids[0]),
  ).rejects.toMatchObject({ httpStatus: 403 });
  await expect(activity.workActivity(admin, { ...scope, accountId: '999' }, period, 1, 25)).rejects.toMatchObject({
    httpStatus: 403,
  });
  await expect(activity.workDetail(admin, scope, 'composition:999999')).rejects.toMatchObject({ httpStatus: 404 });
});
it('duplicate linked evidence never inflates workload', async () => {
  const [[comp]] = await c.query<RowDataPacket[]>('SELECT promo_url FROM compositions WHERE id=?', [ids[0]]);
  for (let n = 0; n < 2; n++)
    await c.query(
      "INSERT INTO zh_evidence(binding_id,work_url,description,status,submitted_by) VALUES(?,?,?,'pending',?)",
      [word.bindingId, comp.promo_url, '历史凭据', '3'],
    );
  const data = await activity.listWorks(team, scope, 1, 25, { ...period, registeredOnly: true });
  expect(data.total).toBe(3);
  expect(data.list.filter((x) => String(x.composition_id) === ids[0])).toHaveLength(1);
  expect((await activity.workActivity(admin, scope, { ...period, ownerId: team.sub }, 1, 25)).summary!.registered).toBe(3);
  expect(String((await activity.workDetail(team, scope, 'composition:' + ids[0])).composition_id)).toBe(ids[0]);
});
it('editing and retrying do not increment registered count', async () => {
  const before = await activity.workActivity(admin, scope, { ...period, ownerId: team.sub }, 1, 25);
  await c.query("UPDATE compositions SET sync_status='synced',updated_at=NOW(),title='已修正' WHERE id=?", [ids[1]]);
  const after = await activity.workActivity(admin, scope, { ...period, ownerId: team.sub }, 1, 25);
  expect(after.summary!.registered).toBe(before.summary!.registered);
  expect(after.summary!.failed).toBe(0);
  expect(after.summary!.submitted).toBe(2);
});
it('routes reject invalid dates, reversed range and malformed identifiers', async () => {
  actor = admin;
  for (const q of [{ from: '2026-02-30' }, { from: '2026-10-03', to: '2026-10-01' }, { ownerId: 'bad' }])
    expect(
      (
        await request(app)
          .get('/activity/workbench/work-activity')
          .query({ ...scope, ...q })
      ).status,
    ).toBe(422);
  expect(
    (
      await request(app)
        .get('/activity/workbench/work-detail')
        .query({ ...scope, id: '../1' })
    ).status,
  ).toBe(422);
  const good = await request(app)
    .get('/activity/workbench/work-activity')
    .query({ ...scope, ...period, view: 'self' });
  expect(good.status, JSON.stringify(good.body)).toBe(200);
});

it('report activity isolates roles, keeps both metrics and totals before pagination, without amounts',async()=>{
  const insert=async(sql:string,values:unknown[])=>{
    const [r]=await c.query<import('mysql2/promise').ResultSetHeader>(sql,values);return String(r.insertId);
  };
  const batch=await insert(`INSERT INTO zh_import_batches(account_id,project_id,file_name,file_sha256,file_bytes,report_kind,template_version,preview_hash,created_by)
    VALUES(?,1,'isolated-metrics',?,?,'combined','test',?,1)`,[scope.accountId,'b'.repeat(64),Buffer.from('test'),'c'.repeat(64)]);
  const mine=await keyword(team),own=await keyword(leader),foreign=await keyword(direct);
  let line=0;
  for(const [k,type,n] of [[mine,'new_user','3'],[mine,'activation','5'],[own,'new_user','7'],[foreign,'activation','9']] as const){
    const source=await insert("INSERT INTO zh_import_rows(batch_id,line_number,normalized_json,raw_json) VALUES(?,?,?,?)",[batch,++line,'{}','{}']);
    const fact=await insert("INSERT INTO zh_metric_facts(account_id,project_id,channel_mapping_id,keyword_id,business_date,metric_type) VALUES(?,1,?,?,'2026-10-02',?)",[scope.accountId,mappingId,k.id,type]);
    const revision=await insert("INSERT INTO zh_metric_revisions(fact_id,source_row_id,snapshot_json,status) VALUES(?,?,?,'accepted')",[fact,source,JSON.stringify(type==='activation'?{activations:n,settlementAmount:'999'}:{orders:n,revenue:'999'})]);
    await c.query('UPDATE zh_metric_facts SET current_revision_id=? WHERE id=?',[revision,fact]);
    const oldSource=await insert("INSERT INTO zh_import_rows(batch_id,line_number,normalized_json,raw_json) VALUES(?,?,?,?)",[batch,++line,'{}','{}']);
    await insert("INSERT INTO zh_metric_revisions(fact_id,source_row_id,snapshot_json,status) VALUES(?,?,?,'accepted')",[fact,oldSource,JSON.stringify({orders:'999',activations:'999'})]);
  }
  const get=(extra:Record<string,unknown>={})=>request(app).get('/core/activity').query({...scope,...period,moduleId:'zhihu',view:'self',...extra});
  actor=team;const self=await get({view:'all',pageSize:1});expect(self.status,JSON.stringify(self.body)).toBe(200);
  expect(self.body.data.total).toBe(2);expect(self.body.data.list).toHaveLength(1);
  expect(self.body.data.metrics.map((m:any)=>[m.key,m.value]).sort()).toEqual([['activation','5'],['new_user','3']]);
  expect(JSON.stringify(self.body)).not.toMatch(/amount|price|revenue|settlement/i);
  expect((await get({ownerId:direct.sub})).body.data.total).toBe(0);
  actor=leader;expect((await get({view:'team'})).body.data.total).toBe(2);expect((await get()).body.data.total).toBe(1);
  for(const duty of ['operations','finance','all'] as const){actor={...admin,adminDuty:duty};const all=await get({view:'all'});expect(all.body.data.total).toBe(4);expect(JSON.stringify(all.body)).not.toMatch(/amount|price|revenue|settlement/i);}
  actor=direct;expect((await get()).body.data.metrics[0].value).toBe('9');
  actor=other;expect((await get()).body.data.status).toBe('empty');
  actor=team;expect((await get({accountId:'999'})).status).toBe(403);expect((await get({projectId:'999'})).status).toBe(403);
  expect((await get({from:'2026-10-04',to:'2026-10-01'})).status).toBe(422);
  expect((await get({metricType:'price'})).status).toBe(422);
  expect((await get({metricType:'activation',from:'2026-10-02',to:'2026-10-02'})).body.data.total).toBe(1);
  expect((await get({from:'2026-10-03',to:'2026-10-03'})).body.data.total).toBe(0);
});

describe('successful daily registrations and Excel export',()=>{
 const dates={from:'2026-10-10',to:'2026-10-12'},goodIds:string[]=[];
 const longUrl='https://example.com/complete?source='+ 'x'.repeat(300)+'&mst=keep-the-entire-tail';
 let retryId='',group:any;
 beforeAll(async()=>{
  group=await keyword(team);
  const save=async(owner:AuthUser,k:any,at:string,patch:Record<string,unknown>={})=>{
   const item=await works.createComposition(owner,{...input(k.planId),promoUrl:goodIds.length===0?longUrl:input(k.planId).promoUrl});
   const fields={created_at:at,sync_status:'synced',zhihu_composition_id:'receipt-'+item.id,...patch};
   await c.query(`UPDATE compositions SET ${Object.keys(fields).map(key=>key+'=?').join(',')} WHERE id=?`,[...Object.values(fields),item.id]);return item.id;
  };
  for(let n=0;n<28;n++)goodIds.push(await save(team,group,n===0?'2026-10-10 00:00:00':'2026-10-12 23:59:59',n===0?{title:'=SUM(1,2)',media_account:'00123456789012345678'}:{}));
  // Duplicate evidence must not inflate successful registrations.
  for(let n=0;n<2;n++)await c.query("INSERT INTO zh_evidence(binding_id,work_url,description,status,submitted_by) VALUES(?,?,?,'pending',?)",[group.bindingId,longUrl,'重复凭据',team.sub]);
  for(const patch of [
   {sync_status:'failed'},{sync_status:'local'},{sync_status:'syncing'},{status:'ended'},
   {status:'rejected'},{reject_reason:'退回'},{zhihu_composition_id:null},
   {zhihu_status_json:JSON.stringify({auditStatus:'rejected'})},
   {zhihu_status_json:JSON.stringify({status:'failed'})},
   {zhihu_status_json:JSON.stringify({rejectReason:'未通过'})},
  ]){const id=await save(team,group,'2026-10-10 12:00:00',patch);if(patch.sync_status==='failed')retryId=id;}
  const rejected=await save(team,group,'2026-10-10 12:00:00');
  const [[row]]=await c.query<RowDataPacket[]>('SELECT promo_url FROM compositions WHERE id=?',[rejected]);
  await c.query("INSERT INTO zh_evidence(binding_id,work_url,description,status,submitted_by) VALUES(?,?,?,'rejected',?)",[group.bindingId,row.promo_url,'核验不通过',team.sub]);
  const failedPlan=await keyword(team);await save(team,failedPlan,'2026-10-10 12:00:00');await c.query("UPDATE plans SET sync_status='failed' WHERE id=?",[failedPlan.planId]);
  const disputed=await keyword(team),disputedId=await save(team,disputed,'2026-10-10 12:00:00');
  await c.query("UPDATE zh_keyword_bindings SET verification_status='disputed' WHERE id=?",[disputed.bindingId]);
  const [[disputedWork]]=await c.query<RowDataPacket[]>('SELECT promo_url FROM compositions WHERE id=?',[disputedId]);
  await c.query("INSERT INTO zh_evidence(binding_id,work_url,description,status,submitted_by) VALUES(?,?,?,'pending',?)",[disputed.bindingId,disputedWork.promo_url,'归属争议',team.sub]);
  await save(team,group,'2026-10-09 23:59:59');await save(team,group,'2026-10-13 00:00:00');
  await save(leader,await keyword(leader),'2026-10-10 12:00:00');await save(direct,await keyword(direct),'2026-10-10 12:00:00');
 },90000);
 const get=(extra:Record<string,unknown>={},suffix='')=>request(app).get('/core/work-registrations'+suffix).query({...scope,...dates,moduleId:'zhihu',ownerId:team.sub,successfulOnly:'1',...extra});
 const excel=(extra:Record<string,unknown>={})=>get(extra,'/export').buffer(true).parse((res,done)=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>done(null,Buffer.concat(chunks)));res.on('error',done);});
 it('uses receipt validity and China registration dates consistently; exports every page and intact text links',async()=>{
  actor=admin;const summary=await get();expect(summary.status,JSON.stringify(summary.body)).toBe(200);expect(summary.body.data.total).toBe(28);
  expect(summary.body.data.daily).toEqual([{date:'2026-10-12',count:27},{date:'2026-10-11',count:0},{date:'2026-10-10',count:1}]);
  const list=await request(app).get('/activity/workbench/works').query({...scope,...dates,ownerId:team.sub,successfulOnly:'1',pageSize:25});expect(list.body.data.total).toBe(28);expect(list.body.data.list).toHaveLength(25);
  const exported=await excel();expect(exported.status).toBe(200);expect(exported.headers['content-type']).toContain('spreadsheetml.sheet');
  const workbook=XLSX.read(exported.body,{type:'buffer'});expect(workbook.SheetNames).toEqual(['每日汇总','作品明细']);
  const sheet=workbook.Sheets['作品明细'],rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet);expect(rows).toHaveLength(28);expect(rows.every(row=>row['登记状态']==='成功登记')).toBe(true);
  const line=rows.findIndex(row=>row['回传链接']===longUrl)+2;expect(line).toBeGreaterThan(1);
  // xlsx 0.18 reads relationship targets without decoding XML entities; Excel decodes &amp; correctly.
  expect(sheet['G'+line].l?.Target).toBe(longUrl.replace(/&/g,'&amp;'));expect(sheet['C'+line].t).toBe('s');expect(sheet['C'+line].f).toBeUndefined();expect(sheet['F'+line].v).toBe('00123456789012345678');
  expect((await get({search:'keep-the-entire-tail'})).body.data.total).toBe(1);
  expect((await get({from:'2026-10-11',to:'2026-10-11'})).body.data.daily).toEqual([{date:'2026-10-11',count:0}]);
 });
 it('preserves management-only statistics and rejects cross-project downloads',async()=>{
  for(const member of [team,leader,direct,user('1','operator')]){actor=member;for(const suffix of ['','/export'])expect((await get({},suffix)).status).toBe(403);await expect(activity.workRegistrations(scope,actor,{...dates,successfulOnly:true},false)).rejects.toMatchObject({httpStatus:403});}
  actor=admin;const empty=XLSX.read((await excel({ownerId:'6'})).body,{type:'buffer'});expect(XLSX.utils.sheet_to_json(empty.Sheets['作品明细'])).toEqual([]);
  for(const adminDuty of ['all','finance','operations'] as const){actor={...admin,adminDuty};expect((await get({ownerId:undefined})).body.data.total).toBe(30);}
  actor={...admin,role:'developer'};expect((await get({ownerId:undefined})).body.data.total).toBe(30);
  for(const suffix of ['','/export']){actor=admin;expect((await get({projectId:'999'},suffix)).status).toBe(403);expect((await get({accountId:'999'},suffix)).status).toBe(403);expect((await get({from:'2026-02-30'},suffix)).status).toBe(422);expect((await get({from:'2026-10-13'},suffix)).status).toBe(422);}
 });
 it('successful retries retain original registration date and do not duplicate a record',async()=>{
  actor=admin;await c.query("UPDATE compositions SET sync_status='synced',updated_at=NOW() WHERE id=?",[retryId]);
  expect((await get()).body.data.total).toBe(29);expect((await get({from:'2026-10-10',to:'2026-10-10'})).body.data.total).toBe(2);
  await c.query("UPDATE compositions SET title='再次编辑',updated_at=NOW() WHERE id=?",[retryId]);expect((await get()).body.data.total).toBe(29);
 });
});

 describe('keyword work drilldown',()=>{it('filters a specific plan before paging and cannot expose another creator works',async()=>{
  const mine=await keyword(team),someone=await keyword(direct);
  await works.createComposition(team,input(mine.planId));await works.createComposition(direct,input(someone.planId));
  actor=team;
  const own=await request(app).get('/activity/workbench/works').query({...scope,planId:mine.planId});
  expect(own.status).toBe(200);expect(own.body.data.total).toBe(1);expect(own.body.data.list[0].planId).toBe(mine.planId);
  const other=await request(app).get('/activity/workbench/works').query({...scope,planId:someone.planId});
  expect(other.status).toBe(200);expect(other.body.data.total).toBe(0);
  const cross=await request(app).get('/activity/workbench/works').query({...scope,projectId:'999',planId:mine.planId});expect(cross.status).toBe(403);
 });});


describe('keyword assignments and complete callback exports',()=>{
 const dates={from:'2026-11-20',to:'2026-11-22'};
 let first:any,failed:any,unassigned:any,workId='',failedWorkId='';
 const novelUrl='https://example.com/novel?text='+'x'.repeat(300)+'&mst=novel-tail';
 const excel=async(path:string,extra:Record<string,unknown>={})=>request(app).get('/core/'+path+'/export').query({...scope,moduleId:'zhihu',...dates,...extra}).buffer(true).parse((res,done)=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>done(null,Buffer.concat(chunks)));res.on('error',done);});
 const rows=(response:any,sheet:string)=>XLSX.utils.sheet_to_json<Record<string,string>>(XLSX.read(response.body,{type:'buffer'}).Sheets[sheet]);
 beforeAll(async()=>{
  first=await keyword(team);
  await c.query("UPDATE plans SET created_by=3,created_at='2026-11-01',name='推广计划甲',novel_title='原著甲',novel_url=? WHERE id=?",[novelUrl,first.planId]);
  await c.query('UPDATE zh_keywords SET created_by=3 WHERE id=?',[first.id]);
  await c.query("UPDATE zh_keyword_bindings SET claimed_at='2026-11-19',assigned_at='2026-11-20 00:00:00' WHERE id=?",[first.bindingId]);
  workId=(await works.createComposition(team,{...input(first.planId),compositionType:2,compositionSubType:8})).id;
  failedWorkId=(await works.createComposition(team,input(first.planId))).id;
  await c.query("UPDATE compositions SET created_at='2026-11-22 23:59:59',sync_status='synced',zhihu_composition_id=CONCAT('receipt-',id) WHERE id=?",[workId]);
  await c.query("UPDATE compositions SET created_at='2026-11-20 00:00:00',sync_status='failed',sync_error='invalid url' WHERE id=?",[failedWorkId]);
  failed=await keyword(direct);
  await c.query("UPDATE plans SET created_at='2026-11-02',sync_status='failed',sync_error='invalid URL' WHERE id=?",[failed.planId]);
  await c.query("UPDATE zh_keyword_bindings SET claimed_at='2026-11-22 23:59:59',assigned_at='2026-11-22 23:59:59' WHERE id=?",[failed.bindingId]);
  unassigned=await keyword();
  await c.query("UPDATE plans SET created_at='2026-11-21',sync_status='failed',sync_error='invalid URL' WHERE id=?",[unassigned.planId]);
  await c.query("UPDATE zh_keywords SET lifecycle_status='archived' WHERE id=?",[unassigned.id]);
  const outside=await keyword(team);
  await c.query("UPDATE plans SET created_at='2026-11-21' WHERE id=?",[outside.planId]);
  await c.query("UPDATE zh_keyword_bindings SET claimed_at='2026-11-23',assigned_at='2026-11-23' WHERE id=?",[outside.bindingId]);
 });
 it('filters assignment date rather than creation and retains archived failures without an assignment',async()=>{
  actor=admin;const response=await excel('keyword-bindings');expect(response.status).toBe(200);
  const data=rows(response,'关键词绑定明细');expect(data).toHaveLength(3);
  const assigned=data.find(r=>r['关键词计划编号']===first.planId)!;
  expect(assigned).toMatchObject({'绑定时间（北京时间）':'2026-11-20 00:00:00','创建时间（北京时间）':'2026-11-01 00:00:00','创建账号':'team','创建人ID':'timo000003','创建人使用该词时的团长':'团长','本次归属团长':'团长','原著书名':'原著甲','原著链接':novelUrl,'推广活动':'任务','渠道':'渠道'});
  expect(data.filter(r=>r['创建状态']==='创建失败')).toHaveLength(2);
  expect(data.find(r=>r['关键词计划编号']===unassigned.planId)).toMatchObject({'日期收录依据':'未分配，按创建日期收录失败记录','绑定时间（北京时间）':''});
  expect(rows(await excel('keyword-bindings',{from:'2026-11-20',to:'2026-11-20'}),'关键词绑定明细')).toHaveLength(1);
  expect(rows(await excel('keyword-bindings',{from:'2026-12-01',to:'2026-12-01'}),'关键词绑定明细')).toHaveLength(0);
 });
 it('includes failures by default and exports classifications, original novel, account and recorded team',async()=>{
  actor=admin;const response=await excel('work-registrations');expect(response.status,JSON.stringify(response.body)).toBe(200);
  const data=rows(response,'作品明细');expect(data).toHaveLength(2);
  expect(data.find(r=>r['作品编号']===workId)).toMatchObject({'推广计划名称':'推广计划甲','作品分类':'视频','作品子分类':'漫剧','原著小说名':'原著甲','原著链接':novelUrl,'提交账号':'team','提交人ID':'timo000003','团长名':'团长','团长ID':'timo000002'});
  expect(data.find(r=>r['作品编号']===failedWorkId)?.['登记状态']).toBe('提交失败');
  expect(rows(await excel('work-registrations',{successfulOnly:'1'}),'作品明细')).toHaveLength(1);
  // A later user/team change cannot rewrite the team attached to these historical callbacks.
  await c.query('UPDATE users SET parent_id=NULL WHERE id=3');
  try {expect(rows(await excel('work-registrations'),'作品明细').every(r=>r['团长名']==='团长')).toBe(true);}
  finally {await c.query('UPDATE users SET parent_id=2 WHERE id=3');}
 });
 it('retains released assignments and never loses them when a keyword is reclaimed',async()=>{
  actor=admin;
  await c.query("UPDATE zh_keyword_bindings SET released_at='2026-11-23' WHERE id=?",[failed.bindingId]);
  await c.query("INSERT INTO zh_keyword_bindings(keyword_id,path_type,executor_id,relation_snapshot,claimed_at,assigned_at) VALUES(?,'direct_creator',5,'{}','2026-11-24','2026-11-24')",[failed.id]);
  const data=rows(await excel('keyword-bindings'),'关键词绑定明细');expect(data).toHaveLength(3);
  expect(data.find(r=>r['关键词计划编号']===failed.planId)?.['分配状态']).toBe('已释放');
  expect(rows(await excel('keyword-bindings',{from:'2026-11-24',to:'2026-11-24'}),'关键词绑定明细')).toHaveLength(1);
 });
 it('enforces role, scope and date validation for the new keyword download',async()=>{
  for(const member of [leader,team,direct,user('1','operator')]){actor=member;expect((await excel('keyword-bindings')).status).toBe(403);}
  for(const member of [admin,{...admin,role:'developer' as const},{...admin,adminDuty:'operations' as const}]){actor=member;expect((await excel('keyword-bindings')).status).toBe(200);}
  actor=admin;
  for(const extra of [{accountId:'999'},{projectId:'999'}])expect((await excel('keyword-bindings',extra)).status).toBe(403);
  for(const extra of [{from:'2026-11-25'},{from:'2026-02-30'},{successfulOnly:'1'}])expect((await excel('keyword-bindings',extra)).status).toBe(422);
 });
});
