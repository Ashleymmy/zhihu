import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {MySqlContainer,type StartedMySqlContainer} from '@testcontainers/mysql';
import mysql,{type Connection} from 'mysql2/promise';
import request from 'supertest';
import type {Express} from 'express';
import type {AuthUser} from '../../src/types';
import {runOpcMigrations} from '../../scripts/opcMigrations';
import {readFile} from 'node:fs/promises';
vi.mock('../../src/modules/zhihu/queue',async original=>({...await original<typeof import('../../src/modules/zhihu/queue')>(),enqueue:vi.fn(async()=>({id:'isolated'}))}));
let container:StartedMySqlContainer,c:Connection,pool:typeof import('../../src/db').db,app:Express;
let workbench:typeof import('../../src/modules/zhihu/attribution/workbench'),facts:typeof import('../../src/modules/zhihu/attribution/facts');
const date='2026-09-14',key=()=>crypto.randomUUID(),scope={projectId:'1',accountId:''};
const user=(sub:string,role:AuthUser['role'],duty:AuthUser['adminDuty']='all'):AuthUser=>({sub,role,adminDuty:duty,parentId:null,displayName:'人员'+sub,username:'analysis'+sub,jti:key()});
const admin=user('1','admin'),creator=user('2','creator'),ops=user('3','admin','operations'),finance=user('4','admin','finance'),leader=user('5','leader');
const headers:Record<string,Record<string,string>>={};
const q=async(sql:string,args:unknown[]=[])=> (await c.query<mysql.RowDataPacket[]>(sql,args))[0];
const file=(text:string)=>{const buffer=Buffer.from(text);return{originalname:'分析验收.csv',mimetype:'text/csv',buffer,size:buffer.length}};
let mappingId='',wordId='';
const endpoint=(id:string)=>'/api/v1/modules/zhihu/imports/'+id;
const get=(id:string,u=finance)=>request(app).get(endpoint(id)+'/analysis').set(headers[u.sub]).query(scope);
const answer=(id:string,askId:string,option:string,u=ops,selection?:unknown,requestKey:string=key())=>request(app).post(endpoint(id)+'/answers').set(headers[u.sub]).send({...scope,askId,option,selection,requestKey});
beforeAll(async()=>{
 container=await new MySqlContainer('mysql:8.0').withCommand(['--log-bin-trust-function-creators=1']).withDatabase('agency_test').withUsername('test').withUserPassword('isolated').start();
 const target={host:container.getHost(),port:container.getPort(),database:container.getDatabase(),user:container.getUsername(),password:container.getUserPassword()};
 Object.assign(process.env,{DB_HOST:target.host,DB_PORT:String(target.port),DB_NAME:target.database,DB_USER:target.user,DB_PASS:target.password,OPC_MODULES:'zhihu',DEV_DEMO_AUTH:'0',ZHIHU_ACTIVATION_ENABLED:'true'});
 await runOpcMigrations(target,['zhihu']);c=await mysql.createConnection(target);
 for(const actor of [admin,creator,ops,finance,leader])await c.query('INSERT INTO users(id,username,password_hash,role,display_name,admin_duty) VALUES(?,?,?,?,?,?)',[actor.sub,actor.username,'unused',actor.role,actor.displayName,actor.adminDuty]);
 await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,5)');
 scope.accountId=String((await q('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
 await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'analysis-channel',1,'分析渠道')");
 await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'analysis-task','分析活动',NOW())");
 const resources=await import('../../src/modules/zhihu/attribution/resources');workbench=await import('../../src/modules/zhihu/attribution/workbench');facts=await import('../../src/modules/zhihu/attribution/facts');pool=(await import('../../src/db')).db;
 const mapping=await resources.createMapping(admin,scope,key(),{channelId:'1',name:'分析渠道',from:date});
 mappingId=mapping.id; const word=await resources.createKeyword(admin,scope,key(),{keyword:'分析关键词',taskId:'1',mappingId:mapping.id,landingUrl:'https://example.com/analysis',popularizeType:1});
 await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id='analysis-plan' WHERE id=?",[word.planId]);await resources.synchronizeKeywords(scope);
 wordId=word.id; const binding=await resources.distribute(admin,scope,word.id,key(),'2');await resources.changeBinding(creator,scope,binding.id,key(),{action:'activate'});
 await c.query("UPDATE zh_keyword_bindings SET activated_on=?,verification_status='passed' WHERE id=?",[date,binding.id]);
 const {ModuleRuntime}=await import('../../src/core/module-runtime'),{zhihuManifest}=await import('../../src/modules/zhihu/manifest'),{createZhihuModule}=await import('../../src/modules/zhihu/module'),{createCoreApp}=await import('../../src/core/app');
 const runtime=new ModuleRuntime([zhihuManifest]);runtime.register(createZhihuModule());app=createCoreApp(runtime);
 const {signToken}=await import('../../src/auth/jwt'),{issueRefreshSession}=await import('../../src/auth/tokenSessions');
 for(const actor of [admin,creator,ops,finance,leader]){const client='analysis-client-'+actor.sub,session=await issueRefreshSession(actor.sub,{type:'web',id:client});headers[actor.sub]={'X-Client-Id':client,Authorization:'Bearer '+await signToken({...actor,id:actor.sub,sessionId:session.familyId})};}
},90000);

