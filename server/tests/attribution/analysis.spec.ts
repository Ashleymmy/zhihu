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
let initial='',conflict='',askId='';
const endpoint=(id:string)=>'/api/v1/modules/zhihu/imports/'+id;
const get=(id:string,u=finance)=>request(app).get(endpoint(id)+'/analysis').set(headers[u.sub]).query(scope);
const answer=(id:string,askId:string,option:string,u=finance,requestKey=key())=>request(app).post(endpoint(id)+'/answers').set(headers[u.sub]).send({...scope,askId,option,requestKey});
beforeAll(async()=>{
 container=await new MySqlContainer('mysql:8.0').withDatabase('analysis_test').withUsername('test').withUserPassword('isolated').start();
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
 const word=await resources.createKeyword(admin,scope,key(),{keyword:'分析关键词',taskId:'1',mappingId:mapping.id,landingUrl:'https://example.com/analysis',popularizeType:1});
 await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id='analysis-plan' WHERE id=?",[word.planId]);await resources.synchronizeKeywords(scope);
 const binding=await resources.distribute(admin,scope,word.id,key(),'2');await resources.changeBinding(creator,scope,binding.id,key(),{action:'activate'});
 await c.query("UPDATE zh_keyword_bindings SET activated_on=?,verification_status='passed' WHERE id=?",[date,binding.id]);
 initial=(await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,订单量\n${date},分析渠道,分析关键词,3\n${date},分析渠道,分析关键词,3\n${date},未知渠道,未识别词,4\n${date},未知渠道,未识别词,4\n错误日期,分析渠道,错误行,1\n合计,,,15`))).id;
 const {ModuleRuntime}=await import('../../src/core/module-runtime'),{zhihuManifest}=await import('../../src/modules/zhihu/manifest'),{createZhihuModule}=await import('../../src/modules/zhihu/module'),{createCoreApp}=await import('../../src/core/app');
 const runtime=new ModuleRuntime([zhihuManifest]);runtime.register(createZhihuModule());app=createCoreApp(runtime);
 const {signToken}=await import('../../src/auth/jwt'),{issueRefreshSession}=await import('../../src/auth/tokenSessions');
 for(const actor of [admin,creator,ops,finance,leader]){const client='analysis-client-'+actor.sub,session=await issueRefreshSession(actor.sub,{type:'web',id:client});headers[actor.sub]={'X-Client-Id':client,Authorization:'Bearer '+await signToken({...actor,id:actor.sub,sessionId:session.familyId})};}
},90000);
afterAll(async()=>{if(pool)await pool.end();if(c)await c.end();if(container)await container.stop();});
it('实际接口逐行保留进度，重复来源不重复合计，金额结论由后端给出',async()=>{
 const response=await get(initial);expect(response.status,response.text).toBe(200);const run=response.body.data;
 expect(run).toMatchObject({id:initial,fileName:'分析验收.csv',status:'needs_input',progress:{done:6,total:6},totals:{billableQuantity:'3',billableAmount:'24.0000',confirmableAmount:'24.0000',pendingQuantity:'4'}});
 expect(run.steps.map((step:{key:string})=>step.key)).toEqual(['read','channel','keyword','executor','work','amount']);
 expect(run.steps[0]).toMatchObject({status:'ask',summary:'6 行已保留，1 行格式需要修正，其余行继续处理'});
 expect(run.steps[1]).toMatchObject({status:'ask',summary:'2 行渠道需要运营确认'});expect(run.conclusion.value).toBe('7 单');expect(run.conclusion.summary).toContain('成员金额已算出 ¥24.00');
 expect(await q('SELECT id FROM opc_analysis_answers')).toHaveLength(0);
});
it('运营只能读取无金额的分析，团长和达人不能读取或回答，其他项目不能混用',async()=>{
 const response=await get(initial,ops);expect(response.status,response.text).toBe(200);expect(response.body.data.totals).toBeUndefined();expect(JSON.stringify(response.body.data)).not.toContain('¥');
 expect(response.body.data.steps[5].asks).toBeUndefined();
 expect(response.body.data.steps[1].asks[0].id).toMatch(/^name:channel:/);
 for(const actor of [creator,leader]){expect((await get(initial,actor)).status).toBe(403);expect((await answer(initial,'revision:1:1','new',actor)).status).toBe(403);}
 expect((await answer(initial,'revision:1:1','new',ops)).status).toBe(403);
 expect((await request(app).get(endpoint(initial)+'/analysis').set(headers[finance.sub]).query({...scope,projectId:'999'})).status).toBe(403);
});
it('两份报表不同给出三个明确选项，跳过持久保存而不修改原数据',async()=>{
 const before=await workbench.overview(finance,scope,{from:date,to:date});await workbench.confirmBills(finance,scope,{from:date,to:date},key(),before.reviewHash);
 conflict=(await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,订单量\n${date},分析渠道,分析关键词,5`))).id;
 const response=await get(conflict),choice=response.body.data.steps[5].asks[0];askId=choice.id;
 expect(choice.text).toContain('原来 3 单，这份报表是 5 单');expect(choice.options.map((option:{key:string})=>option.key)).toEqual(['new','old','skip']);
 expect(choice.comparison).toEqual([{label:'订单量（单）',previous:'3',incoming:'5',changed:true}]);
 const waiting=(await facts.listExceptions(finance,scope,1,25)).list.find(row=>row.revision_id);
 expect(waiting?.comparison).toEqual(choice.comparison);
 const filtered=await request(app).get('/api/v1/modules/zhihu/exceptions').set(headers[finance.sub]).query({...scope,factId:String(waiting?.fact_id),pageSize:25});
 expect(filtered.status).toBe(200);expect(filtered.body.data.list.every((row:{factId:string})=>row.factId===String(waiting?.fact_id))).toBe(true);
 expect((await request(app).get('/api/v1/modules/zhihu/exceptions').set(headers[creator.sub]).query({...scope,factId:String(waiting?.fact_id)})).status).toBe(403);
 expect((await request(app).get('/api/v1/modules/zhihu/exceptions').set(headers[finance.sub]).query({...scope,projectId:'999',factId:String(waiting?.fact_id)})).status).toBe(403);
 expect((await facts.listExceptions(ops,scope,1,25)).list.every(row=>!row.comparison&&!row.snapshot_json&&!row.current_snapshot_json)).toBe(true);
 const factsBefore=await q('SELECT * FROM zh_metric_facts ORDER BY id');expect((await answer(conflict,askId,'skip')).status).toBe(200);
 expect((await get(conflict)).body.data.steps[5]).toMatchObject({status:'skipped'});expect(await q('SELECT * FROM zh_metric_facts ORDER BY id')).toEqual(factsBefore);
 expect((await q('SELECT option_key FROM opc_analysis_answers'))[0].option_key).toBe('skip');
 const saved=await q('SELECT * FROM opc_analysis_answers ORDER BY id'),migration=await readFile('schema/extensions/014_analysis_answers.sql','utf8');
 await c.query(migration);await c.query(migration);expect(await q('SELECT * FROM opc_analysis_answers ORDER BY id')).toEqual(saved);
 expect((await answer(initial,askId,'new')).status).toBe(409);expect((await answer(conflict,askId,'forged')).status).toBe(409);
});
it('采用新数字自动重算并只追加更正，重复提交不会重复入账',async()=>{
 const bills=await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id"),income=await q('SELECT * FROM opc_income_entries ORDER BY id');
 const token=key(),accepted=await answer(conflict,askId,'new',finance,token);expect(accepted.status,accepted.text).toBe(200);
 expect(accepted.body.data).toMatchObject({status:'done',totals:{billableQuantity:'5',billableAmount:'40.0000',confirmableAmount:'16.0000'}});
 expect(accepted.body.data.steps[5].asks).toBeUndefined();expect((await answer(conflict,askId,'new',finance,token)).body.data).toEqual(accepted.body.data);
 expect(await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id")).toEqual(bills);expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(income);
 expect(await q("SELECT amount FROM zh_statement_entries WHERE entry_kind='adjustment' AND status='draft'")).toEqual([{amount:'16.0000'}]);
 expect((await answer(conflict,askId,'old')).status).toBe(409);
});
it('保留原值清除待确认问题，原始上传行仍可查看',async()=>{
 const next=(await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,订单量\n${date},分析渠道,分析关键词,7`))).id;
 const choice=(await get(next)).body.data.steps[5].asks[0];expect((await answer(next,choice.id,'old')).status).toBe(200);
 const view=await get(next);expect(view.body.data).toMatchObject({status:'done',totals:{billableAmount:'40.0000'}});
 expect((await facts.importDetail(finance,scope,next,1,25)).rows).toHaveLength(1);expect(await q("SELECT id FROM zh_metric_revisions WHERE status='pending'")).toHaveLength(0);
});
it('数量相同时仍显示变化的收益和风险内容，避免看不到差异就做选择',async()=>{
 const next=(await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,订单量,收益,风险判定\n${date},分析渠道,分析关键词,5,50,待核验`))).id;
 const choice=(await get(next)).body.data.steps[5].asks[0];
 expect(choice.text).toContain('报表收益：原来 未提供，本次 50.0000');expect(choice.text).toContain('风险标记：原来 未提供，本次 待核验');
 expect(choice.comparison).toEqual([{label:'订单量（单）',previous:'5',incoming:'5',changed:false},{label:'报表收益（元）',previous:'未提供',incoming:'50.0000',changed:true},{label:'风险标记',previous:'未提供',incoming:'待核验',changed:true}]);
 expect((await answer(next,choice.id,'old')).status).toBe(200);
});
it('后台处理失败时停止轮询并给出继续处理入口，不把技术错误直接显示给人',async()=>{
 const pending=await facts.previewImport(finance,scope,file(`日期,渠道,关键词,订单量\n2026-09-15,分析渠道,分析关键词,1`),'order');
 const detail=await facts.importDetail(finance,scope,pending.id,1,1);await facts.commitImport(finance,scope,pending.id,key(),detail.preview_hash);
 expect((await get(pending.id)).body.data).toMatchObject({status:'running',progress:{done:0,total:1}});
 await c.query("UPDATE zh_processing_jobs SET status='failed',last_error='SQL failure internal-secret' WHERE batch_id=?",[pending.id]);
 const failed=await get(pending.id);expect(failed.body.data.status).toBe('failed');expect(failed.body.data.conclusion.actions.some((action:{key:string})=>action.key==='retry')).toBe(true);expect(JSON.stringify(failed.body.data)).not.toContain('internal-secret');
});
it('大额四位小数的已入账金额按字符串读取，新增一单的更正仍精确到单价',async()=>{
 await c.query("UPDATE opc_rate_rules SET unit_price=7.1234 WHERE metric_type='new_user' AND rule_code='creator'");
 try{
   const day='2026-09-16';
   await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,订单量\n${day},分析渠道,分析关键词,1234567890123`));
   const before=await workbench.overview(finance,scope,{from:day,to:day});await workbench.confirmBills(finance,scope,{from:day,to:day},key(),before.reviewHash);
   const next=(await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,订单量\n${day},分析渠道,分析关键词,1234567890124`))).id;
   const choice=(await get(next)).body.data.steps[5].asks[0],result=await answer(next,choice.id,'new');
   expect(choice.comparison[0]).toMatchObject({previous:'1234567890123',incoming:'1234567890124'});
   expect(result.status,result.text).toBe(200);expect(result.body.data.totals.confirmableAmount).toBe('7.1234');
 }finally{await c.query("UPDATE opc_rate_rules SET unit_price=8 WHERE metric_type='new_user' AND rule_code='creator'");}
});
it('状态和关键词在分页前筛选，较早未处理项不被新近完成记录遮住',async()=>{
 const imported=await workbench.uploadReport(finance,scope,file('日期,渠道,关键词,订单量\n'+Array.from({length:32},(_,n)=>`${date},分析渠道,分页检查${n},1`).join('\n')));
 await c.query("UPDATE zh_exceptions e JOIN zh_import_rows r ON r.id=e.source_row_id SET e.status='resolved',e.resolution='分页隔离样本' WHERE r.batch_id=? AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.keyword')) NOT IN ('分页检查0','分页检查1')",[imported.id]);
 const list=(actor:AuthUser,extra:object={})=>request(app).get('/api/v1/modules/zhihu/exceptions').set(headers[actor.sub]).query({...scope,search:'分页检查',status:'open',page:1,pageSize:25,...extra});
 for(const actor of [admin,ops,finance]){
  const pending=await list(actor);expect(pending.status,pending.text).toBe(200);expect(pending.body.data).toMatchObject({total:2,counts:{all:32,pending:2,done:30}});
  expect(pending.body.data.list.map((row:{normalizedJson:{keyword:string}})=>row.normalizedJson.keyword).sort()).toEqual(['分页检查0','分页检查1']);
  const closed=await list(actor,{status:'done'});expect(closed.body.data.total).toBe(30);expect(closed.body.data.list).toHaveLength(25);expect(closed.body.data.list.every((row:{status:string})=>row.status==='resolved')).toBe(true);
  const page2=await list(actor,{status:'done',page:2});expect(page2.body.data.list).toHaveLength(5);
  const matching=await list(actor,{search:'分页检查0'});expect(matching.body.data.total).toBe(1);expect(matching.body.data.list[0].normalizedJson.keyword).toBe('分页检查0');
  expect((await list(actor,{search:'不存在的关键词'})).body.data).toMatchObject({list:[],total:0,counts:{all:0,pending:0,done:0}});
 }
 expect((await list(creator)).status).toBe(403);expect((await list(leader)).status).toBe(403);
 expect((await list(finance,{projectId:'999'})).status).toBe(403);
 expect((await list(finance,{status:'bad'})).status).toBe(422);
});
it('缺执行人待办提供同一补录入口，财务没有操作权限且保存后自动消失',async()=>{
 const resources=await import('../../src/modules/zhihu/attribution/resources'),options=await resources.options(ops,scope);
 const word=await resources.createKeyword(ops,scope,key(),{keyword:'待办直接补录',taskId:'1',mappingId:String(options.mappings[0].id),landingUrl:'https://example.com/todo-assignment',popularizeType:1});
 await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,订单量\n${date},分析渠道,待办直接补录,2`));
 const inbox=(actor:AuthUser)=>request(app).get('/api/v1/modules/zhihu/exceptions').set(headers[actor.sub]).query({...scope,status:'open',search:'待办直接补录'});
 const pending=await inbox(ops);expect(pending.status,pending.text).toBe(200);expect(pending.body.data.list).toHaveLength(1);
 expect(pending.body.data.list[0]).toMatchObject({keywordId:word.id,canAssignRetro:true,retroFromDate:date});
 expect((await inbox(finance)).body.data.list[0].canAssignRetro).toBe(false);
 const assign=(actor:AuthUser)=>request(app).post('/api/v1/modules/zhihu/keywords/'+word.id+'/assign-retro').set(headers[actor.sub]).send({...scope,executorId:'2',fromDate:date,requestKey:key()});
 expect((await assign(finance)).status).toBe(403);expect((await assign(creator)).status).toBe(403);
 const saved=await assign(ops);expect(saved.status,saved.text).toBe(200);expect((await inbox(ops)).body.data.list).toEqual([]);
 const row=(await workbench.overview(finance,scope,{from:date,to:date})).entries.find(row=>row.keywordId===word.id);expect(row?.amount).toBe('16.0000');
});
