import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {MySqlContainer,type StartedMySqlContainer} from '@testcontainers/mysql';
import mysql,{type Connection} from 'mysql2/promise';
import type {AuthUser} from '../../src/types';
import {runOpcMigrations} from '../../scripts/opcMigrations';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
vi.mock('../../src/modules/zhihu/queue',()=>({enqueue:vi.fn(async()=>({id:'isolated'}))}));
let container:StartedMySqlContainer,c:Connection,pool:typeof import('../../src/db').db;
let resources:typeof import('../../src/modules/zhihu/attribution/resources'),facts:typeof import('../../src/modules/zhihu/attribution/facts'),workbench:typeof import('../../src/modules/zhihu/attribution/workbench');
const key=()=>crypto.randomUUID();
const user=(sub:string,role:AuthUser['role'],parentId:string|null=null):AuthUser=>({sub,username:'pending'+sub,displayName:'人员'+sub,role,parentId,jti:key(),adminDuty:'all'});
const admin=user('1','admin'),leader=user('2','leader'),creator=user('3','creator','2'),other=user('4','creator');
const scope={projectId:'1',accountId:''};
let date='',assigned='',sourceId='',missingFact='';
const q=async(sql:string,params:unknown[]=[])=> (await c.query<mysql.RowDataPacket[]>(sql,params))[0];
const csv=(body:string,name='待处理.csv')=>{const buffer=Buffer.from(body);return{buffer,size:buffer.length,originalname:name,mimetype:'text/csv'}};
beforeAll(async()=>{
 container=await new MySqlContainer('mysql:8.0').withDatabase('pending_bills_test').withUsername('test').withUserPassword('isolated').start();
 const target={host:container.getHost(),port:container.getPort(),database:container.getDatabase(),user:container.getUsername(),password:container.getUserPassword()};
 Object.assign(process.env,{DB_HOST:target.host,DB_PORT:String(target.port),DB_NAME:target.database,DB_USER:target.user,DB_PASS:target.password,OPC_MODULES:'zhihu'});
 await runOpcMigrations(target,['zhihu']);c=await mysql.createConnection(target);
 for(const actor of [admin,leader,creator,other])await c.query('INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(?,?,?,?,?,?)',[actor.sub,actor.username,'unused',actor.role,actor.displayName,actor.parentId]);
 await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,4)');
 scope.accountId=String((await q('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
 await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'pending-channel',1,'待处理渠道')");
 await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'pending-task','待处理活动',NOW())");
 resources=await import('../../src/modules/zhihu/attribution/resources');facts=await import('../../src/modules/zhihu/attribution/facts');workbench=await import('../../src/modules/zhihu/attribution/workbench');pool=(await import('../../src/db')).db;
 date=(await import('../../src/modules/zhihu/attribution/domain')).businessDay();
 const mapping=await resources.createMapping(admin,scope,key(),{channelId:'1',name:'待处理渠道',from:date});
 const pricing=await import('../../src/modules/zhihu/attribution/pricing');
 for(const [payer,payeeId,unitPrice] of [[admin,'2','8.5'],[leader,'3','8']] as const){const p=await pricing.draftPrice(payer,scope,key(),{taskId:'1',payeeId,unitPrice,from:date,reason:'隔离测试'});await pricing.publishPrice(payer,scope,p.id,key());}
 for(const word of ['未分配词','未开始词','团长预留词']){
  const k=await resources.createKeyword(admin,scope,key(),{keyword:word,taskId:'1',mappingId:mapping.id,landingUrl:'https://example.com/test',popularizeType:1});
  await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?",['external'+k.id,k.planId]);
  await resources.synchronizeKeywords(scope);
  if(word==='未开始词')assigned=(await resources.distribute(admin,scope,k.id,key(),creator.sub)).id;
  if(word==='团长预留词')await resources.claim(leader,scope,k.id,key());
 }
 const file=csv(`日期,渠道名称,关键词,订单量\n${date},待处理渠道,未分配词,5\n${date},待处理渠道,未开始词,3\n${date},待处理渠道,团长预留词,4\n${date},待处理渠道,未知词,2`);
 sourceId=(await workbench.uploadReport(admin,scope,file)).id;
},90000);
afterAll(async()=>{if(pool)await pool.end();if(c)await c.end();if(container)await container.stop();});
it('所有不能计费的记录都有原因和下一步，未知词数量单列并兼容旧汇总',async()=>{
 const view=await workbench.overview(admin,scope,{from:date,to:date});
 expect(view.summary).toMatchObject({records:4,orders:'12',totalOrders:'14',billableOrders:'0',pendingOrders:'14',payable:'0.0000'});
 expect(view.entries).toHaveLength(4);expect(view.entries.every(e=>e.status==='pending'&&e.amount===null&&!e.ready)).toBe(true);
 const missing=view.entries.find(e=>e.keyword==='未分配词')!;missingFact=missing.factId;
 expect(missing).toMatchObject({reason:'没有执行人',next:'运营：指定执行人'});
 expect(view.entries.find(e=>e.keyword==='未开始词')).toMatchObject({reason:'执行人还没开始',next:'达人 人员3：提交作品'});
 expect(view.entries.find(e=>e.keyword==='团长预留词')).toMatchObject({reason:'待分配',next:'团长 人员2：分配执行人'});
 expect(view.entries.find(e=>e.keyword==='未知词')).toMatchObject({reason:'系统里没有这个关键词',next:'运营：登记并指定执行人'});
 expect((await q("SELECT id FROM zh_exceptions WHERE fact_id=? AND reason_code='BINDING_MISSING' AND status='open'",[missingFact]))).toHaveLength(1);
 const inbox=(await facts.listExceptions(admin,scope,1,25)).list.find(e=>e.fact_id===missingFact)!;
 expect(inbox).toMatchObject({reason:'没有执行人',next:'运营：指定执行人',keyword:'未分配词'});
 await expect(facts.retryException(admin,scope,String(inbox.id),key(),'误点重试')).rejects.toThrow('补齐资料后自动更新');
});
it('同一未匹配来源重传不重复计数，原始行仍然全部保留',async()=>{
 await workbench.uploadReport(admin,scope,csv(`日期,渠道名称,关键词,订单量\n${date},待处理渠道,未知词,2\n合计,,,2`,'重复未知词.csv'));
 const view=await workbench.overview(admin,scope,{from:date,to:date});
 expect(view.summary.records).toBe(4);expect(view.summary.totalOrders).toBe('14');
 expect((await facts.importDetail(admin,scope,sourceId,1,25)).rows).toHaveLength(4);
});
it('未开始的达人和团长只看自己的待处理行，其他达人没有任何金额或待处理记录',async()=>{
 const own=await workbench.overview(creator,scope,{from:date,to:date});
 expect(own.entries).toHaveLength(1);expect(own.entries[0].payeeId).toBe(creator.sub);
 expect(own.groups).toEqual([]);
 const team=await workbench.overview(leader,scope,{from:date,to:date});
 expect(team.entries).toHaveLength(2);expect(team.entries.every(e=>e.payeeId===leader.sub)).toBe(true);
 expect((await workbench.overview(other,scope,{from:date,to:date})).entries).toEqual([]);
});
it('同一个问题不重复建待办；补齐后重算自动关闭待办，金额可算但没有作品仍不能确认',async()=>{
 await facts.recompute(admin,scope,missingFact);
 expect((await q("SELECT id FROM zh_exceptions WHERE fact_id=? AND reason_code='BINDING_MISSING' AND status='open'",[missingFact]))).toHaveLength(1);
 await resources.changeBinding(creator,scope,assigned,key(),{action:'activate'});
 const [f]=await q('SELECT f.id FROM zh_metric_facts f JOIN zh_keyword_bindings b ON b.keyword_id=f.keyword_id WHERE b.id=?',[assigned]);
 await facts.recompute(admin,scope,String(f.id));
 expect((await q("SELECT id FROM zh_exceptions WHERE fact_id=? AND status='open'",[f.id]))).toHaveLength(0);
 const view=await workbench.overview(admin,scope,{from:date,to:date});
 expect(view.summary).toMatchObject({totalOrders:'14',billableOrders:'3',pendingOrders:'11',payable:'25.5000'});
 expect(view.entries.filter(e=>e.keyword==='未开始词').map(e=>e.amount).sort()).toEqual(['1.5000','24.0000']);
 expect(view.entries.filter(e=>e.keyword==='未开始词').every(e=>!e.ready&&e.reason==='还没有登记作品')).toBe(true);
});
it('只有搜索数据时给出补传订单的下一步；订单到达后自动消除这条待办',async()=>{
 const [mapping]=await q('SELECT id FROM zh_channel_mappings LIMIT 1');
 const k=await resources.createKeyword(admin,scope,key(),{keyword:'搜索补传词',taskId:'1',mappingId:String(mapping.id),landingUrl:'https://example.com/search',popularizeType:1});
 await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id='external-search' WHERE id=?",[k.planId]);
 await resources.synchronizeKeywords(scope);
 const binding=await resources.distribute(admin,scope,k.id,key(),creator.sub);
 await resources.changeBinding(creator,scope,binding.id,key(),{action:'activate'});
 await workbench.uploadReport(admin,scope,csv(`日期,渠道名称,关键词,搜索量\n${date},待处理渠道,搜索补传词,100`,'只有搜索.csv'));
 let view=await workbench.overview(admin,scope,{from:date,to:date});
 const pending=view.entries.find(e=>e.keyword==='搜索补传词')!;
 expect(pending).toMatchObject({amount:null,reason:'只有搜索数据，没有订单',next:'财务：补传订单报表'});
 expect((await q("SELECT id FROM zh_exceptions WHERE fact_id=? AND status='open' AND reason_code='REPORT_INCOMPLETE'",[pending.factId]))).toHaveLength(1);
 await workbench.uploadReport(admin,scope,csv(`日期,渠道名称,关键词,订单量\n${date},待处理渠道,搜索补传词,4`,'补传订单.csv'));
 view=await workbench.overview(admin,scope,{from:date,to:date});
 expect(view.entries.filter(e=>e.keyword==='搜索补传词').map(e=>e.amount).sort()).toEqual(['2.0000','32.0000']);
 expect((await q("SELECT id FROM zh_exceptions WHERE fact_id=? AND status='open'",[pending.factId]))).toHaveLength(0);
});
it('同一个未知词匹配成功后，早先重复文件的待处理记录不重复计入总量',async()=>{
 const [mapping]=await q('SELECT id FROM zh_channel_mappings LIMIT 1');
 await resources.createKeyword(admin,scope,key(),{keyword:'未知词',taskId:'1',mappingId:String(mapping.id),landingUrl:'https://example.com/known',popularizeType:1});
 const [issue]=await q("SELECT id FROM zh_exceptions WHERE fact_id IS NULL AND reason_code='KEYWORD_UNKNOWN' AND status='open' ORDER BY id LIMIT 1");
 const retry=await facts.retryException(admin,scope,String(issue.id),key(),'隔离测试已登记关键词');
 await facts.processBatch(admin,scope,retry.batchId);
 const view=await workbench.overview(admin,scope,{from:date,to:date});
 expect(view.entries.filter(e=>e.keyword==='未知词')).toHaveLength(1);
 expect(view.entries.find(e=>e.keyword==='未知词')).toMatchObject({amount:null,reason:'没有执行人'});
 expect(view.summary).toMatchObject({records:5,totalOrders:'18',billableOrders:'7',pendingOrders:'11'});
});

