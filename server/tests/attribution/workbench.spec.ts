import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {MySqlContainer,type StartedMySqlContainer} from '@testcontainers/mysql';
import mysql,{type Connection} from 'mysql2/promise';
import request from 'supertest';
import * as XLSX from 'xlsx';
import type {Express} from 'express';
import type {AuthUser} from '../../src/types';
import {runOpcMigrations} from '../../scripts/opcMigrations';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
vi.mock('../../src/modules/zhihu/queue',async (original)=>({...await original<typeof import('../../src/modules/zhihu/queue')>(),enqueue:vi.fn(async()=>({id:'test'}))}));
let container:StartedMySqlContainer,c:Connection,app:Express,pool:typeof import('../../src/db').db;
let resource:typeof import('../../src/modules/zhihu/attribution/resources'),statements:typeof import('../../src/modules/zhihu/attribution/statements'),workbench:typeof import('../../src/modules/zhihu/attribution/workbench'),finance:typeof import('../../src/core/finance'),facts:typeof import('../../src/modules/zhihu/attribution/facts');
const key=()=>crypto.randomUUID();
const u=(id:string,role:AuthUser['role'],parentId:string|null=null,adminDuty:AuthUser['adminDuty']='all'):AuthUser=>({sub:id,username:'u'+id,displayName:'测试'+id,role,parentId,adminDuty,jti:key()});
const admin=u('1','admin'),leader=u('2','leader'),a=u('3','creator','2'),b=u('4','creator','2'),solo=u('5','creator'),other=u('6','leader'),ops=u('7','admin',null,'operations'),fin=u('8','admin',null,'finance');
const developer=u('9','developer');
const users=[admin,leader,a,b,solo,other,ops,fin,developer],tokens:Record<string,string>={};
let scope={projectId:'1',accountId:''},day='',mapping='',bindingA='',batch='',withdrawal='';
const q=async(sql:string,params:unknown[]=[])=> (await c.query<mysql.RowDataPacket[]>(sql,params))[0];
const common=()=>({...scope,moduleId:'zhihu'});
const path=(p:string)=>'/api/v1/modules/zhihu'+p;
const get=(actor:AuthUser,p:string,query:object={})=>request(app).get(p).set('X-Client-Id','workbench-client-'+actor.sub).set('Authorization','Bearer '+tokens[actor.sub]).query(query);
const post=(actor:AuthUser,p:string,body:object={})=>request(app).post(p).set('X-Client-Id','workbench-client-'+actor.sub).set('Authorization','Bearer '+tokens[actor.sub]).send(body);
function report(count=30){
 const book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['日期','渠道名称','关键词','搜索量','订单','收益'],...[[0,count],[1,20],[2,10],[3,5],[4,0]].map(([n,orders])=>[day,'联测渠道','联测词'+n,100,orders,orders*20])]),'日报');
 const buffer=XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer;
 return{originalname:'联测.xlsx',mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer,size:buffer.length};
}
beforeAll(async()=>{
 container=await new MySqlContainer('mysql:8.0').withDatabase('workbench_test').withUsername('test').withUserPassword('isolated_test').start();
 const target={host:container.getHost(),port:container.getPort(),database:container.getDatabase(),user:container.getUsername(),password:container.getUserPassword()};
 Object.assign(process.env,{DB_HOST:target.host,DB_PORT:String(target.port),DB_NAME:target.database,DB_USER:target.user,DB_PASS:target.password,OPC_MODULES:'zhihu'});
 await runOpcMigrations(target,['zhihu']);c=await mysql.createConnection(target);
 for(const actor of users)await c.query('INSERT INTO users(id,username,password_hash,role,display_name,parent_id,admin_duty) VALUES(?,?,?,?,?,?,?)',[actor.sub,actor.username,'unused',actor.role,actor.displayName,actor.parentId,actor.adminDuty]);
 await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,4),(1,5),(1,6)');
 scope.accountId=String((await q('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
 await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'ch1',1,'联测渠道')");
 await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'task1','联测任务',NOW())");
 resource=await import('../../src/modules/zhihu/attribution/resources');statements=await import('../../src/modules/zhihu/attribution/statements');workbench=await import('../../src/modules/zhihu/attribution/workbench');finance=await import('../../src/core/finance');facts=await import('../../src/modules/zhihu/attribution/facts');pool=(await import('../../src/db')).db;
 day=(await import('../../src/modules/zhihu/attribution/domain')).businessDay();
 mapping=(await resource.createMapping(admin,scope,key(),{channelId:'1',name:'联测渠道',from:day})).id;
 const pricing=await import('../../src/modules/zhihu/attribution/pricing');
 for(const [payer,payee,price] of [[admin,leader,'15'],[leader,a,'13'],[leader,b,'12'],[admin,solo,'14']] as const){
  const v=await pricing.draftPrice(payer,scope,key(),{taskId:'1',payeeId:payee.sub,unitPrice:price,from:day,reason:'仅用于测试'});
  await pricing.publishPrice(payer,scope,v.id,key());
 }
 for(const [n,actor] of [a,b,solo,leader,a].entries()){
  const word=await resource.createKeyword(admin,scope,key(),{keyword:'联测词'+n,taskId:'1',mappingId:mapping,landingUrl:'https://www.zhihu.com/market/test',popularizeType:1});
  await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?",['external'+n,word.planId]);
  await resource.synchronizeKeywords(scope);
  const bind=await resource.distribute(admin,scope,word.id,key(),actor.sub);
  if(actor===leader)await resource.changeBinding(leader,scope,bind.id,key(),{action:'assign',executorId:leader.sub});
  await resource.changeBinding(actor,scope,bind.id,key(),{action:'activate'});
  await statements.submitEvidence(actor,scope,key(),{bindingId:bind.id,url:'https://example.com/work/'+n,description:'隔离测试作品'});
  if(n===0)bindingA=bind.id;
 }
 const {ModuleRuntime}=await import('../../src/core/module-runtime'),{zhihuManifest}=await import('../../src/modules/zhihu/manifest'),{createZhihuModule}=await import('../../src/modules/zhihu/module'),{createCoreApp}=await import('../../src/core/app');
 const runtime=new ModuleRuntime([zhihuManifest]);runtime.register(createZhihuModule());app=createCoreApp(runtime);
 const {signToken}=await import('../../src/auth/jwt');
 const {issueRefreshSession}=await import('../../src/auth/tokenSessions');
 for(const actor of users){
  const session=await issueRefreshSession(actor.sub,{type:'web',id:'workbench-client-'+actor.sub});
  tokens[actor.sub]=await signToken({...actor,id:actor.sub,adminDuty:'all',sessionId:session.familyId});
 }
},90000);
afterAll(async()=>{if(pool)await pool.end();if(c)await c.end();if(container)await container.stop({remove:true,removeVolumes:true});});
describe('简化工作台完整资金流程',()=>{
 it('服务端刷新岗位权限，不能通过旧 token 越权',async()=>{
  expect((await post(fin,path('/keywords'),{...scope})).status).toBe(403);
  expect((await post(fin,path('/price-agreements'),{...scope})).status).toBe(403);
  expect((await post(ops,path('/workbench/import'),{...scope})).status).toBe(403);
  expect((await post(ops,path('/workbench/confirm'),{...scope})).status).toBe(403);
  const denied=await get(ops,path('/workbench'),{...scope,from:day,to:day});
  expect(denied.status).toBe(403);expect(denied.body.message).toBe('这里需要财务权限');
  await expect(workbench.overview(ops,scope,{from:day,to:day})).rejects.toThrow('这里需要财务权限');
  expect((await post(ops,'/api/v1/core/finance/funding',{...common(),hash:'0'.repeat(64),reference:'test'})).status).toBe(403);
  expect((await get(fin,path('/attribution-options'),scope)).status).toBe(200);
  expect((await get(ops,'/api/v1/core/team/members',{page:1,pageSize:20})).status).toBe(200);
  for(const actor of [fin,a,leader])expect((await post(actor,path('/keywords/1/assign-retro'),{...scope,executorId:a.sub,fromDate:day,requestKey:key()})).status).toBe(403);
 });
 it('开发者创建财务岗位，管理员不能创建同级账号或降级自己',async()=>{
  expect((await post(admin,'/api/v1/core/staff',{username:'same_level',displayName:'同级财务',duty:'finance'})).status).toBe(403);
  const made=await post(developer,'/api/v1/core/staff',{username:'new_fin',displayName:'测试财务',duty:'finance'});
  expect(made.status,made.text).toBe(201);
  const login=await post(admin,'/api/v1/core/auth/login',{username:'new_fin',password:made.body.data.temporaryPassword});
  expect(login.status,login.text).toBe(200);expect(login.body.data.user.adminDuty).toBe('finance');
  expect((await request(app).patch('/api/v1/core/staff/1').set('X-Client-Id','workbench-client-1').set('Authorization','Bearer '+tokens['1']).send({duty:'finance'})).status).toBe(409);
  expect((await post(fin,'/api/v1/core/staff',{username:'bad',displayName:'越权',duty:'operations'})).status).toBe(403);
 });
 it('上传后自动读取65单，待审核作品不能提前入账',async()=>{
  const file=report();
  const result=await request(app).post(path('/workbench/import')).set('X-Client-Id','workbench-client-8').set('Authorization','Bearer '+tokens['8']).field('projectId',scope.projectId).field('accountId',scope.accountId).attach('file',file.buffer,'联测.xlsx');
  expect(result.status,result.text).toBe(202);batch=result.body.data.id;
  const v=await workbench.overview(fin,scope,{from:day,to:day});
  expect(v.summary.orders).toBe('65');expect(v.summary.payable).toBe('547.5000');expect(v.entries.every(e=>!e.ready)).toBe(true);
  expect((await finance.financeOverview(a,common())).balance?.confirmed).toBe('0.0000');
 });
 it('部分错误与汇总行不影响正常订单，全部错误也保留读取结果',async()=>{
  const book=XLSX.read(report().buffer,{type:'buffer'}),sheet=book.Sheets[book.SheetNames[0]];
  XLSX.utils.sheet_add_aoa(sheet,[['错日期','联测渠道','错误词',100,1,20],['合计',null,null,500,65,1300]],{origin:-1});
  const buffer=XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer;
  const imported=await workbench.uploadReport(fin,scope,{...report(),buffer,size:buffer.length,originalname:'有问题的报表.xlsx'});
  const detail=await facts.importDetail(fin,scope,imported.id,1,25);
  expect(detail.rows).toHaveLength(7);
  expect(detail.counts.find(r=>r.processing_status==='invalid')?.total).toBe(1);
  expect(detail.counts.find(r=>r.processing_status==='skipped')?.total).toBe(1);
  expect(detail.rows.find(r=>r.processing_status==='invalid')?.error_text).toContain('第 7 行日期写成了');
  expect((await workbench.overview(fin,scope,{from:day,to:day})).summary.orders).toBe('65');
  const allInvalid=Buffer.from('日期,渠道名称,关键词,订单量\n错日期,联测渠道,错误词,1');
  const invalidImport=await workbench.uploadReport(fin,scope,{originalname:'全部错误.csv',mimetype:'text/csv',buffer:allInvalid,size:allInvalid.length});
  expect((await facts.importDetail(fin,scope,invalidImport.id,1,25)).counts).toEqual([{processing_status:'invalid',total:1}]);
 });
 it('一次财务确认生成四人净收入，重复报表与确认不重复入账',async()=>{
  for(const e of (await statements.listEvidence(admin,scope,1,100)).list)await statements.reviewEvidence(ops,scope,String(e.id),key(),true,'测试审核通过');
  const response=await get(fin,path('/workbench'),{...scope,from:day,to:day});expect(response.status,response.text).toBe(200);
  const confirmed=await post(fin,path('/workbench/confirm'),{...scope,from:day,to:day,requestKey:key(),acknowledged:true,reviewHash:response.body.data.reviewHash});
  expect(confirmed.status,confirmed.text).toBe(200);expect(confirmed.body.data.confirmed,JSON.stringify(response.body.data.groups)).toBe(5);
  for(const [actor,amount] of [[a,'240.0000'],[b,'160.0000'],[solo,'80.0000'],[leader,'67.5000']] as const){
   const own=await finance.financeOverview(actor,common());expect(own.balance?.confirmed).toBe(amount);expect(own.balance?.held).toBe(amount);expect(own.balance?.available).toBe('0.0000');
  }
  const before=(await q('SELECT COUNT(*) n FROM opc_income_entries'))[0].n;
  expect((await workbench.uploadReport(fin,scope,report())).id).toBe(batch);
  const v=await workbench.overview(fin,scope,{from:day,to:day});await workbench.confirmBills(fin,scope,{from:day,to:day},key(),v.reviewHash);
  expect((await q('SELECT COUNT(*) n FROM opc_income_entries'))[0].n).toBe(before);
  const l=await workbench.overview(leader,scope,{from:day,to:day});expect(l.groups.some(g=>g.payeeId===solo.sub)).toBe(false);
  expect(l.entries.length).toBeGreaterThan(0);
  expect(l.entries.every(e=>e.payeeId===leader.sub)).toBe(true);
  expect(new Set(l.entries.map(e=>e.calculation?.unitPrice))).toEqual(new Set(['0.5000','8.5000']));
  expect(l.entries.every(e=>e.calculation?.beforeRiskAmount===e.amount)).toBe(true);
  expect((await workbench.overview(a,scope,{from:day,to:day})).entries.every(e=>e.calculation?.unitPrice==='8.0000')).toBe(true);
  expect(l.groups.map(g=>g.payeeId)).toEqual([leader.sub]);
  expect(l.summary.payable).toBe(l.summary.receivable);
  expect(l.teamPerformance).toEqual([
   {executorId:a.sub,name:a.displayName,orders:'30',commission:'15.0000',activations:'0',activationCommission:'0.0000'},
   {executorId:b.sub,name:b.displayName,orders:'20',commission:'10.0000',activations:'0',activationCommission:'0.0000'},
  ]);
  expect((await workbench.overview(a,scope,{from:day,to:day})).teamPerformance).toEqual([]);
  const leaderResponse=await get(leader,path('/workbench'),{...scope,from:day,to:day});
  expect(leaderResponse.status).toBe(200);
  expect(leaderResponse.body.data.entries.every((e:{payeeId:string})=>e.payeeId===leader.sub)).toBe(true);
  expect((await workbench.overview(other,scope,{from:day,to:day})).groups).toHaveLength(0);
  expect((await workbench.overview(a,scope,{from:day,to:day})).groups.map(g=>g.payeeId)).toEqual([a.sub]);
 });
 it('报表减少先抵扣待开放款项，不产生虚假负债',async()=>{
  await workbench.uploadReport(fin,scope,report(29));
  const problem=(await facts.listExceptions(fin,scope,1,100)).list.find(e=>e.reason_code==='SOURCE_REVISION_PENDING')!;
  await facts.acceptRevision(fin,scope,String(problem.revision_id),key(),problem.expected_revision_id===null?null:String(problem.expected_revision_id),'核对测试报表更正',true);
  const v=await workbench.overview(fin,scope,{from:day,to:day});await workbench.confirmBills(fin,scope,{from:day,to:day},key(),v.reviewHash);
  const own=await finance.financeOverview(a,common());expect(own.balance?.confirmed).toBe('232.0000');expect(own.balance?.held).toBe('232.0000');expect(own.balance?.offset).toBe('0.0000');
 });
 it('资金开放后并发提现只占用一次，驳回和撤回释放占用',async()=>{
  const view=await finance.financeOverview(fin,common());expect(view.funding.amount).toBe('539.0000');
  await finance.releaseFunding(fin,common(),view.funding.hash,'隔离测试：模拟款项已准备');
  const input={amount:'232.00',receiverName:'测试A',bankName:'测试银行',bankAccount:'TEST-ONLY'};
  const results=await Promise.allSettled([finance.applyWithdrawal(a,common(),key(),input),finance.applyWithdrawal(a,common(),key(),input)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const win=results.find(r=>r.status==='fulfilled');if(win?.status!=='fulfilled')throw Error('无有效申请');withdrawal=win.value.id;
  expect((await finance.financeOverview(a,common())).balance?.available).toBe('0.0000');
  await finance.reviewWithdrawal(fin,common(),withdrawal,'reject','测试退回');expect((await finance.financeOverview(a,common())).balance?.available).toBe('232.0000');
  const receipt=key();withdrawal=(await finance.applyWithdrawal(a,common(),receipt,input)).id;
  expect((await finance.applyWithdrawal(a,common(),receipt,input)).id).toBe(withdrawal);
  expect((await finance.financeOverview(b,common())).withdrawals).toHaveLength(0);
 });
 it('作品争议阻止审核付款，解除后仍需财务重新核对',async()=>{
  const originalLines=await q('SELECT * FROM opc_earning_lines ORDER BY id'),originalCash=await q('SELECT * FROM opc_income_entries ORDER BY id');
  const earning=async()=>{
   const response=await get(a,'/api/v1/core/earnings/mine',{from:day,to:day});expect(response.status,response.text).toBe(200);
   return response.body.data.list.find((row:{taskName:string})=>row.taskName==='联测词0');
  };
  await statements.disputeBinding(ops,scope,bindingA,key(),false,'测试争议');
  expect(await earning()).toMatchObject({reason:'作品存在争议',nextAction:'运营：核实作品归属',isReady:0,amount:'232.0000'});
  expect(await q('SELECT * FROM opc_earning_lines ORDER BY id')).toEqual(originalLines);
  const beforeMigration=await q('SELECT * FROM opc_earning_sources ORDER BY id');
  const migration=await (await import('node:fs/promises')).readFile('schema/extensions/016_earning_source_actions.sql','utf8');
  for(let repeat=0;repeat<2;repeat++)for(const sql of migration.split(/;\s*(?:\r?\n|$)/).filter(sql=>sql.trim()))await c.query(sql);
  expect(await q('SELECT * FROM opc_earning_sources ORDER BY id')).toEqual(beforeMigration);
  await expect(finance.reviewWithdrawal(fin,common(),withdrawal,'approve','')).rejects.toThrow('来源金额或状态');
  await statements.disputeBinding(ops,scope,bindingA,key(),true,'测试解除');
  expect(await earning()).toMatchObject({reason:'争议已解除，待财务重新核对',nextAction:'财务：重新核对金额',isReady:0});
  expect(await q('SELECT * FROM opc_earning_lines ORDER BY id')).toEqual(originalLines);
  expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(originalCash);
  await expect(finance.reviewWithdrawal(fin,common(),withdrawal,'approve','')).rejects.toThrow('来源金额或状态');
  const v=await workbench.overview(fin,scope,{from:day,to:day});await workbench.confirmBills(fin,scope,{from:day,to:day},key(),v.reviewHash);
  expect(await earning()).toMatchObject({reason:'',nextAction:'金额已确认，可查看提现状态',isReady:1,amount:'232.0000'});
  await finance.reviewWithdrawal(fin,common(),withdrawal,'approve','测试审核');
 });
 it('付款凭证选填但提供时须有效；重复登记不会付款两次，凭证只供财务和本人查看',async()=>{
  const proof={buffer:Buffer.from('%PDF-1.4\nTEST ONLY - no real payment\n%%EOF'),originalname:'test-only.pdf',size:0};proof.size=proof.buffer.length;
  await expect(finance.recordPayment(fin,common(),withdrawal,{reference:'TEST-PAYMENT-1',paidOn:day},{buffer:Buffer.from('invalid'),originalname:'fake.pdf',size:7})).rejects.toThrow('付款凭证');
  await finance.recordPayment(fin,common(),withdrawal,{reference:'TEST-PAYMENT-1',paidOn:day},proof);
  await finance.recordPayment(fin,common(),withdrawal,{reference:'TEST-PAYMENT-1',paidOn:day},proof);
  const own=await finance.financeOverview(a,common());expect(own.balance?.paid).toBe('232.0000');expect(own.balance?.processing).toBe('0.0000');
  expect((await finance.paymentProof(a,common(),withdrawal)).buffer).toEqual(proof.buffer);
  await expect(finance.paymentProof(b,common(),withdrawal)).rejects.toThrow('无权');
  await expect(finance.paymentProof(leader,common(),withdrawal)).rejects.toThrow('无权');
  await expect(finance.recordPayment(fin,common(),withdrawal,{reference:'changed',paidOn:day},proof)).rejects.toThrow('不能重复修改');
 });
 it('同一来源部分已开放、部分待开放的减额保持准确，旧收入不可覆盖',async()=>{
  const {withTransaction}=await import('../../src/db');
  const source={sourceKey:'mixed-test',version:'v1',date:day,description:'隔离精度测试',allocations:[{userId:solo.sub,amount:'100.0000'}],total:'100.0000'};
  await withTransaction(conn=>finance.syncIncome(conn,fin,common(),source));
  let view=await finance.financeOverview(fin,common());await finance.releaseFunding(fin,common(),view.funding.hash,'测试开放');
  await withTransaction(conn=>finance.syncIncome(conn,fin,common(),{...source,version:'v2',allocations:[{userId:solo.sub,amount:'150.0000'}],total:'150.0000'}));
  await withTransaction(conn=>finance.syncIncome(conn,fin,common(),{...source,version:'v3',allocations:[{userId:solo.sub,amount:'80.0000'}],total:'80.0000'}));
  const own=await finance.financeOverview(solo,common());expect(own.balance?.available).toBe('160.0000');expect(own.balance?.held).toBe('0.0000');
  view=await finance.financeOverview(fin,common());await finance.releaseFunding(fin,common(),view.funding.hash,'零额抵扣明细清理测试');
  await expect(withTransaction(conn=>finance.syncIncome(conn,fin,common(),{...source,version:'v3',allocations:[{userId:solo.sub,amount:'90.0000'}],total:'90.0000'}))).rejects.toThrow('同一账单版本');
  expect((await q("SELECT CAST(amount AS CHAR) amount FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.source_key='mixed-test' ORDER BY e.id")).map(r=>r.amount)).toEqual(['100.0000','50.0000','-50.0000','-20.0000']);
 });
 it('较早报表在没有旧数据时自动前移，旧数据日期保留但不重复计算',async()=>{
  const cutover=await import('../../src/modules/zhihu/attribution/cutover');
  const {withTransaction}=await import('../../src/db');
  const earlier=new Date(Date.parse(day)-3*86400000).toISOString().slice(0,10);
  const legacy=new Date(Date.parse(day)-5*86400000).toISOString().slice(0,10);
  const csv=(rows:string[])=>{const buffer=Buffer.from('日期,渠道名称,关键词,订单量\n'+rows.join('\n'));return{buffer,size:buffer.length,originalname:'历史.csv',mimetype:'text/csv'}};
  const before=(await q('SELECT COUNT(*) n FROM opc_income_entries'))[0].n;
  await workbench.uploadReport(fin,scope,csv([earlier+',联测渠道,联测词0,2']));
  expect((await cutover.getRoute(admin,scope))?.exclusive_from).toBe(earlier);
  expect((await q("SELECT COUNT(*) n FROM audit_logs WHERE action='zhihu.engine.extend-earlier'"))[0].n).toBeGreaterThan(0);
  const [plan]=await q('SELECT plan_id FROM zh_keywords LIMIT 1');
  await c.query("INSERT INTO daily_metrics(project_id,plan_id,channel_id,keyword,stat_date,fetched_at) VALUES(?,?,'ch1','历史词',?,NOW())",[scope.projectId,plan.plan_id,legacy]);
  const result=await workbench.uploadReport(fin,scope,csv([legacy+',联测渠道,联测词0,10',earlier+',联测渠道,联测词0,2']));
  const rows=(await facts.importDetail(fin,scope,result.id,1,25)).rows;
  expect(rows[0]).toMatchObject({processing_status:'legacy_settled',error_text:'这一天早于本期计账启用日期，尚未计入本期；这不代表已结算'});
  expect(rows[1].processing_status).not.toBe('legacy_settled');
  expect((await cutover.getRoute(admin,scope))?.exclusive_from).toBe(earlier);
  expect((await q('SELECT COUNT(*) n FROM opc_income_entries'))[0].n).toBe(before);
  await expect(cutover.configureRoute(admin,scope,{from:legacy,mode:'trial',sampleVerified:false,reason:'不允许手动前移'})).rejects.toThrow('不可移动');
  await expect(withTransaction(conn=>cutover.extendRouteIfClean(conn,scope,'invalid',admin))).rejects.toThrow('业务日期');
  await expect(withTransaction(async conn=>{
   await conn.query('DELETE FROM zh_engine_routes WHERE account_id=? AND project_id=?',[scope.accountId,scope.projectId]);
   await cutover.extendRouteIfClean(conn,scope,legacy,admin);
  })).rejects.toThrow('已有旧系统数据');
  expect((await cutover.getRoute(admin,scope))?.exclusive_from).toBe(earlier);
 });
 it('平台收益与真实模块计算一致，团长仅拿到本人净价，自动确认写入不可变记录',async()=>{
  for(const actor of [leader,a,b,solo]){
   const view=await workbench.overview(actor,scope,{from:day,to:day});
   const response=await get(actor,'/api/v1/core/earnings/mine',{from:day,to:day});expect(response.status,response.text).toBe(200);
   expect(response.body.data.summary.amount).toBe(view.summary.receivable);
   for(const row of response.body.data.list){
    const expected=view.entries.find(e=>e.keywordId===row.taskId);expect(expected).toBeTruthy();
    expect(row.amount).toBe(expected!.amount);expect(row.unitPrice).toBe(expected!.calculation?.unitPrice??null);
   }
  }
  const rows=(await get(leader,'/api/v1/core/earnings/mine',{from:day,to:day})).body.data.list;
  expect(rows.filter((r:{earningGroup:string})=>r.earningGroup==='team').every((r:{unitPrice:string})=>['0.5000'].includes(r.unitPrice))).toBe(true);
  expect((await get(ops,'/api/v1/core/earnings/mine',{from:day,to:day})).status).toBe(403);
  expect((await q('SELECT COUNT(*) n FROM opc_earning_lines WHERE confirmed_at IS NOT NULL'))[0].n).toBeGreaterThan(0);
 });
 it('实际收益补录 CLI 默认不写入，应用及重复执行不修改旧账或业务计算',async()=>{
  await c.query('DELETE FROM opc_earning_lines');await c.query('DELETE FROM opc_earning_sources');
  const factsBefore=await q('SELECT * FROM zh_metric_facts ORDER BY id'),incomeBefore=await q('SELECT * FROM opc_income_entries ORDER BY id'),sourcesBefore=await q('SELECT * FROM opc_income_sources ORDER BY id'),statementsBefore=await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id");
  const args=['--import','tsx','scripts/backfill-earning-lines.ts','--project',scope.projectId,'--account',scope.accountId,'--actor',fin.sub];
  const cli=async(apply=false)=>JSON.parse((await promisify(execFile)(process.execPath,[...args,...(apply?['--apply']:[])],{env:process.env,windowsHide:true})).stdout);
  const preview=await cli();expect(preview.apply).toBe(false);expect(preview.records).toBe(factsBefore.filter(f=>f.current_result_id).length);expect(await q('SELECT * FROM opc_earning_sources')).toHaveLength(0);
  const applied=await cli(true);expect(applied.records).toBe(preview.records);const earningRows=await q('SELECT * FROM opc_earning_lines ORDER BY id');expect(earningRows.length).toBeGreaterThan(0);
  expect((await cli(true)).records).toBe(0);expect(await q('SELECT * FROM opc_earning_lines ORDER BY id')).toEqual(earningRows);
  expect(await q('SELECT * FROM zh_metric_facts ORDER BY id')).toEqual(factsBefore);expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(incomeBefore);expect(await q('SELECT * FROM opc_income_sources ORDER BY id')).toEqual(sourcesBefore);expect(await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id")).toEqual(statementsBefore);
  const {backfillEarnings}=await import('../../src/modules/zhihu/attribution/earning-backfill');await expect(backfillEarnings(ops,scope,true)).rejects.toThrow('这里需要财务权限');
 },30000);
 it('上传类型建议保留到 HTTP 错误响应，运营和达人不能绕过财务上传权限',async()=>{
  const buffer=Buffer.from(`日期,渠道名称,关键词,拉活量\n${day},联测渠道,联测词0,1`);
  const upload=(actor:AuthUser,reportType:string)=>request(app).post(path('/workbench/import')).set('X-Client-Id','workbench-client-'+actor.sub).set('Authorization','Bearer '+tokens[actor.sub]).field('projectId',scope.projectId).field('accountId',scope.accountId).field('reportType',reportType).attach('file',buffer,'拉活.csv');
  const wrong=await upload(fin,'new_user');expect(wrong.status,wrong.text).toBe(422);expect(wrong.body.extras).toEqual({suggestedType:'activation'});
  expect((await upload(ops,'activation')).status).toBe(403);
  expect((await upload(a,'activation')).status).toBe(403);
  const gated=await upload(fin,'activation');expect(gated.status,gated.text).toBe(503);expect(gated.body.message).toContain('拉活报表尚未开放');
 });
});

it('旧来源列表和明细向团长只返回本人净分成，达人及岗位越权仍被拒',async()=>{
 const [fact]=await q("SELECT f.id FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id WHERE k.keyword='联测词0' AND f.business_date=?",[day]);
 const response=await get(leader,path('/attributions/'+fact.id+'/trace'),scope);expect(response.status,response.text).toBe(200);
 expect(response.body.data.revisions).toEqual([]);
 for(const row of response.body.data.results){
  expect(row.obligations).toHaveLength(1);expect(row.obligations[0]).toMatchObject({payeeId:leader.sub,relation:'leader_override',unitPrice:'0.5000'});
  expect(row.teamMargin).toBe(row.obligations[0].amount);
  expect(row.obligations.some((o:{payeeId:string})=>o.payeeId===a.sub)).toBe(false);
 }
 const list=await get(leader,path('/attributions'),{...scope,page:1,pageSize:100});expect(list.status).toBe(200);
 expect(list.body.data.list.flatMap((r:{obligations:{payeeId:string}[]})=>r.obligations).every((o:{payeeId:string})=>o.payeeId===leader.sub)).toBe(true);
 const own=await get(a,path('/attributions/'+fact.id+'/trace'),scope);expect(own.status).toBe(200);expect(own.body.data.results[0].obligations[0].unitPrice).toBe('8.0000');
 for(const actor of [b,other,ops])expect((await get(actor,path('/attributions/'+fact.id+'/trace'),scope)).status).toBe(403);
});
it('同样计算结果重算后仍可提现，原确认账和资金逐行不变',async()=>{
 const word=await resource.createKeyword(admin,scope,key(),{keyword:'不变重算检查',taskId:'1',mappingId:mapping,landingUrl:'https://example.com/unchanged',popularizeType:1});
 await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?",['unchanged-'+word.id,word.planId]);await resource.synchronizeKeywords(scope);
 const bind=await resource.distribute(admin,scope,word.id,key(),a.sub);await resource.changeBinding(a,scope,bind.id,key(),{action:'activate'});
 const evidence=await statements.submitEvidence(a,scope,key(),{bindingId:bind.id,url:'https://example.com/unchanged-work',description:'不变结果测试'});await statements.reviewEvidence(leader,scope,evidence.id,key(),true,'已核验');
 const buffer=Buffer.from(`日期,渠道名称,关键词,订单量\n${day},联测渠道,不变重算检查,1`);await workbench.uploadReport(fin,scope,{buffer,size:buffer.length,originalname:'unchanged.csv',mimetype:'text/csv'});
 const view=await workbench.overview(fin,scope,{from:day,to:day});await workbench.confirmBills(fin,scope,{from:day,to:day},key(),view.reviewHash);
 const funding=await finance.financeOverview(fin,common());await finance.releaseFunding(fin,common(),funding.funding.hash,'隔离验证款项可用');
 const before=await finance.financeOverview(a,common()),[fact]=await q('SELECT * FROM zh_metric_facts WHERE keyword_id=?',[word.id]);
 const entries=await q('SELECT * FROM opc_income_entries ORDER BY id'),sources=await q('SELECT * FROM opc_income_sources ORDER BY id'),confirmed=await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id");
 await facts.recompute(fin,scope,String(fact.id));await facts.recompute(fin,scope,String(fact.id));
 expect((await q('SELECT * FROM zh_metric_facts WHERE id=?',[fact.id]))[0]).toEqual(fact);
 expect((await finance.financeOverview(a,common())).balance).toEqual(before.balance);
 expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(entries);expect(await q('SELECT * FROM opc_income_sources ORDER BY id')).toEqual(sources);expect(await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id")).toEqual(confirmed);
});

it('成员报价旧接口全部停用且保留历史表，运营和未登录读取仍被拒',async()=>{
 const agreements=await q('SELECT * FROM zh_price_agreements ORDER BY id'),versions=await q('SELECT * FROM zh_price_versions ORDER BY id');
 for(const actor of [admin,fin,leader,a]){
  const response=await get(actor,path('/price-agreements'),scope);expect(response.status).toBe(410);expect(response.body.message).toContain('平台计费规则');
 }
 expect((await get(ops,path('/price-agreements'),scope)).status).toBe(403);
 expect((await request(app).get(path('/price-agreements')).query(scope)).status).toBe(401);
 for(const suffix of ['/price-agreements','/price-versions/1/publish'])for(const actor of [admin,leader])expect((await post(actor,path(suffix),{...scope,requestKey:key()})).status).toBe(410);
 expect(await q('SELECT * FROM zh_price_agreements ORDER BY id')).toEqual(agreements);expect(await q('SELECT * FROM zh_price_versions ORDER BY id')).toEqual(versions);
 const mine=await get(a,path('/attribution-options'),scope);expect(mine.body.data.currentNewUserPrice).toBe('8.0000');
 for(const actor of [leader,ops])expect((await get(actor,path('/attribution-options'),scope)).body.data).not.toHaveProperty('currentNewUserPrice');
});