const originalActivation=process.env.ZHIHU_ACTIVATION_ENABLED;
afterAll(async()=>{if(originalActivation===undefined)delete process.env.ZHIHU_ACTIVATION_ENABLED;else process.env.ZHIHU_ACTIVATION_ENABLED=originalActivation;if(pool)await pool.end();if(c)await c.end();if(container)await container.stop();});
const url='/api/v1/modules/zhihu/project-agency';
const read=(actor=finance,query=scope)=>request(app).get(url).set(headers[actor.sub]).query(query);
const save=(name:string,expected:string|null=null,actor=finance,requestKey=key())=>request(app).post(url).set(headers[actor.sub]).send({...scope,name,expected,requestKey});
const upload=async(day:string,agency:string|null)=>(await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,拉活量,结算金额${agency!==null?',代理名称':''}\n${day},分析渠道,分析关键词,4,8${agency!==null?','+agency:''}`),'activation')).id;
const state=async(day:string)=>(await q(`SELECT f.*,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day,r.reason_code,r.snapshot_json FROM zh_metric_facts f JOIN zh_attribution_results r ON r.id=f.current_result_id WHERE f.business_date=? AND f.metric_type='activation'`,[day]))[0];
let report='',paidBefore:unknown,baseFact:unknown;
it('代理设置只允许管理人员，不泄露凭据和金额，拒绝无登录和跨项目/账号',async()=>{
 expect((await request(app).get(url).query(scope)).status).toBe(401);
 for(const actor of [creator,leader]){expect((await read(actor)).status).toBe(403);expect((await save('广州渡川',null,actor)).status).toBe(403);}
 for(const actor of [admin,ops,finance])expect((await read(actor)).body.data).toEqual({agencyName:null,reportedNames:[]});
 expect((await read(ops,{...scope,projectId:'999'})).status).toBe(403);expect((await read(ops,{...scope,accountId:'999'})).status).toBe(403);
 expect((await request(app).post(url).set(headers[ops.sub]).send({...scope,projectId:'999',name:'广州渡川',expected:null,requestKey:key()})).status).toBe(403);
 expect((await save('  ')).status).toBe(422);
});
it('填了名称但项目尚未登记的行暂停计费，同表匹配条件之外的数据与拉新照常处理',async()=>{
 await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,订单量\n${date},分析渠道,分析关键词,3`));
 const view=await workbench.overview(finance,scope,{from:date,to:date});await workbench.confirmBills(finance,scope,{from:date,to:date},key(),view.reviewHash);
 paidBefore=await q('SELECT * FROM opc_income_entries ORDER BY id');baseFact=await q("SELECT * FROM zh_metric_facts WHERE metric_type='new_user'");
 report=await upload(date,'广州渡川');await upload('2026-09-15','其他代理');await upload('2026-09-16',null);
 expect((await state(date)).reason_code).toBe('AGENCY_NOT_CONFIGURED');expect((await state(date)).snapshot_json.obligations).toEqual([]);
 expect((await state('2026-09-16')).reason_code).toBeNull();
 const run=(await get(report,ops)).body.data;expect(run.agencyCheck).toEqual({registeredName:null,rows:1,reportedNames:['广州渡川']});expect(run.steps[5].status).toBe('ask');expect(JSON.stringify(run)).not.toMatch(/unitPrice|settlement|¥/);
 const bills=await workbench.overview(finance,scope,{from:date,to:'2026-09-16'});expect(bills.entries.filter(row=>row.metricType==='activation'&&row.amount!==null)).toHaveLength(1);
 expect(bills.entries.find(row=>row.metricType==='activation'&&row.date===date)).toMatchObject({ready:false,amount:null,reasonCode:'AGENCY_NOT_CONFIGURED'});
});
it('保存项目名称即自动重算未确认拉活；不匹配行保留且可就地核对，重试幂等',async()=>{
 const k=key(),response=await save(' 广州渡川 ',null,ops,k);expect(response.status,response.text).toBe(200);expect(response.body.data).toEqual({agencyName:'广州渡川',refreshed:3});
 expect((await save(' 广州渡川 ',null,ops,k)).status).toBe(200);
 expect((await state(date)).reason_code).toBeNull();expect((await state(date)).snapshot_json.obligations[0].amount).toBe('4.8000');
 expect((await state('2026-09-15')).reason_code).toBe('AGENCY_MISMATCH');expect((await state('2026-09-15')).snapshot_json.obligations).toEqual([]);
 expect((await get(report,finance)).body.data.agencyCheck).toBeUndefined();
 const result=await request(app).get('/api/v1/modules/zhihu/exceptions').set(headers[ops.sub]).query(scope);expect(result.status).toBe(200);expect(result.body.data.list.some((row:any)=>row.reasonCode==='AGENCY_MISMATCH'&&row.next.includes('核对代理名称'))).toBe(true);
 expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(paidBefore);expect(await q("SELECT * FROM zh_metric_facts WHERE metric_type='new_user'")).toEqual(baseFact);
 expect((await save('其他代理',null)).status).toBe(409);
 expect((await read(ops)).body.data.reportedNames.sort()).toEqual(['广州渡川','其他代理'].sort());
});
it('修改名称不改已确认拉活账，旧报表无代理列兼容，代理设置隔离于账户凭据',async()=>{
 const view=await workbench.overview(finance,scope,{from:date,to:date});expect((await workbench.confirmBills(finance,scope,{from:date,to:date},key(),view.reviewHash)).confirmed).toBe(1);
 const statements=await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id"),income=await q('SELECT * FROM opc_income_entries ORDER BY id'),confirmedFact=await state(date),settings=await q('SELECT * FROM zhihu_account_settings');
 const result=await save('其他代理','广州渡川');expect(result.status,result.text).toBe(200);expect(result.body.data.refreshed).toBe(2);
 expect(await state(date)).toEqual(confirmedFact);expect((await state('2026-09-15')).reason_code).toBeNull();expect((await state('2026-09-16')).reason_code).toBeNull();
 expect(await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id")).toEqual(statements);expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(income);expect(await q('SELECT * FROM zhihu_account_settings')).toEqual(settings);
 const changed=await upload('2026-09-17','广州渡川');expect((await get(changed)).body.data.agencyCheck.registeredName).toBe('其他代理');
});
it('重算失败时名称与结果一起回滚，迁移重跑保留已设置的名称',async()=>{
 const settings=await q('SELECT * FROM zh_project_agencies'),before=await q('SELECT * FROM zh_metric_facts ORDER BY id');
 await c.query("CREATE TRIGGER agency_test_failure BEFORE INSERT ON zh_attribution_results FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated agency test failure'");
 try{expect((await save('广州渡川','其他代理')).status).toBe(500);}finally{await c.query('DROP TRIGGER agency_test_failure');}
 expect(await q('SELECT * FROM zh_project_agencies')).toEqual(settings);expect(await q('SELECT * FROM zh_metric_facts ORDER BY id')).toEqual(before);
 await c.query(await readFile('schema/zhihu/035_project_agencies.sql','utf8'));await c.query(await readFile('schema/zhihu/035_project_agencies.sql','utf8'));expect(await q('SELECT * FROM zh_project_agencies')).toEqual(settings);
});

it('同一份报表的其他代理行暂停，本项目行照常计费，全部原始行保留',async()=>{
 const id=(await workbench.uploadReport(finance,scope,file('日期,渠道,关键词,拉活量,结算金额,代理名称\n2026-09-18,分析渠道,分析关键词,4,8,广州渡川\n2026-09-19,分析渠道,分析关键词,4,8,其他代理'),'activation')).id;
 const result=(await get(id)).body.data;expect(result.agencyCheck.rows).toBe(1);expect(result.totals).toMatchObject({billableQuantity:'4',pendingQuantity:'4',confirmableAmount:'4.8000'});
 expect((await q('SELECT COUNT(*) n FROM zh_import_rows WHERE batch_id=?',[id]))[0].n).toBe(2);
 expect((await state('2026-09-18')).reason_code).toBe('AGENCY_MISMATCH');expect((await state('2026-09-19')).reason_code).toBeNull();
});
it('同数量但代理名称变化保留原值与新值，选择后才改用新的代理名称核对',async()=>{
 const before=await state('2026-09-19');const id=await upload('2026-09-19','广州渡川');expect(await state('2026-09-19')).toEqual(before);
 const result=(await get(id)).body.data,ask=result.steps[5].asks[0];expect(ask.text).toContain('代理名称：原来 其他代理，本次 广州渡川');
 expect((await answer(id,ask.id,'new',finance)).status).toBe(200);expect((await state('2026-09-19')).reason_code).toBe('AGENCY_MISMATCH');
});
