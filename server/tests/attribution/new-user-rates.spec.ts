import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {MySqlContainer,type StartedMySqlContainer} from '@testcontainers/mysql';
import mysql,{type Connection} from 'mysql2/promise';
import {runOpcMigrations} from '../../scripts/opcMigrations';
import type {AuthUser} from '../../src/types';
vi.mock('../../src/modules/zhihu/queue',()=>({enqueue:vi.fn(async()=>({id:'isolated'}))}));
let container:StartedMySqlContainer,c:Connection,pool:typeof import('../../src/db').db;
let pricing:typeof import('../../src/modules/zhihu/attribution/pricing'),workbench:typeof import('../../src/modules/zhihu/attribution/workbench');
let withTransaction:typeof import('../../src/db').withTransaction;
const key=()=>crypto.randomUUID(),date='2026-09-14',scope={projectId:'1',accountId:''};
const user=(sub:string,role:AuthUser['role'],parentId:string|null=null):AuthUser=>({sub,role,parentId,displayName:'人员'+sub,username:'newrate'+sub,jti:key(),adminDuty:'all'});
const admin=user('1','admin'),leader=user('2','leader'),creator=user('3','creator','2'),direct=user('4','creator'),staffChild=user('5','creator','1');
const q=async(sql:string,args:unknown[]=[])=> (await c.query<mysql.RowDataPacket[]>(sql,args))[0];
const file=(text:string)=>{const buffer=Buffer.from(text);return{originalname:key()+'.csv',mimetype:'text/csv',buffer,size:buffer.length}};
const team={path_type:'team_creator',leader_id:'2',executor_id:'3'} as mysql.RowDataPacket;
const quote=(taskId='1',binding=team,day=date)=>withTransaction(conn=>pricing.quote(conn,scope,taskId,binding,day,'10'));
async function agreement(payer:AuthUser,payeeId:string,price:string,taskId='1'){
 const p=await pricing.draftPrice(payer,scope,key(),{taskId,payeeId,unitPrice:price,from:date,reason:'隔离测试'});
 await pricing.publishPrice(payer,scope,p.id,key());return p;
}
async function word(keyword:string,taskId='2'){
 const resources=await import('../../src/modules/zhihu/attribution/resources');
 const [mapping]=await q('SELECT id FROM zh_channel_mappings LIMIT 1');
 const k=await resources.createKeyword(admin,scope,key(),{keyword,taskId,mappingId:String(mapping.id),landingUrl:'https://example.com/rate',popularizeType:1});
 await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?",['rates-'+k.id,k.planId]);await resources.synchronizeKeywords(scope);
 const b=await resources.distribute(admin,scope,k.id,key(),creator.sub);await resources.changeBinding(creator,scope,b.id,key(),{action:'activate'});
 await c.query("UPDATE zh_keyword_bindings SET activated_on=?,verification_status='passed' WHERE id=?",[date,b.id]);
 return k;
}
beforeAll(async()=>{
 container=await new MySqlContainer('mysql:8.0').withDatabase('new_user_rates_test').withUsername('test').withUserPassword('isolated').withCommand(['--log-bin-trust-function-creators=1']).start();
 const target={host:container.getHost(),port:container.getPort(),database:container.getDatabase(),user:container.getUsername(),password:container.getUserPassword()};
 Object.assign(process.env,{DB_HOST:target.host,DB_PORT:String(target.port),DB_NAME:target.database,DB_USER:target.user,DB_PASS:target.password,OPC_MODULES:'zhihu'});
 await runOpcMigrations(target,['zhihu']);c=await mysql.createConnection(target);
 for(const actor of [admin,leader,creator,direct,staffChild])await c.query('INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(?,?,?,?,?,?)',[actor.sub,actor.username,'unused',actor.role,actor.displayName,actor.parentId]);
 await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,4),(1,5)');
 scope.accountId=String((await q('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
 await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'rates-channel',1,'单价测试渠道')");
 for(let id=1;id<=5;id++)await c.query('INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(?,1,?,?,NOW())',[id,'rates-'+id,'单价测试活动'+id]);
 pricing=await import('../../src/modules/zhihu/attribution/pricing');workbench=await import('../../src/modules/zhihu/attribution/workbench');({db:pool,withTransaction}=await import('../../src/db'));
 const resources=await import('../../src/modules/zhihu/attribution/resources');await resources.createMapping(admin,scope,key(),{channelId:'1',name:'单价测试渠道',from:date});
},90000);
afterAll(async()=>{if(pool)await pool.end();if(c)await c.end();if(container)await container.stop();});
it('新安装有四条拉新规则，重复种价不改变已设单价',async()=>{
 const rules=await q("SELECT rule_code,CAST(unit_price AS CHAR) price FROM opc_rate_rules WHERE metric_type='new_user' ORDER BY rule_code");
 expect(rules).toEqual([{rule_code:'creator',price:'8.0000'},{rule_code:'leader_override',price:'0.5000'},{rule_code:'leader_self',price:'8.5000'},{rule_code:'staff_self',price:'10.0000'}]);
 await c.query("UPDATE opc_rate_rules SET unit_price=7.7000 WHERE metric_type='new_user' AND rule_code='creator'");
 const before=await q('SELECT * FROM opc_rate_rules ORDER BY id'),seed=await readFile('schema/zhihu/031_new_user_rates.sql','utf8');
 await c.query(seed);await c.query(seed);expect(await q('SELECT * FROM opc_rate_rules ORDER BY id')).toEqual(before);
 await c.query("UPDATE opc_rate_rules SET unit_price=8 WHERE metric_type='new_user' AND rule_code='creator'");
});
it('无报价团队十单默认达人80、团长5，直属达人与团长本人分别使用角色价',async()=>{
 const values=await quote();expect(values.map(o=>[o.relation,o.amount,o.priceSource])).toEqual([['agency_creator','80.0000','role_rate'],['leader_override','5.0000','role_rate']]);
 expect(workbench.allocations({obligations:values} as import('../../src/modules/zhihu/attribution/facts').AttributionSnapshot).list).toEqual([{userId:'3',amount:'80.0000'},{userId:'2',amount:'5.0000'}]);
 expect(await quote('1',{path_type:'direct_creator',executor_id:'4'} as mysql.RowDataPacket)).toMatchObject([{amount:'80.0000',priceSource:'role_rate'}]);
 expect(await quote('1',{path_type:'leader_self',leader_id:'2',executor_id:'2'} as mysql.RowDataPacket)).toMatchObject([{amount:'85.0000',priceSource:'role_rate'}]);
 await expect(quote('1',team,'2025-12-31')).rejects.toThrow('PRICE_MISSING');
});
it('已有成员报价保留原值，新计算统一使用角色单价',async()=>{
 await agreement(admin,'2','9');
 expect((await quote()).map(o=>[o.amount,o.priceSource])).toEqual([['80.0000','role_rate'],['5.0000','role_rate']]);
 await agreement(leader,'3','8.2');
 const before=await q('SELECT * FROM zh_price_versions ORDER BY id');
 expect((await quote()).map(o=>[o.amount,o.priceSource])).toEqual([['80.0000','role_rate'],['5.0000','role_rate']]);
 expect(await q('SELECT * FROM zh_price_versions ORDER BY id')).toEqual(before);
});
it('上级为管理员的达人使用达人角色价，历史报价权限保持隔离',async()=>{
 await agreement(admin,'5','9.25');
 expect(await quote('1',{path_type:'direct_creator',executor_id:'5'} as mysql.RowDataPacket)).toMatchObject([{amount:'80.0000',priceSource:'role_rate'}]);
 await expect(pricing.draftPrice(creator,scope,key(),{taskId:'1',payeeId:'5',unitPrice:'1',from:date,reason:'越权'})).rejects.toThrow('达人无报价权限');
 await expect(pricing.draftPrice(leader,scope,key(),{taskId:'1',payeeId:'5',unitPrice:'1',from:date,reason:'越权'})).rejects.toThrow('当前付款关系不允许');
});
it('历史成员报价重叠不影响新规则，角色价重叠明确待处理',async()=>{
 const [p]=await q("SELECT v.* FROM zh_price_versions v JOIN zh_price_agreements a ON a.id=v.agreement_id WHERE a.task_id=1 AND a.relation_type='agency_leader'");
 const [insert]=await c.query<mysql.ResultSetHeader>("INSERT INTO zh_price_versions(agreement_id,unit_price,effective_from,status,created_by,reason,relationship_snapshot) VALUES(?,?,?,'published',1,'故障测试',JSON_OBJECT())",[p.agreement_id,p.unit_price,date]);
 try{expect((await quote()).map(o=>o.amount)).toEqual(['80.0000','5.0000']);}finally{await c.query('DELETE FROM zh_price_versions WHERE id=?',[insert.insertId]);}
 const [rate]=await c.query<mysql.ResultSetHeader>("INSERT INTO opc_rate_rules(project_id,module_id,metric_type,rule_code,unit_price,effective_from) VALUES(1,'zhihu','new_user','creator',7,?)",[date]);
 try{await expect(quote('2')).rejects.toThrow('PRICE_OVERLAP');}finally{await c.query('DELETE FROM opc_rate_rules WHERE id=?',[rate.insertId]);}
});
it('历史混合报价倒挂不再阻塞新计算，角色单价只展示本人收益',async()=>{
 await agreement(admin,'2','10','3');await agreement(leader,'3','9','3');
 await c.query("UPDATE zh_price_versions v JOIN zh_price_agreements a ON a.id=v.agreement_id SET v.status='draft' WHERE a.task_id=3 AND a.relation_type='agency_leader'");
 expect((await quote('3')).map(o=>o.amount)).toEqual(['80.0000','5.0000']);
 await word('默认单价');await word('混合单价倒挂','3');
 await workbench.uploadReport(admin,scope,file(`日期,渠道,关键词,订单量\n${date},单价测试渠道,默认单价,10\n${date},单价测试渠道,混合单价倒挂,10`));
 const view=await workbench.overview(admin,scope,{from:date,to:date});
 expect(view.summary).toMatchObject({billableOrders:'20',pendingOrders:'0',payable:'170.0000'});
 expect(view.entries.filter(e=>e.keyword==='混合单价倒挂').map(e=>e.amount)).toEqual(['80.0000','5.0000']);
 expect(view.entries.filter(e=>e.keyword==='默认单价').every(e=>e.priceSources?.join()==='role_rate')).toBe(true);
 const leaderView=await workbench.overview(leader,scope,{from:date,to:date});expect(leaderView.entries.every(e=>e.payeeId==='2')).toBe(true);expect(leaderView.summary.receivable).toBe('10.0000');
 await expect(workbench.overview({...admin,adminDuty:'operations'},scope,{from:date,to:date})).rejects.toThrow('这里需要财务权限');
});
it('历史计算结果出现负分配时只隔离该行，其他行仍可确认',async()=>{
 await word('旧结果倒挂','1');await workbench.uploadReport(admin,scope,file(`日期,渠道,关键词,订单量\n${date},单价测试渠道,旧结果倒挂,1`));
 const [r]=await q("SELECT r.id,r.snapshot_json FROM zh_attribution_results r JOIN zh_metric_facts f ON f.current_result_id=r.id JOIN zh_keywords k ON k.id=f.keyword_id WHERE k.keyword='旧结果倒挂'");
 const snapshot=typeof r.snapshot_json==='string'?JSON.parse(r.snapshot_json):r.snapshot_json;
 snapshot.obligations=await withTransaction(conn=>pricing.quoteLegacy(conn,scope,'1',team,date,'1'));snapshot.obligations[1].amount='20.0000';
 const {digest}=await import('../../src/modules/zhihu/attribution/domain');
 await c.query('UPDATE zh_attribution_results SET snapshot_json=?,input_hash=? WHERE id=?',[JSON.stringify(snapshot),digest({legacyInvalidSnapshot:snapshot}),r.id]);
 const view=await workbench.overview(admin,scope,{from:date,to:date});expect(view.entries.find(e=>e.keyword==='旧结果倒挂')).toMatchObject({amount:null,reason:'单价有冲突',ready:false});
 expect(view.summary.payable).toBe('170.0000');expect((await workbench.confirmBills(admin,scope,{from:date,to:date},key(),view.reviewHash)).confirmed).toBe(2);
});
it('实际修复 CLI 默认预览；只重算未确认缺价拉新，保留已确认账与拉活记录',async()=>{
 await c.query("UPDATE opc_rate_rules SET status='draft' WHERE metric_type='new_user'");
 await word('旧缺价待修复','4');await workbench.uploadReport(admin,scope,file(`日期,渠道,关键词,订单量\n${date},单价测试渠道,旧缺价待修复,2`));
 process.env.ZHIHU_ACTIVATION_ENABLED='true';
 try{await workbench.uploadReport(admin,scope,file(`日期,渠道,关键词,拉活量\n${date},单价测试渠道,旧缺价待修复,2`),'activation');}finally{delete process.env.ZHIHU_ACTIVATION_ENABLED;}
 const activationBefore=await q("SELECT * FROM zh_metric_facts WHERE metric_type='activation' ORDER BY id");
 await c.query("UPDATE opc_rate_rules SET status='published' WHERE metric_type='new_user'");
 await c.query("UPDATE zh_attribution_results r JOIN zh_metric_facts f ON f.current_result_id=r.id JOIN zh_keywords k ON k.id=f.keyword_id SET r.reason_code='PRICE_MISSING' WHERE k.keyword='默认单价'");
 const factRows=await q('SELECT * FROM zh_metric_facts ORDER BY id'),statements=await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id"),income=await q('SELECT * FROM opc_income_entries ORDER BY id');
 const args=['--import','tsx','scripts/fix-activated-on.ts','--project','1','--account',scope.accountId,'--actor','1','--prices-only'];
 const preview=JSON.parse((await promisify(execFile)(process.execPath,args,{env:process.env,windowsHide:true})).stdout);
 expect(preview.apply).toBe(false);expect(preview.changes.map((row:{keyword:string})=>row.keyword)).toEqual(['旧缺价待修复']);expect(await q('SELECT * FROM zh_metric_facts ORDER BY id')).toEqual(factRows);
 const applied=JSON.parse((await promisify(execFile)(process.execPath,[...args,'--apply'],{env:process.env,windowsHide:true})).stdout);
 expect(applied.changes.find((row:{keyword:string})=>row.keyword==='旧缺价待修复').after).toBeNull();
 const view=await workbench.overview(creator,scope,{from:date,to:date});expect(view.entries.find(e=>e.keyword==='旧缺价待修复')).toMatchObject({amount:'16.0000',priceSources:['role_rate']});
 expect(await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id")).toEqual(statements);expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(income);
 expect(await q("SELECT * FROM zh_metric_facts WHERE metric_type='activation' ORDER BY id")).toEqual(activationBefore);
 const [confirmed]=await q("SELECT f.* FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id WHERE k.keyword='默认单价'");expect(confirmed).toEqual(factRows.find(f=>String(f.id)===String(confirmed.id)));
 const {repairMissingPrices}=await import('../../src/modules/zhihu/attribution/price-repair');await expect(repairMissingPrices({...admin,adminDuty:'operations'},scope)).rejects.toThrow('这里需要财务权限');
},30000);

it('平台按单计算保持大整数精度并拒绝负数与小数数量',async()=>{
 const {quoteRate}=await import('../../src/core/rates');
 const rate={projectId:'1',moduleId:'zhihu',metricType:'new_user',ruleCode:'leader_override',date};
 expect(await withTransaction(conn=>quoteRate(conn,rate,'9007199254740993'))).toMatchObject({amount:'4503599627370496.5000'});
 for(const quantity of ['-1','1.5','1e3'])await expect(withTransaction(conn=>quoteRate(conn,rate,quantity))).rejects.toThrow('非负整数');
 expect(await withTransaction(conn=>quoteRate(conn,{...rate,projectId:'999'},'1'))).toBeNull();
});

it('角色价迁移 CLI 预览只读、失败回滚、执行可重入，已确认旧账及后续更正保留原价',async()=>{
 const facts=await import('../../src/modules/zhihu/attribution/facts');
 const {digest}=await import('../../src/modules/zhihu/attribution/domain');
 const {projectEarnings}=await import('../../src/modules/zhihu/attribution/earning-lines');
 await agreement(admin,'2','15','5');await agreement(leader,'3','13','5');
 async function legacyFact(keyword:string,quantity:string){
  await word(keyword,'5');await workbench.uploadReport(admin,scope,file(`日期,渠道,关键词,订单量\n${date},单价测试渠道,${keyword},${quantity}`));
  const [r]=await q('SELECT f.id fact_id,r.id,r.revision_id,r.snapshot_json FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id JOIN zh_attribution_results r ON r.id=f.current_result_id WHERE k.keyword=?',[keyword]);
  const s=typeof r.snapshot_json==='string'?JSON.parse(r.snapshot_json):r.snapshot_json,b=s.binding;
  // Reproduce the stored pre-P2 shape and hash without invoking the new quote path.
  const snapshot={metricType:s.metricType,date:s.date,keyword:s.keyword,orders:s.orders,search:s.search,revenue:s.revenue,
   binding:{id:b.id,leader_id:b.leader_id,executor_id:b.executor_id,path_type:b.path_type,version:b.version,verification_status:b.verification_status,relation:b.relation},
   obligations:await withTransaction(conn=>pricing.quoteLegacy(conn,scope,'5',team,date,quantity))};
  await c.query('UPDATE zh_attribution_results SET snapshot_json=?,input_hash=? WHERE id=?',[JSON.stringify(snapshot),digest({revision:String(r.revision_id),snapshot,code:null}),r.id]);
  await withTransaction(conn=>projectEarnings(conn,scope,String(r.fact_id)));
  return String(r.fact_id);
 }
 const confirmedId=await legacyFact('旧价已确认','10');
 let view=await workbench.overview(admin,scope,{from:date,to:date});await workbench.confirmBills(admin,scope,{from:date,to:date},key(),view.reviewHash);
 const finance=await import('../../src/core/finance'),common={...scope,moduleId:'zhihu'};
 const funding=await finance.financeOverview(admin,common);await finance.releaseFunding(admin,common,funding.funding.hash,'隔离旧账验证');
 const [frozenFact]=await q('SELECT * FROM zh_metric_facts WHERE id=?',[confirmedId]);
 const balance=(await finance.financeOverview(creator,common)).balance;
 const originalEntries=await q("SELECT * FROM zh_statement_entries WHERE fact_id=? AND status='confirmed' ORDER BY id",[confirmedId]);
 const originalSources=await q('SELECT * FROM opc_income_sources ORDER BY id'),originalCash=await q('SELECT * FROM opc_income_entries ORDER BY id');
 await facts.recompute(admin,scope,confirmedId);await facts.recompute(admin,scope,confirmedId);
 expect((await q('SELECT * FROM zh_metric_facts WHERE id=?',[confirmedId]))[0]).toEqual(frozenFact);
 expect((await finance.financeOverview(creator,common)).balance).toEqual(balance);
 expect(await q('SELECT * FROM opc_income_sources ORDER BY id')).toEqual(originalSources);expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(originalCash);
 const pendingId=await legacyFact('旧价待确认','12');
 const blockedWord=await word('日期待核实','5');
 await c.query("UPDATE zh_keyword_bindings SET activated_on='2026-09-15' WHERE keyword_id=?",[blockedWord.id]);
 await workbench.uploadReport(admin,scope,file(`日期,渠道,关键词,订单量\n${date},单价测试渠道,日期待核实,2`));
 const [blockedFact]=await q('SELECT * FROM zh_metric_facts WHERE keyword_id=?',[blockedWord.id]);
 const activationBefore=await q("SELECT * FROM zh_metric_facts WHERE metric_type='activation' ORDER BY id");
 const tables=['zh_metric_facts','zh_metric_revisions','zh_attribution_results','zh_statement_entries','opc_income_sources','opc_income_entries','opc_earning_sources','opc_earning_lines','zh_price_agreements','zh_price_versions'];
 const state=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,await q(`SELECT * FROM ${table} ORDER BY id`)])));
 const before=await state(),args=['--import','tsx','scripts/migrate-new-user-role-rates.ts','--project','1','--account',scope.accountId,'--actor','1'];
 const cli=async(apply=false)=>JSON.parse((await promisify(execFile)(process.execPath,apply?[...args,'--apply']:args,{env:process.env,windowsHide:true})).stdout);
 const preview=await cli();expect(preview.apply).toBe(false);expect(preview.changes.find((r:{factId:string})=>r.factId===pendingId)).toMatchObject({before:{total:'180.0000'},after:{total:'102.0000'},problem:null});
 expect(preview.changes.some((r:{factId:string})=>r.factId===confirmedId)).toBe(false);expect(await state()).toEqual(before);
 expect(preview.changes.some((r:{factId:string})=>r.factId===String(blockedFact.id))).toBe(false);
 await c.query(`CREATE TRIGGER reject_role_migration BEFORE INSERT ON zh_attribution_results FOR EACH ROW BEGIN IF NEW.fact_id=${pendingId} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated migration rollback'; END IF; END`);
 try{await expect(cli(true)).rejects.toThrow('isolated migration rollback');expect(await state()).toEqual(before);}finally{await c.query('DROP TRIGGER reject_role_migration');}
 const applied=await cli(true);expect(applied.records).toBe(preview.records);const repeated=await cli(true);expect(repeated.records,JSON.stringify(repeated)).toBe(0);
 expect((await q('SELECT * FROM zh_metric_facts WHERE id=?',[blockedFact.id]))[0]).toEqual(blockedFact);
 expect((await q('SELECT * FROM zh_metric_facts WHERE id=?',[confirmedId]))[0]).toEqual(frozenFact);
 expect(await q("SELECT * FROM zh_metric_facts WHERE metric_type='activation' ORDER BY id")).toEqual(activationBefore);
 expect(await q('SELECT * FROM opc_income_sources ORDER BY id')).toEqual(originalSources);expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(originalCash);
 const migrated=(await facts.trace(admin,scope,pendingId)).results[0];expect((migrated.obligations as {relation:string;amount:string}[]).map(o=>[o.relation,o.amount])).toEqual([['agency_creator','96.0000'],['leader_override','6.0000']]);
 const own=(await facts.trace(leader,scope,confirmedId)).results[0];expect(own.obligations).toMatchObject([{payeeId:'2',unitPrice:'2.0000',amount:'20.0000'}]);expect(own.obligations).toHaveLength(1);
 await expect(facts.trace(direct,scope,confirmedId)).rejects.toThrow('无权');
 const {migrateRolePrices}=await import('../../src/modules/zhihu/attribution/role-price-migration');
 await expect(migrateRolePrices({...admin,adminDuty:'operations'},scope,true)).rejects.toThrow('财务权限');
 await expect(migrateRolePrices(admin,{...scope,projectId:'999'},true)).rejects.toThrow();
 await workbench.uploadReport(admin,scope,file(`日期,渠道,关键词,订单量\n${date},单价测试渠道,旧价已确认,9`));
 const pending=(await facts.listExceptions(admin,scope,1,100,confirmedId)).list.find(r=>r.reason_code==='SOURCE_REVISION_PENDING'&&r.status==='open')!;
 await facts.acceptRevision(admin,scope,String(pending.revision_id),key(),String(pending.expected_revision_id),'核实数量更正');
 const corrected=(await facts.trace(admin,scope,confirmedId)).results[0];expect((corrected.obligations as {relation:string;unitPrice:string;amount:string}[]).map(o=>[o.relation,o.unitPrice,o.amount])).toEqual([['agency_leader','15.0000','135.0000'],['leader_creator','13.0000','117.0000']]);
 view=await workbench.overview(admin,scope,{from:date,to:date});await workbench.confirmBills(admin,scope,{from:date,to:date},key(),view.reviewHash);
 const confirmed=await q("SELECT * FROM zh_statement_entries WHERE fact_id=? AND status='confirmed' ORDER BY id",[confirmedId]);
 expect(confirmed.slice(0,2)).toEqual(originalEntries);expect(confirmed.slice(2).map(r=>String(r.amount)).sort()).toEqual(['-13.0000','-15.0000']);
 const oldCash=await q('SELECT * FROM opc_income_entries WHERE id IN (?) ORDER BY id',[originalCash.map(r=>r.id)]);expect(oldCash).toEqual(originalCash);
},45000);
