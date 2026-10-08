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
 container=await new MySqlContainer('mysql:8.0').withCommand(['--log-bin-trust-function-creators=1']).withDatabase('risk_review_test').withUsername('test').withUserPassword('isolated').start();
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
const riskUpload=async(word:string,quantity='4',risk='上游待核实')=>(await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,订单量,风险判定\n${date},分析渠道,${word},${quantity},${risk}`))).id;
const state=async(word='分析关键词')=>(await q(`SELECT f.*,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day,r.reason_code,r.snapshot_json FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id JOIN zh_attribution_results r ON r.id=f.current_result_id WHERE k.keyword=? AND f.metric_type='new_user'`,[word]))[0];
const review=(fact:Record<string,unknown>,decision='accepted',actor=ops,reason='已核对上游记录',requestKey:string=key())=>request(app).post('/api/v1/modules/zhihu/attributions/'+fact.id+'/risk-review').set(headers[actor.sub]).send({...scope,expectedRevisionId:String(fact.current_revision_id),decision,reason,requestKey});
async function readyWord(word:string){
 const resources=await import('../../src/modules/zhihu/attribution/resources');
 const created=await resources.createKeyword(admin,scope,key(),{keyword:word,taskId:'1',mappingId,landingUrl:'https://example.com/risk',popularizeType:1});
 await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?",['risk-'+created.id,created.planId]);await resources.synchronizeKeywords(scope);
 const binding=await resources.distribute(admin,scope,created.id,key(),'2');await resources.changeBinding(creator,scope,binding.id,key(),{action:'activate'});
 await c.query("UPDATE zh_keyword_bindings SET activated_on=?,verification_status='passed' WHERE id=?",[date,binding.id]);return created;
}
const confirm=async()=>{const view=await workbench.overview(finance,scope,{from:date,to:date});return workbench.confirmBills(finance,scope,{from:date,to:date},key(),view.reviewHash)};
let report='',accepted:Awaited<ReturnType<typeof state>>;
it('风险行照常按角色价格计算，数量和原文保留，但新旧确认入口均阻止提前确认',async()=>{
 report=await riskUpload('分析关键词');const fact=await state();accepted=fact;
 expect(fact.reason_code).toBe('RISK_REVIEW_REQUIRED');expect(fact.snapshot_json.obligations[0].amount).toBe('32.0000');
 const analysis=(await get(report)).body.data;expect(analysis.totals).toMatchObject({billableAmount:'32.0000',confirmableAmount:'0.0000',billableQuantity:'4'});expect(analysis.riskCases).toEqual([{factId:String(fact.id),revisionId:String(fact.current_revision_id),keyword:'分析关键词',riskAssessment:'上游待核实'}]);
 const view=await workbench.overview(finance,scope,{from:date,to:date});expect(view.entries[0]).toMatchObject({amount:'32.0000',ready:false,reasonCode:'RISK_REVIEW_REQUIRED'});expect((await confirm()).confirmed).toBe(0);
 const statements=await import('../../src/modules/zhihu/attribution/statements');await expect(statements.previewStatement(admin,scope,key(),String(fact.id))).rejects.toThrow('来源未完成');
 expect(await q('SELECT * FROM opc_income_entries')).toHaveLength(0);
});
it('只有运营能核实，拒绝空原因、旧页面和跨项目操作；重复请求不重复决定',async()=>{
 for(const actor of [finance,creator,leader])expect((await review(accepted,'accepted',actor)).status).toBe(403);
 expect((await review(accepted,'accepted',ops,'  ')).status).toBe(422);
 expect((await review({...accepted,current_revision_id:'999'})).status).toBe(409);
 expect((await request(app).post('/api/v1/modules/zhihu/attributions/'+accepted.id+'/risk-review').set(headers[ops.sub]).send({...scope,projectId:'999',expectedRevisionId:String(accepted.current_revision_id),decision:'accepted',reason:'越界',requestKey:key()})).status).toBe(403);
 const savedKey=key(),raw=await q('SELECT raw_json,normalized_json FROM zh_import_rows WHERE batch_id=?',[report]);
 const result=await review(accepted,'accepted',ops,'已核对，上游标记不影响本次有效订单',savedKey);expect(result.status,result.text).toBe(200);
 expect((await review(accepted,'accepted',ops,'已核对，上游标记不影响本次有效订单',savedKey)).status).toBe(200);expect((await review(accepted)).status).toBe(409);
 expect(await q('SELECT raw_json,normalized_json FROM zh_import_rows WHERE batch_id=?',[report])).toEqual(raw);
 expect((await state()).reason_code).toBeNull();expect((await get(report)).body.data.totals.confirmableAmount).toBe('32.0000');
 expect((await get(report,ops)).body.data.riskCases).toHaveLength(0);expect(JSON.stringify((await get(report,ops)).body.data)).not.toMatch(/32\.0000|¥|unitPrice/);
 const {attributionDataProvider}=await import('../../src/modules/zhihu/attribution/provider');expect((await attributionDataProvider.summary({...scope,from:date,to:date},creator)).metrics[0].value).toBe('4');
});
it('风险来源变化需要重新核实；新计算出的调整不能绕过风险检查',async()=>{
 expect((await confirm()).confirmed).toBe(1);
 const changed=await riskUpload('分析关键词','5','另一次风险标记');const analysis=(await get(changed)).body.data,choice=analysis.steps[5].asks[0];
 expect((await answer(changed,choice.id,'new',finance)).status).toBe(200);
 expect((await state()).reason_code).toBe('RISK_REVIEW_REQUIRED');expect((await review(accepted)).status).toBe(409);
 const [draft]=await q("SELECT id,input_hash FROM zh_statement_entries WHERE fact_id=? AND status='draft' ORDER BY id DESC LIMIT 1",[accepted.id]);expect(draft).toBeDefined();
 const statements=await import('../../src/modules/zhihu/attribution/statements');await expect(statements.confirmStatement(admin,scope,String(draft.id),key(),String(draft.input_hash))).rejects.toThrow('报表待办');
});
it('已确认后核实不计费，只追加待财务确认的负数更正，原账和收入不变',async()=>{
 const confirmedRows=await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id"),income=await q('SELECT * FROM opc_income_entries ORDER BY id'),current=await state();
 const result=await review(current,'excluded',ops,'核实该行属于无效推广');expect(result.status,result.text).toBe(200);
 expect(await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id")).toEqual(confirmedRows);expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(income);
 const view=await workbench.overview(finance,scope,{from:date,to:date});expect(view.entries[0]).toMatchObject({amount:'0.0000',confirmedAmount:'32.0000',pendingAmount:'-32.0000',ready:true,reasonCode:'RISK_EXCLUDED'});
 expect((await confirm()).confirmed).toBe(1);
 expect(await q('SELECT * FROM opc_income_entries WHERE id IN (?) ORDER BY id',[income.map(row=>row.id)])).toEqual(income);
 expect((await q('SELECT CAST(SUM(amount) AS CHAR) amount FROM opc_income_entries'))[0].amount).toBe('0.0000');
 expect((await q("SELECT CAST(amount AS CHAR) amount FROM zh_statement_entries WHERE status='confirmed' AND entry_kind='adjustment'"))[0].amount).toBe('-32.0000');
 expect((await confirm()).confirmed).toBe(0);
});
it('尚未确认的不计费行保留数量和核实依据，不生成零元资金账，也不影响同日拉活',async()=>{
 await readyWord('风险不计费新词');const id=await riskUpload('风险不计费新词','5');process.env.ZHIHU_ACTIVATION_ENABLED='true';
 const activation=(await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,拉活量,结算金额\n${date},分析渠道,风险不计费新词,3,6`),'activation')).id;
 const activeBefore=await q("SELECT f.*,r.snapshot_json FROM zh_metric_facts f JOIN zh_attribution_results r ON r.id=f.current_result_id WHERE f.metric_type='activation'");
 const result=await review(await state('风险不计费新词'),'excluded');expect(result.status,result.text).toBe(200);
 const analysis=(await get(id)).body.data;expect(analysis.totals).toMatchObject({billableQuantity:'0',pendingQuantity:'0',excludedQuantity:'5',billableAmount:'0.0000'});expect(analysis.status).toBe('done');
 expect((await get(activation)).body.data.totals.billableAmount).toBe('3.6000');expect(await q("SELECT f.*,r.snapshot_json FROM zh_metric_facts f JOIN zh_attribution_results r ON r.id=f.current_result_id WHERE f.metric_type='activation'")).toEqual(activeBefore);
 const view=await workbench.overview(finance,scope,{from:date,to:date});expect(view.entries.find(entry=>entry.keyword==='风险不计费新词'&&entry.metricType==='new_user')).toMatchObject({status:'excluded',ready:false,amount:'0.0000'});
 expect(await q("SELECT id FROM opc_income_sources WHERE source_key=?",['fact:'+(await state('风险不计费新词')).id])).toHaveLength(0);
});
it('未指定执行人的风险行可明确不计费，保留原数量并结束无效补录待办',async()=>{
 const resources=await import('../../src/modules/zhihu/attribution/resources');
 await resources.createKeyword(admin,scope,key(),{keyword:'未分配风险词',taskId:'1',mappingId,landingUrl:'https://example.com/unassigned-risk',popularizeType:1});
 const id=await riskUpload('未分配风险词','7');const fact=await state('未分配风险词');expect(fact.reason_code).toBe('BINDING_MISSING');
 expect((await review(fact,'excluded',ops,'该来源无效，无需补录人员')).status).toBe(200);
 const analysis=(await get(id)).body.data;expect(analysis.status).toBe('done');expect(analysis.totals).toMatchObject({billableQuantity:'0',pendingQuantity:'0',excludedQuantity:'7'});
 const view=await workbench.overview(finance,scope,{from:date,to:date});expect(view.entries.find(entry=>entry.keyword==='未分配风险词')).toMatchObject({status:'excluded',reasonCode:'RISK_EXCLUDED',amount:'0.0000',ready:false,quantity:'7'});
 expect(await q("SELECT id FROM zh_exceptions WHERE fact_id=? AND status='open'",[fact.id])).toHaveLength(0);
 expect(await q("SELECT id FROM opc_income_sources WHERE source_key=?",['fact:'+fact.id])).toHaveLength(0);
});
it('核实与重新计价同事务回滚，并发核实只保留一个不可变结论',async()=>{
 await readyWord('风险回滚词');await riskUpload('风险回滚词');const fact=await state('风险回滚词'),before=await q('SELECT * FROM zh_attribution_results WHERE fact_id=?',[fact.id]);
 await c.query("CREATE TRIGGER reject_risk_review BEFORE INSERT ON zh_attribution_results FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated risk rollback'");
 try{expect((await review(fact)).status).toBe(500);}finally{await c.query('DROP TRIGGER reject_risk_review');}
 expect(await q('SELECT * FROM zh_risk_reviews WHERE fact_id=?',[fact.id])).toHaveLength(0);expect(await q('SELECT * FROM zh_attribution_results WHERE fact_id=?',[fact.id])).toEqual(before);
 const results=await Promise.all([review(fact),review(fact,'excluded')]);expect(results.map(result=>result.status).sort()).toEqual([200,409]);
 expect(await q('SELECT * FROM zh_risk_reviews WHERE fact_id=?',[fact.id])).toHaveLength(1);
});
it('重复运行风险核实迁移不会修改既有风险结论、已确认账与公共收入',async()=>{
 const tables=['zh_risk_reviews','zh_statement_entries','opc_income_entries','zh_import_rows'],before=await Promise.all(tables.map(table=>q('SELECT * FROM '+table+' ORDER BY id')));
 const sql=await readFile('schema/zhihu/034_risk_reviews.sql','utf8');await c.query(sql);await c.query(sql);
 expect(await Promise.all(tables.map(table=>q('SELECT * FROM '+table+' ORDER BY id')))).toEqual(before);
});
