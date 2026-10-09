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
let resources:typeof import('../../src/modules/zhihu/attribution/resources'),workbench:typeof import('../../src/modules/zhihu/attribution/workbench'),statements:typeof import('../../src/modules/zhihu/attribution/statements');
const key=()=>crypto.randomUUID(),scope={projectId:'1',accountId:''},headers:Record<string,Record<string,string>>={};
const user=(sub:string,role:AuthUser['role'],adminDuty:AuthUser['adminDuty']='all'):AuthUser=>({sub,role,adminDuty,parentId:null,displayName:'测试人员'+sub,username:'stafftest'+sub,jti:key()});
const admin=user('1','admin'),creator=user('2','creator'),ops=user('3','admin','operations'),finance=user('4','admin','finance'),leader=user('5','leader'),other=user('6','creator');
const q=async(sql:string,args:unknown[]=[])=> (await c.query<mysql.RowDataPacket[]>(sql,args))[0];
const file=(body:string)=>{const buffer=Buffer.from(body);return{originalname:'管理员业绩.csv',mimetype:'text/csv',buffer,size:buffer.length}};
const base='/api/v1/modules/zhihu',post=(path:string,data:object={},who=admin)=>request(app).post(base+path).set(headers[who.sub]).send({...scope,...data,requestKey:key()});
let date='',mappingId='',selfId='',selfBinding='',retroId='',ledger:mysql.RowDataPacket[],income:mysql.RowDataPacket[];
const previousActivation=process.env.ZHIHU_ACTIVATION_ENABLED;
async function readyWord(keyword:string){
 const word=await resources.createKeyword(admin,scope,key(),{keyword,taskId:'1',mappingId,landingUrl:'https://example.com/work',popularizeType:1});
 await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?",['staff-'+word.id,word.planId]);await resources.synchronizeKeywords(scope);return word;
}
const view=(who=finance)=>workbench.overview(who,scope,{from:date,to:date});
const upload=(word:string,quantity:string,type:'new_user'|'activation'='new_user')=>workbench.uploadReport(finance,scope,file(`日期,渠道名称,关键词,${type==='new_user'?'订单量':'拉活量'}\n${date},本人执行渠道,${word},${quantity}`),type);
beforeAll(async()=>{
 container=await new MySqlContainer('mysql:8.0').withCommand(['--log-bin-trust-function-creators=1']).withDatabase('staff_self_test').withUsername('test').withUserPassword('isolated').start();
 const target={host:container.getHost(),port:container.getPort(),database:container.getDatabase(),user:container.getUsername(),password:container.getUserPassword()};
 Object.assign(process.env,{DB_HOST:target.host,DB_PORT:String(target.port),DB_NAME:target.database,DB_USER:target.user,DB_PASS:target.password,OPC_MODULES:'zhihu',DEV_DEMO_AUTH:'0',ZHIHU_ACTIVATION_ENABLED:'true'});
 await runOpcMigrations(target,['zhihu']);c=await mysql.createConnection(target);
 for(const actor of [admin,creator,ops,finance,leader,other])await c.query('INSERT INTO users(id,username,password_hash,role,display_name,admin_duty) VALUES(?,?,?,?,?,?)',[actor.sub,actor.username,'unused',actor.role,actor.displayName,actor.adminDuty]);
 await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,5),(1,6)');
 scope.accountId=String((await q('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
 await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'staff-channel',1,'本人执行渠道')");
 await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'staff-task','本人执行活动',NOW())");
 resources=await import('../../src/modules/zhihu/attribution/resources');workbench=await import('../../src/modules/zhihu/attribution/workbench');statements=await import('../../src/modules/zhihu/attribution/statements');pool=(await import('../../src/db')).db;
 date=(await import('../../src/modules/zhihu/attribution/domain')).businessDay();mappingId=(await resources.createMapping(admin,scope,key(),{channelId:'1',name:'本人执行渠道',from:date})).id;
 const control=await readyWord('现金对照词'),binding=await resources.distribute(admin,scope,control.id,key(),creator.sub);await resources.changeBinding(creator,scope,binding.id,key(),{action:'activate'});await c.query("UPDATE zh_keyword_bindings SET verification_status='passed' WHERE id=?",[binding.id]);await upload('现金对照词','2');const before=await view();await workbench.confirmBills(finance,scope,{from:date,to:date},key(),before.reviewHash);
 ledger=await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id");income=await q('SELECT * FROM opc_income_entries ORDER BY id');expect(income.length).toBeGreaterThan(0);
 const {ModuleRuntime}=await import('../../src/core/module-runtime'),{zhihuManifest}=await import('../../src/modules/zhihu/manifest'),{createZhihuModule}=await import('../../src/modules/zhihu/module'),{createCoreApp}=await import('../../src/core/app');
 const runtime=new ModuleRuntime([zhihuManifest]);runtime.register(createZhihuModule());app=createCoreApp(runtime);
 const {signToken}=await import('../../src/auth/jwt'),{issueRefreshSession}=await import('../../src/auth/tokenSessions');
 for(const actor of [admin,creator,ops,finance,leader,other]){const client='staff-test-client-'+actor.sub,session=await issueRefreshSession(actor.sub,{type:'web',id:client});headers[actor.sub]={'X-Client-Id':client,Authorization:'Bearer '+await signToken({...actor,id:actor.sub,sessionId:session.familyId})};}
},90000);
afterAll(async()=>{if(previousActivation===undefined)delete process.env.ZHIHU_ACTIVATION_ENABLED;else process.env.ZHIHU_ACTIVATION_ENABLED=previousActivation;if(pool)await pool.end();if(c)await c.end();if(container)await container.stop();});

