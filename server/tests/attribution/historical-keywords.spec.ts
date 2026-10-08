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
 container=await new MySqlContainer('mysql:8.0').withCommand(['--log-bin-trust-function-creators=1']).withDatabase('historical_registration_test').withUsername('test').withUserPassword('isolated').start();
 const target={host:container.getHost(),port:container.getPort(),database:container.getDatabase(),user:container.getUsername(),password:container.getUserPassword()};
 Object.assign(process.env,{DB_HOST:target.host,DB_PORT:String(target.port),DB_NAME:target.database,DB_USER:target.user,DB_PASS:target.password,OPC_MODULES:'zhihu',DEV_DEMO_AUTH:'0'});
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
const previousActivation=process.env.ZHIHU_ACTIVATION_ENABLED;
afterAll(async()=>{if(previousActivation===undefined)delete process.env.ZHIHU_ACTIVATION_ENABLED;else process.env.ZHIHU_ACTIVATION_ENABLED=previousActivation;if(pool)await pool.end();if(c)await c.end();if(container)await container.stop();});
const upload=async(keyword:string,quantity='4',day=date)=>(await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,订单量\n${day},分析渠道,${keyword},${quantity}`))).id;
const question=async(id:string)=>(await get(id,ops)).body.data.steps[2].asks[0];
const selection={taskId:'1',executorId:'2'};
let newReport='',activationReport='',savedKey='',savedAsk='';
it('历史登记是运营操作，拒绝财务、成员、无效项目人员和越界活动',async()=>{
 newReport=await upload('已投放的历史长篇');const ask=await question(newReport);savedAsk=ask.id;
 expect(ask.options).toEqual([{key:'other-keyword',label:'登记并指定执行人',disabled:false},{key:'skip',label:'暂时跳过',disabled:false}]);
 for(const actor of [finance,creator,leader])expect((await answer(newReport,ask.id,'other-keyword',actor,selection)).status).toBe(403);
 for(const input of [{...selection,executorId:'1'},{...selection,taskId:'999'},{...selection,fromDate:'2099-01-01'}])expect((await answer(newReport,ask.id,'other-keyword',ops,input)).status).toBeGreaterThanOrEqual(400);
 expect(await q("SELECT id FROM plans WHERE keyword='已投放的历史长篇'")).toHaveLength(0);
 expect(await q('SELECT * FROM opc_analysis_answers')).toHaveLength(0);
});
it('一次登记并指定归属会继续处理同词的拉新与拉活，保留原文且不推送上游',async()=>{
 process.env.ZHIHU_ACTIVATION_ENABLED='true';
 activationReport=(await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,拉活量,结算金额\n${date},分析渠道,已投放的历史长篇,5,10`),'activation')).id;
 const raw=await q('SELECT id,normalized_json,raw_json FROM zh_import_rows WHERE batch_id IN (?,?) ORDER BY id',[newReport,activationReport]);
 const {enqueue}=await import('../../src/modules/zhihu/queue');vi.mocked(enqueue).mockClear();savedKey=key();
 const response=await answer(newReport,savedAsk,'other-keyword',ops,selection,savedKey);expect(response.status,response.text).toBe(200);
 expect(response.body.data.steps[2].status).toBe('done');expect(response.body.data.steps[3].status).toBe('done');expect(response.body.data.steps[4].status).toBe('ask');
 expect(JSON.stringify(response.body.data)).not.toMatch(/¥|billableAmount|unitPrice|revenue|settlement/);
 const [plan]=await q("SELECT p.*,b.executor_id,b.leader_id,DATE_FORMAT(b.activated_on,'%Y-%m-%d') from_day FROM plans p JOIN zh_keywords k ON k.plan_id=p.id JOIN zh_keyword_bindings b ON b.id=k.current_binding_id WHERE p.keyword='已投放的历史长篇'");
 expect(plan).toMatchObject({sync_status:'historical',zhihu_plan_id:null,owner_id:2,executor_id:2,leader_id:null,from_day:date});
 expect((await get(newReport)).body.data.totals.billableAmount).toBe('32.0000');expect((await get(activationReport)).body.data.totals.billableAmount).toBe('6.0000');
 expect(await q('SELECT id,normalized_json,raw_json FROM zh_import_rows WHERE batch_id IN (?,?) ORDER BY id',[newReport,activationReport])).toEqual(raw);
 expect(vi.mocked(enqueue).mock.calls.some(call=>call[0]==='push-plan')).toBe(false);
 const {pushPlan}=await import('../../src/modules/zhihu/jobs/pushPlan');await pushPlan({planId:String(plan.id),...scope});
 const {recoverImports}=await import('../../src/modules/zhihu/attribution/worker');await recoverImports();
 expect(vi.mocked(enqueue).mock.calls.some(call=>call[0]==='push-plan')).toBe(false);
 expect(await q('SELECT sync_status,zhihu_plan_id FROM plans WHERE id=?',[plan.id])).toEqual([{sync_status:'historical',zhihu_plan_id:null}]);
});
it('重复提交使用同一结果，登记后的新请求不能再次创建；作品待核验时不能确认款项',async()=>{
 const before=await q("SELECT * FROM plans WHERE keyword='已投放的历史长篇'");
 const replay=await answer(newReport,savedAsk,'other-keyword',ops,selection,savedKey);expect(replay.status).toBe(200);
 expect((await answer(newReport,savedAsk,'other-keyword',ops,selection)).status).toBe(409);
 expect(await q("SELECT * FROM plans WHERE keyword='已投放的历史长篇'")).toEqual(before);
 const view=await workbench.overview(finance,scope,{from:date,to:date});expect(view.entries.filter(item=>item.keyword==='已投放的历史长篇').every(item=>!item.ready&&item.reason==='还没有登记作品')).toBe(true);
 expect((await get(newReport)).body.data.totals.confirmableAmount).toBe('0.0000');
});
it('团队达人登记保留真实团长，只按既定角色规则产生分成',async()=>{
 await c.query('UPDATE users SET parent_id=5 WHERE id=2');
 try{
   const id=await upload('团队旧日关键词'),ask=await question(id),response=await answer(id,ask.id,'other-keyword',ops,selection);expect(response.status,response.text).toBe(200);
   const [binding]=await q("SELECT b.path_type,b.leader_id,b.executor_id FROM zh_keyword_bindings b JOIN zh_keywords k ON k.id=b.keyword_id WHERE k.keyword='团队旧日关键词'");
   expect(binding).toEqual({path_type:'team_creator',leader_id:5,executor_id:2});expect((await get(id)).body.data.totals.billableAmount).toBe('34.0000');
 }finally{await c.query('UPDATE users SET parent_id=NULL WHERE id=2');}
});
it('已成功创建的旧计划可以登记，保留真实编号、原归属和全部旧计划字段',async()=>{
 const [result]=await c.query<mysql.ResultSetHeader>("INSERT INTO plans(project_id,zhihu_plan_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by,status,sync_status) VALUES(1,'real-existing','analysis-task','analysis-channel','原来的成功计划','https://example.com/old',1,2,1,'active','synced')");
 const before=await q('SELECT * FROM plans WHERE id=?',[result.insertId]),id=await upload('原来的成功计划'),ask=await question(id);
 const response=await answer(id,ask.id,'other-keyword',ops,selection);expect(response.status,response.text).toBe(200);
 expect(await q('SELECT * FROM plans WHERE id=?',[result.insertId])).toEqual(before);
 expect(await q('SELECT plan_id,legacy_mode FROM zh_keywords WHERE plan_id=?',[result.insertId])).toEqual([{plan_id:result.insertId,legacy_mode:'historical_registered'}]);
});
it('同名其他人的旧计划和仍在提交的记录不能覆盖',async()=>{
 for(const [word,owner,status,upstream] of [['他人的成功计划',5,'synced','owned-by-another'],['尚待提交的计划',2,'local',null]] as const){
   const [result]=await c.query<mysql.ResultSetHeader>("INSERT INTO plans(project_id,zhihu_plan_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by,status,sync_status) VALUES(1,?,'analysis-task','analysis-channel',?,'https://example.com/original',1,?,1,'active',?)",[upstream,word,owner,status]);
   const before=await q('SELECT * FROM plans WHERE id=?',[result.insertId]),id=await upload(word),ask=await question(id);
   expect((await answer(id,ask.id,'other-keyword',ops,selection)).status).toBe(409);expect(await q('SELECT * FROM plans WHERE id=?',[result.insertId])).toEqual(before);
   expect(await q('SELECT id FROM zh_keywords WHERE plan_id=?',[result.insertId])).toHaveLength(0);
 }
});
it('自动重算失败时历史计划、执行人和选择一起回滚',async()=>{
 const id=await upload('事务失败历史关键词'),ask=await question(id),before=await q('SELECT * FROM zh_import_rows WHERE batch_id=?',[id]);
 await c.query("CREATE TRIGGER reject_history_fact BEFORE INSERT ON zh_metric_facts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated history rollback'");
 try{expect((await answer(id,ask.id,'other-keyword',ops,selection)).status).toBe(500);}finally{await c.query('DROP TRIGGER reject_history_fact');}
 expect(await q("SELECT id FROM plans WHERE keyword='事务失败历史关键词'")).toHaveLength(0);expect(await q("SELECT id FROM zh_keywords WHERE keyword='事务失败历史关键词'")).toHaveLength(0);
 expect(await q('SELECT * FROM zh_import_rows WHERE batch_id=?',[id])).toEqual(before);expect(await q('SELECT * FROM opc_analysis_answers WHERE ask_key=?',[ask.id])).toHaveLength(0);
});
it('两个报表同时登记同词只创建一次，来源冲突仍留给财务选择',async()=>{
 const one=await upload('并发历史词','4'),two=await upload('并发历史词','5'),a=await question(one),b=await question(two);
 const responses=await Promise.all([answer(one,a.id,'other-keyword',ops,selection),answer(two,b.id,'other-keyword',ops,selection)]);
 expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
 expect(await q("SELECT id FROM plans WHERE keyword='并发历史词'")).toHaveLength(1);
 expect(await q("SELECT f.id FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id WHERE k.keyword='并发历史词'")).toHaveLength(1);
 expect(await q("SELECT v.id FROM zh_metric_revisions v JOIN zh_metric_facts f ON f.id=v.fact_id JOIN zh_keywords k ON k.id=f.keyword_id WHERE k.keyword='并发历史词' AND v.status='pending'")).toHaveLength(1);
});
it('重复执行历史状态迁移不改变计划、资金、报表原文或已登记归属',async()=>{
 const tables=['plans','zh_keywords','zh_keyword_bindings','zh_import_rows','zh_statement_entries','opc_income_entries'];
 const before=await Promise.all(tables.map(table=>q('SELECT * FROM '+table+' ORDER BY id')));
 const migration=await readFile('schema/zhihu/033_historical_keywords.sql','utf8');await c.query(migration);await c.query(migration);
 expect(await Promise.all(tables.map(table=>q('SELECT * FROM '+table+' ORDER BY id')))).toEqual(before);
});