it('只有报表的词可补录执行人，两类未确认金额自动计算，重复请求不重建归属',async()=>{
 const {assignRetro}=await import('../../src/modules/zhihu/attribution/retro-assignment');
 const word=(await resources.listKeywords(admin,scope,1,25,'未分配词')).list[0];
 expect(word).toMatchObject({read_only:0,can_assign_retro:1,retro_from_date:date});expect(word.lifecycle_status).not.toBe('historical');
 process.env.ZHIHU_ACTIVATION_ENABLED='true';
 try{await workbench.uploadReport(admin,scope,csv(`日期,渠道,关键词,拉活量\n${date},待处理渠道,未分配词,2`,'待补拉活.csv'),'activation');}finally{delete process.env.ZHIHU_ACTIVATION_ENABLED;}
 const requestKey=key(),assigned=await assignRetro(admin,scope,String(word.id),requestKey,{executorId:creator.sub});
 expect(assigned).toMatchObject({fromDate:date,recalculated:2,executorId:creator.sub});
 expect(await assignRetro(admin,scope,String(word.id),requestKey,{executorId:creator.sub})).toEqual(assigned);
 const view=await workbench.overview(admin,scope,{from:date,to:date});
 expect(view.entries.find(e=>e.keyword==='未分配词'&&e.metricType==='new_user'&&e.payeeId===creator.sub)).toMatchObject({amount:'40.0000',ready:false});
 expect(view.entries.find(e=>e.keyword==='未分配词'&&e.metricType==='activation'&&e.payeeId===creator.sub)).toMatchObject({amount:'2.4000',ready:false});
 expect((await q("SELECT id FROM zh_exceptions WHERE fact_id=? AND status='open'",[missingFact]))).toHaveLength(0);
 expect((await resources.listKeywords(admin,scope,1,25,'未分配词')).list[0]).toMatchObject({lifecycle_status:'active',executor_id:creator.sub,can_assign_retro:0});
});
it('团长预留转为本人执行时保留同一条归属，作品或现有执行人属于别人时拒绝',async()=>{
 const {assignRetro}=await import('../../src/modules/zhihu/attribution/retro-assignment');
 const word=(await resources.listKeywords(admin,scope,1,25,'团长预留词')).list[0];
 expect((await assignRetro(admin,scope,String(word.id),key(),{executorId:leader.sub})).id).toBe(word.binding_id);
 expect((await q('SELECT path_type FROM zh_keyword_bindings WHERE id=?',[word.binding_id]))[0].path_type).toBe('leader_self');
 await expect(assignRetro(admin,scope,String(word.id),key(),{executorId:creator.sub})).rejects.toThrow('这个关键词已有执行人 人员2，不能改给别人');
 const [mapping]=await q('SELECT id FROM zh_channel_mappings LIMIT 1');
 const owned=await resources.createKeyword(admin,scope,key(),{keyword:'别人的历史作品',taskId:'1',mappingId:String(mapping.id),landingUrl:'https://example.com/history',popularizeType:1});
 await c.query("INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,composition_sub_type,promo_url) VALUES(?,4,'KOC抖音','history',1,1,'https://example.com/history')",[owned.planId]);
 await expect(assignRetro(admin,scope,owned.id,key(),{executorId:creator.sub})).rejects.toThrow('这个关键词已有执行人 人员4，不能改给别人');
});
it('补录重算跳过已确认的两类记录，只计算未确认日期并保留全部已入账行',async()=>{
 const {assignRetro}=await import('../../src/modules/zhihu/attribution/retro-assignment'),statements=await import('../../src/modules/zhihu/attribution/statements');
 const word=(await resources.listKeywords(admin,scope,1,25,'未分配词')).list[0];
 const evidence=await statements.submitEvidence(creator,scope,key(),{bindingId:String(word.binding_id),url:'https://example.com/retro-work',description:'补录作品'});
 await statements.reviewEvidence(admin,scope,evidence.id,key(),true,'已核实');
 const view=await workbench.overview(admin,scope,{from:date,to:date});await workbench.confirmBills(admin,scope,{from:date,to:date},key(),view.reviewHash);
 const before=await q('SELECT id,current_result_id,current_revision_id FROM zh_metric_facts WHERE keyword_id=? ORDER BY id',[word.id]),ledger=await q('SELECT * FROM opc_income_entries ORDER BY id'),bills=await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id");
 const earlier=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 await c.query('UPDATE zh_channel_mappings SET effective_from=? WHERE account_id=? AND project_id=?',[earlier,scope.accountId,scope.projectId]);
 await workbench.uploadReport(admin,scope,csv(`日期,渠道,关键词,订单量\n${earlier},待处理渠道,未分配词,2`,'更早的未确认报表.csv'));
 // Simulate a restored record whose old assignment was released without losing its owner history.
 await c.query('UPDATE zh_keyword_bindings SET released_at=NOW(3) WHERE id=?',[word.binding_id]);await c.query('UPDATE zh_keywords SET current_binding_id=NULL WHERE id=?',[word.id]);
 const assigned=await assignRetro(admin,scope,String(word.id),key(),{executorId:creator.sub});expect(assigned).toMatchObject({fromDate:earlier,recalculated:1});
 expect((await q('SELECT id,current_result_id,current_revision_id FROM zh_metric_facts WHERE keyword_id=? ORDER BY id',[word.id])).slice(0,2)).toEqual(before);
 expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(ledger);expect(await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id")).toEqual(bills);
});

it('开始使用按分配日追溯，之前两天的订单自动恢复计费',async()=>{
 const {businessDay}=await import('../../src/modules/zhihu/attribution/domain');
 const beforeDay=businessDay(new Date(Date.now()-2*86400000));
 await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(2,1,'date-task','开始日测试',NOW())");
 const pricing=await import('../../src/modules/zhihu/attribution/pricing');
 for(const [payer,payeeId,unitPrice] of [[admin,'2','8.5'],[leader,'3','8']] as const){const p=await pricing.draftPrice(payer,scope,key(),{taskId:'2',payeeId,unitPrice,from:beforeDay,reason:'开始日测试报价'});await pricing.publishPrice(payer,scope,p.id,key());}
 const [mapping]=await q('SELECT id FROM zh_channel_mappings LIMIT 1');await c.query('UPDATE zh_channel_mappings SET effective_from=? WHERE id=?',[beforeDay,mapping.id]);
 const word=await resources.createKeyword(admin,scope,key(),{keyword:'按分配日起算',taskId:'2',mappingId:String(mapping.id),landingUrl:'https://example.com/date',popularizeType:1});
 await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id='start-day-plan' WHERE id=?",[word.planId]);await resources.synchronizeKeywords(scope);
 const binding=await resources.distribute(admin,scope,word.id,key(),creator.sub);
 await c.query('UPDATE zh_keyword_bindings SET assigned_at=? WHERE id=?',[beforeDay+' 12:00:00',binding.id]);
 const secondDay=businessDay(new Date(Date.now()-86400000));
 await workbench.uploadReport(admin,scope,csv(`日期,渠道,关键词,订单量\n${beforeDay},待处理渠道,按分配日起算,1\n${secondDay},待处理渠道,按分配日起算,2`,'分配日起算.csv'));
 await resources.changeBinding(creator,scope,binding.id,key(),{action:'activate'});
 expect((await q("SELECT DATE_FORMAT(activated_on,'%Y-%m-%d') d FROM zh_keyword_bindings WHERE id=?",[binding.id]))[0].d).toBe(beforeDay);
 const view=await workbench.overview(creator,scope,{from:beforeDay,to:secondDay});
 expect(view.entries.filter(e=>e.keyword==='按分配日起算').map(e=>e.amount)).toEqual(['8.0000','16.0000']);
});
it('首次作品的发布时间更早时按作品日开始，后续登记不会推后',async()=>{
 const {businessDay}=await import('../../src/modules/zhihu/attribution/domain'),{withTransaction}=await import('../../src/db');
 const {insertComposition}=await import('../../src/modules/zhihu/services/compositions.service');
 const earlier=businessDay(new Date(Date.now()-2*86400000));
 const [mapping]=await q('SELECT id FROM zh_channel_mappings LIMIT 1');
 const word=await resources.createKeyword(admin,scope,key(),{keyword:'作品更早起算',taskId:'2',mappingId:String(mapping.id),landingUrl:'https://example.com/work-day',popularizeType:1});
 await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id='work-day-plan' WHERE id=?",[word.planId]);await resources.synchronizeKeywords(scope);
 const binding=await resources.distribute(admin,scope,word.id,key(),creator.sub);
 await workbench.uploadReport(admin,scope,csv(`日期,渠道,关键词,订单量\n${earlier},待处理渠道,作品更早起算,3`,'作品日起算.csv'));
 await withTransaction(connection=>insertComposition(creator,{planId:word.planId,mediaType:'KOC抖音',mediaAccount:'date-test',compositionType:1,compositionSubType:1,title:'补登记作品',promoUrl:'https://www.douyin.com/video/7300000000000000002',releaseTime:earlier+'T12:00:00+08:00'},connection));
 expect((await q("SELECT DATE_FORMAT(activated_on,'%Y-%m-%d') d FROM zh_keyword_bindings WHERE id=?",[binding.id]))[0].d).toBe(earlier);
 const {bindingStartDay}=await import('../../src/modules/zhihu/attribution/activation-date');
 expect(await withTransaction(connection=>bindingStartDay(connection,binding.id,date))).toBe(earlier);
 expect((await workbench.overview(creator,scope,{from:earlier,to:date})).entries.find(e=>e.keyword==='作品更早起算')?.amount).toBe('24.0000');
});
it('修复脚本默认只预览，显式应用只提前日期、恢复未确认金额且保留已确认账',async()=>{
 const {businessDay}=await import('../../src/modules/zhihu/attribution/domain');
 const earlier=businessDay(new Date(Date.now()-2*86400000));
 const [word]=await q("SELECT k.id,k.current_binding_id FROM zh_keywords k WHERE k.keyword='按分配日起算'");
 await c.query('UPDATE zh_keyword_bindings SET activated_on=? WHERE id=?',[date,word.current_binding_id]);
 const targets=await q('SELECT id FROM zh_metric_facts WHERE keyword_id=?',[word.id]);for(const target of targets)await facts.recompute(admin,scope,String(target.id));
 const before=await q('SELECT id,activated_on,version FROM zh_keyword_bindings ORDER BY id'),bills=await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id"),ledger=await q('SELECT * FROM opc_income_entries ORDER BY id');
 const args=['--import','tsx','scripts/fix-activated-on.ts','--project',scope.projectId,'--account',scope.accountId,'--actor','1'];
 const preview=await promisify(execFile)(process.execPath,args,{env:process.env,windowsHide:true});
 const dry=JSON.parse(preview.stdout);expect(dry.apply).toBe(false);expect(dry.changes.some((change:{keyword:string;after:string})=>change.keyword==='按分配日起算'&&change.after===earlier)).toBe(true);
 expect(await q('SELECT id,activated_on,version FROM zh_keyword_bindings ORDER BY id')).toEqual(before);
 const applied=JSON.parse((await promisify(execFile)(process.execPath,[...args,'--apply'],{env:process.env,windowsHide:true})).stdout);
 expect(applied.apply).toBe(true);expect(applied.changes.find((change:{keyword:string})=>change.keyword==='按分配日起算').recalculated).toBe(2);
 console.info('ACTIVATION_DATE_REPAIR_REVIEW',JSON.stringify({preview:dry,applied}));
 expect((await workbench.overview(creator,scope,{from:earlier,to:date})).entries.filter(e=>e.keyword==='按分配日起算').map(e=>e.amount)).toEqual(['8.0000','16.0000']);
 expect(await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id")).toEqual(bills);expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(ledger);
 const repeated=JSON.parse((await promisify(execFile)(process.execPath,[...args,'--apply'],{env:process.env,windowsHide:true})).stdout);expect(repeated.changes).toEqual([]);
},30000);