it('运营和完整管理员可本人执行，无须伪造成项目达人；岗位、范围和占用保护有效',async()=>{
 const word=await readyWord('本人执行词');selfId=word.id;
 expect((await post('/keywords/'+word.id+'/claim',{},finance)).status).toBe(403);
 expect((await post('/keywords/'+word.id+'/claim',{projectId:'999'})).status).toBe(403);
 const requestKey=key(),payload={...scope,requestKey};
 const claimed=await request(app).post(base+'/keywords/'+word.id+'/claim').set(headers[admin.sub]).send(payload);expect(claimed.status,claimed.text).toBe(200);selfBinding=claimed.body.data.id;
 expect((await request(app).post(base+'/keywords/'+word.id+'/claim').set(headers[admin.sub]).send(payload)).body.data).toEqual(claimed.body.data);
 const [binding]=await q('SELECT * FROM zh_keyword_bindings WHERE id=?',[selfBinding]);expect(binding.path_type).toBe('staff_self');expect(binding.leader_id).toBeNull();expect(String(binding.executor_id)).toBe(admin.sub);
 expect((await post('/keywords/'+word.id+'/claim',{},ops)).status).toBe(409);
 const operation=await readyWord('运营本人执行词');expect((await post('/keywords/'+operation.id+'/claim',{},ops)).status).toBe(200);
 const another=await readyWord('不能代选管理员');expect((await post('/keywords/'+another.id+'/distribute',{targetId:ops.sub})).status).toBe(403);
 expect((await resources.options(ops,scope)).users.some(u=>String(u.id)===ops.sub)).toBe(true);
});

it('拉新十元和拉活两元只记录管理员业绩，作品核验提示保留，其他成员和运营看不到金额',async()=>{
 expect((await post('/bindings/'+selfBinding+'/activate')).status).toBe(200);
 await upload('本人执行词','3');await upload('本人执行词','4','activation');
 const current=await view(),entries=current.entries.filter(e=>e.keyword==='本人执行词');
 expect(current.summary).toMatchObject({staffAmount:'38.0000',payable:'16.0000'});
 expect(current.summary.byType.new_user.staffAmount).toBe('30.0000');expect(current.summary.byType.activation.staffAmount).toBe('8.0000');
 expect(entries).toHaveLength(2);expect(entries.every(e=>e.internal&&!e.ready&&!e.ownReceivable&&e.pendingAmount==='0.0000'&&e.reasonCode==='WORK_MISSING')).toBe(true);
 expect(entries.find(e=>e.metricType==='new_user')?.calculation).toEqual({quantity:'3',unitPrice:'10.0000',beforeRiskAmount:'30.0000'});
 expect(entries[0].next).toBe('管理员 测试人员1：补登记作品');
 expect(current.groups.some(g=>g.payeeId===admin.sub)).toBe(false);
 expect((await request(app).get(base+'/workbench').set(headers[ops.sub]).query({...scope,from:date,to:date,viewVersion:2})).status).toBe(403);
 for(const who of [creator,leader,other])expect((await view(who)).entries.some(e=>e.keyword==='本人执行词')).toBe(false);
});

it('作品核验自动更新；普通确认、直接账单预览都不能产生管理员应付款或公共收入',async()=>{
 const evidence=await statements.submitEvidence(admin,scope,key(),{bindingId:selfBinding,url:'https://example.com/staff-work',description:'本人发布的作品'});await statements.reviewEvidence(ops,scope,evidence.id,key(),true,'已核实作者');
 const current=await view(),entries=current.entries.filter(e=>e.keyword==='本人执行词');expect(entries.every(e=>e.reasonCode===''&&e.status==='internal'&&!e.ready)).toBe(true);
 expect(await workbench.confirmBills(finance,scope,{from:date,to:date},key(),current.reviewHash)).toEqual({confirmed:0,waiting:0});
 for(const entry of entries)await expect(statements.previewStatement(admin,scope,key(),entry.factId)).rejects.toThrow('无权生成');
 expect(await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id")).toEqual(ledger);expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(income);
 expect(await q('SELECT * FROM zh_statement_entries WHERE payee_id=1')).toEqual([]);expect(await q('SELECT * FROM opc_income_sources WHERE source_key IN (?)',[entries.map(e=>'fact:'+e.factId)])).toEqual([]);
 expect((await request(app).post('/api/v1/core/finance/withdrawals').set(headers[admin.sub]).send({...scope,moduleId:'zhihu',requestKey:key(),amount:'1.00',receiverName:'测试收款人',bankName:'测试银行',bankAccount:'test-account'})).status).toBe(403);
 expect(await q('SELECT * FROM opc_withdrawals WHERE user_id=1')).toEqual([]);
 const detail=await request(app).get('/api/v1/core/tasks/zhihu/'+scope.accountId+'/'+selfId).set(headers[admin.sub]).query(scope);
 expect(detail.status,detail.text).toBe(200);
 const progress=detail.body.data.progress as {label:string}[];
 expect(progress.some(p=>p.label==='可提现'||p.label==='确认')).toBe(false);expect(progress.some(p=>p.label==='记入管理员业绩')).toBe(true);
});

it('报表缺执行人可指定本人，历史登记也支持本人，但不能改走别人的管理员账户',async()=>{
 const word=await readyWord('本人补录词');retroId=word.id;await upload('本人补录词','1');
 expect((await post('/keywords/'+word.id+'/assign-retro',{executorId:admin.sub},finance)).status).toBe(403);
 expect((await post('/keywords/'+word.id+'/assign-retro',{executorId:ops.sub})).status).toBe(403);
 const repaired=await post('/keywords/'+word.id+'/assign-retro',{executorId:admin.sub});expect(repaired.status,repaired.text).toBe(200);expect((await view()).entries.find(e=>e.keyword==='本人补录词')).toMatchObject({internal:true,amount:'10.0000',reasonCode:'WORK_MISSING'});
 expect((await post('/keywords/'+word.id+'/assign-retro',{executorId:creator.sub})).status).toBe(409);
 const {withTransaction}=await import('../../src/db'),{scopeLock}=await import('../../src/modules/zhihu/attribution/store'),{registerHistoricalKeyword}=await import('../../src/modules/zhihu/attribution/historical-keywords');
 const historical=await withTransaction(async connection=>{await scopeLock(connection,scope,ops);return registerHistoricalKeyword(connection,ops,scope,mappingId,{keyword:'运营历史本人词',date},{taskId:'1',executorId:ops.sub});});
 expect((await q('SELECT path_type,executor_id FROM zh_keyword_bindings WHERE id=?',[historical.bindingId]))[0]).toMatchObject({path_type:'staff_self',executor_id:Number(ops.sub)});
});

it('数据库约束拒绝不完整归属，两次重放保留旧归属、全部报表和确认资金记录',async()=>{
 const before=await q('SELECT * FROM zh_keyword_bindings ORDER BY id'),facts=await q('SELECT * FROM zh_metric_facts ORDER BY id'),results=await q('SELECT * FROM zh_attribution_results ORDER BY id');
 for(const change of ["leader_id=5","executor_id=NULL","path_type='leader_self',leader_id=NULL,executor_id=NULL","path_type='unrecognized'"]){await expect(c.query('UPDATE zh_keyword_bindings SET '+change+' WHERE id=?',[selfBinding])).rejects.toThrow();}
 const sql=await readFile('schema/zhihu/036_staff_self_bindings.sql','utf8');for(let run=0;run<2;run++)for(const statement of sql.split(/;\s*(?:\r?\n|$)/).map(s=>s.trim()).filter(Boolean))await c.query(statement);
 expect(await q('SELECT * FROM zh_keyword_bindings ORDER BY id')).toEqual(before);expect(await q('SELECT * FROM zh_metric_facts ORDER BY id')).toEqual(facts);expect(await q('SELECT * FROM zh_attribution_results ORDER BY id')).toEqual(results);expect(await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id")).toEqual(ledger);expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(income);
});

it('管理员与团长同时领取也只有一份归属，已执行记录不能释放后改给他人',async()=>{
 const word=await readyWord('并发本人执行');const results=await Promise.all([post('/keywords/'+word.id+'/claim'),post('/keywords/'+word.id+'/claim',{},leader)]);
 expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(await q('SELECT id FROM zh_keyword_bindings WHERE keyword_id=?',[word.id])).toHaveLength(1);
 expect((await post('/bindings/'+selfBinding+'/request-release',{reason:'试图重新分配'})).status).toBe(409);
 expect((await post('/keywords/'+retroId+'/assign-retro',{executorId:creator.sub})).status).toBe(409);
});
