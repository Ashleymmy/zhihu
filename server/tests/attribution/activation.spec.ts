import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {MySqlContainer,type StartedMySqlContainer} from '@testcontainers/mysql';
import mysql,{type Connection} from 'mysql2/promise';
import {parseReport,REPORT_TEMPLATE_VERSION,REPORT_TEMPLATE_VERSION_ACTIVATION} from '../../src/modules/zhihu/attribution/report';
import {runOpcMigrations} from '../../scripts/opcMigrations';
import {runMigrations} from '../../scripts/migrationRunner';
import type {AuthUser} from '../../src/types';
import type {RecordRow} from '../../src/modules/zhihu/attribution/store';
vi.mock('../../src/modules/zhihu/queue',()=>({enqueue:vi.fn(async()=>({id:'isolated'}))}));
const file=(text:string,name='拉活.csv')=>{const buffer=Buffer.from(text);return{originalname:name,mimetype:'text/csv',buffer,size:buffer.length}};
const fixture=async(name:string)=>{const buffer=await readFile(path.resolve('tests/attribution/fixtures',name));return{originalname:name,mimetype:name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv',buffer,size:buffer.length}};
describe('拉活独立解析',()=>{
 it('XLSX 与 GBK CSV 的字段一致，使用独立模板版本',async()=>{
  const xlsx=await parseReport(await fixture('activation.xlsx'),'activation'),gbk=await parseReport(await fixture('activation-gbk.csv'),'activation');
  expect(xlsx.map(r=>r.value)).toEqual(gbk.map(r=>r.value));expect(xlsx.every(r=>r.error===null)).toBe(true);
  expect(xlsx[0].value).toMatchObject({date:'2026-09-14',keyword:'浩浩哑女',activations:'1',settlement:'2.0000',agency:'测试代理',orders:null});
  expect(REPORT_TEMPLATE_VERSION).toBe('zhihu-v3');expect(REPORT_TEMPLATE_VERSION_ACTIVATION).toBe('zhihu-activation-v1');
 });
 it('按别名优先级选择数量和具体金额，宽泛金额列不会抢占结算金额',async()=>{
  const rows=await parseReport(file('统计日期,渠道,关键字,激活量,拉活数,拉活量,金额,补贴金额,结算金额,机构名称\n2026年9月14日,渠道,词,99,88,1,300,200,2,代理'),'activation');
  expect(rows[0].value).toMatchObject({activations:'1',settlement:'2.0000',agency:'代理'});
  expect(rows[0].error).toBeNull();
 });
 it('类型选错时返回可操作的类型建议',async()=>{
  await expect(parseReport(file('结算日期,渠道,搜索词,拉活个数\n2026/9/14,渠道,词,1'),'order')).rejects.toMatchObject({httpStatus:422,extras:{extras:{suggestedType:'activation'}}});
  await expect(parseReport(file('日期,渠道,关键词,订单量\n2026/9/14,渠道,词,1'),'activation')).rejects.toMatchObject({httpStatus:422,extras:{extras:{suggestedType:'new_user'}}});
 });
 it('同表两种数量按选择读取，零数量保留，错误行和汇总行保留',async()=>{
  const source=file('日期,渠道,关键词,订单量,拉活量\n2026/9/14,渠道,词,3,0\n2026/9/14,渠道,错词,1,1.5\n合计,,,4,1.5');
  const activation=await parseReport(source,'activation'),orders=await parseReport(source,'order');
  expect(activation[0].value).toMatchObject({activations:'0',orders:null});expect(orders[0].value.orders).toBe('3');
  expect(activation[1].error).toBe('第 3 行拉活量不是整数');expect(activation[2].skipped).toBe(true);
 });
});

describe('拉新与拉活存储隔离',()=>{
 let container:StartedMySqlContainer,c:Connection,pool:typeof import('../../src/db').db,target:{host:string;port:number;database:string;user:string;password:string};
 let workbench:typeof import('../../src/modules/zhihu/attribution/workbench'),facts:typeof import('../../src/modules/zhihu/attribution/facts');
 const key=()=>crypto.randomUUID(),date='2026-09-14',scope={projectId:'1',accountId:''};
 const user=(sub:string,role:AuthUser['role'],parentId:string|null=null):AuthUser=>({sub,role,parentId,displayName:'人员'+sub,username:'activation'+sub,jti:key(),adminDuty:'all'});
 const admin=user('1','admin'),leader=user('2','leader'),creator=user('3','creator','2'),independent=user('4','creator'),staffChild=user('5','creator','1');
 let mappingId='';
 let newUserFact='',newUserResult='',newUserRevision='',activationBatch='';
 const q=async(sql:string,args:unknown[]=[])=> (await c.query<mysql.RowDataPacket[]>(sql,args))[0];
 beforeAll(async()=>{
  container=await new MySqlContainer('mysql:8.0').withDatabase('activation_test').withUsername('test').withUserPassword('isolated').start();
  target={host:container.getHost(),port:container.getPort(),database:container.getDatabase(),user:container.getUsername(),password:container.getUserPassword()};
  Object.assign(process.env,{DB_HOST:target.host,DB_PORT:String(target.port),DB_NAME:target.database,DB_USER:target.user,DB_PASS:target.password,OPC_MODULES:'zhihu',ZHIHU_ACTIVATION_ENABLED:'true'});
  await runOpcMigrations(target,['zhihu']);c=await mysql.createConnection(target);
  for(const actor of [admin,leader,creator,independent,staffChild])await c.query('INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(?,?,?,?,?,?)',[actor.sub,actor.username,'unused',actor.role,actor.displayName,actor.parentId]);
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,4),(1,5)');
  scope.accountId=String((await q('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
  await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'activation-channel',1,'拉活测试渠道')");
  await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'activation-task','拉活活动',NOW())");
  const resources=await import('../../src/modules/zhihu/attribution/resources'),pricing=await import('../../src/modules/zhihu/attribution/pricing'),statements=await import('../../src/modules/zhihu/attribution/statements');
  workbench=await import('../../src/modules/zhihu/attribution/workbench');facts=await import('../../src/modules/zhihu/attribution/facts');pool=(await import('../../src/db')).db;
  const mapping=await resources.createMapping(admin,scope,key(),{channelId:'1',name:'拉活测试渠道',from:date});
  mappingId=mapping.id;
  for(const [payer,payeeId,unitPrice] of [[admin,'2','8.5'],[leader,'3','8']] as const){const p=await pricing.draftPrice(payer,scope,key(),{taskId:'1',payeeId,unitPrice,from:date,reason:'隔离测试'});await pricing.publishPrice(payer,scope,p.id,key());}
  const k=await resources.createKeyword(admin,scope,key(),{keyword:'浩浩哑女',taskId:'1',mappingId:mapping.id,landingUrl:'https://example.com/activation',popularizeType:1});
  await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id='activation-plan' WHERE id=?",[k.planId]);await resources.synchronizeKeywords(scope);
  const binding=await resources.distribute(admin,scope,k.id,key(),creator.sub);await resources.changeBinding(creator,scope,binding.id,key(),{action:'activate'});
  await c.query('UPDATE zh_keyword_bindings SET activated_on=? WHERE id=?',[date,binding.id]);
  const e=await statements.submitEvidence(creator,scope,key(),{bindingId:binding.id,url:'https://example.com/work',description:'隔离测试作品'});await statements.reviewEvidence(admin,scope,e.id,key(),true,'已核验');
  await workbench.uploadReport(admin,scope,file(`日期,渠道名称,关键词,订单量\n${date},拉活测试渠道,浩浩哑女,3`));
  const view=await workbench.overview(admin,scope,{from:date,to:date});await workbench.confirmBills(admin,scope,{from:date,to:date},key(),view.reviewHash);
  const [f]=await q('SELECT id,current_result_id,current_revision_id FROM zh_metric_facts LIMIT 1');newUserFact=String(f.id);newUserResult=String(f.current_result_id);newUserRevision=String(f.current_revision_id);
 },90000);
 afterAll(async()=>{delete process.env.ZHIHU_ACTIVATION_ENABLED;if(pool)await pool.end();if(c)await c.end();if(container)await container.stop();});
 it('已确认拉新后上传同日同词拉活，事实与来源版本独立，旧账金额不变',async()=>{
  const before=await q('SELECT id,amount FROM opc_income_entries ORDER BY id');
  activationBatch=(await workbench.uploadReport(admin,scope,file(`日期,渠道名称,关键词,拉活量,结算金额\n${date},拉活测试渠道,浩浩哑女,5,10`),'activation')).id;
  const rows=await q('SELECT id,metric_type,current_result_id,current_revision_id FROM zh_metric_facts ORDER BY id');expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({metric_type:'new_user'});expect(String(rows[0].id)).toBe(newUserFact);expect(String(rows[0].current_result_id)).toBe(newUserResult);expect(String(rows[0].current_revision_id)).toBe(newUserRevision);
  expect(rows[1].metric_type).toBe('activation');
  const [revision]=await q('SELECT snapshot_json FROM zh_metric_revisions WHERE id=?',[rows[1].current_revision_id]);expect(typeof revision.snapshot_json==='string'?JSON.parse(revision.snapshot_json):revision.snapshot_json).toMatchObject({metricType:'activation',activations:'5',orders:null,settlement:'10.0000'});
  expect(await q('SELECT id,amount FROM opc_income_entries ORDER BY id')).toEqual(before);
  expect((await workbench.overview(admin,scope,{from:date,to:date})).summary.orders).toBe('3');
  const view=await workbench.overview(admin,scope,{from:date,to:date});
  expect(view.summary.byType.activation).toMatchObject({quantity:'5',billableQuantity:'5',payable:'8.0000',confirmedPayable:'0.0000'});
  expect(view.entries.filter(e=>e.metricType==='activation').map(e=>[e.payeeId,e.amount])).toEqual([['3','6.0000'],['2','2.0000']]);
  const leaderView=await workbench.overview(leader,scope,{from:date,to:date});
  expect(leaderView.entries.every(e=>e.payeeId==='2')).toBe(true);expect(leaderView.summary.byType.activation.receivable).toBe('2.0000');
  expect(leaderView.summary.receivable).toBe('1.5000');expect(leaderView.teamPerformance[0]).toMatchObject({orders:'3',commission:'1.5000',activations:'5',activationCommission:'2.0000'});
  expect(view.entries.filter(e=>e.metricType==='activation').every(e=>e.ready)).toBe(true);
 });
 it('拉活独立确认入账，两次确认不重复，拉新已确认金额不变',async()=>{
  const before=await q('SELECT id,amount FROM opc_income_entries ORDER BY id');
  const legacyPeriod={from:date,to:date,metricType:'new_user' as const};
  const legacy=await workbench.overview(admin,scope,legacyPeriod);
  expect((await workbench.confirmBills(admin,scope,legacyPeriod,key(),legacy.reviewHash)).confirmed).toBe(0);
  expect(await q('SELECT id,amount FROM opc_income_entries ORDER BY id')).toEqual(before);
  const view=await workbench.overview(admin,scope,{from:date,to:date});
  await expect(workbench.confirmBills(admin,scope,{from:date,to:date},key(),legacy.reviewHash)).rejects.toThrow('数据或审核状态已更新');
  expect((await workbench.confirmBills(admin,scope,{from:date,to:date},key(),view.reviewHash)).confirmed).toBe(1);
  const updated=await workbench.overview(admin,scope,{from:date,to:date});
  expect(updated.summary.confirmedPayable).toBe('25.5000');expect(updated.summary.byType.activation.confirmedPayable).toBe('8.0000');
  expect((await workbench.confirmBills(admin,scope,{from:date,to:date},key(),updated.reviewHash)).confirmed).toBe(0);
  const after=await q('SELECT id,amount FROM opc_income_entries ORDER BY id');expect(after.slice(0,before.length)).toEqual(before);expect(after).toHaveLength(before.length+2);
 });
 it('拉活重复导入复用报表，数量变化只产生拉活更正',async()=>{
  expect((await workbench.uploadReport(admin,scope,file(`日期,渠道名称,关键词,拉活量,结算金额\n${date},拉活测试渠道,浩浩哑女,5,10`),'activation')).id).toBe(activationBatch);
  await workbench.uploadReport(admin,scope,file(`日期,渠道名称,关键词,拉活量,结算金额\n${date},拉活测试渠道,浩浩哑女,6,12`),'activation');
  const revisions=await q("SELECT f.metric_type FROM zh_metric_revisions r JOIN zh_metric_facts f ON f.id=r.fact_id WHERE r.status='pending'");expect(revisions).toHaveLength(1);expect(revisions[0].metric_type).toBe('activation');
  expect(String((await q('SELECT current_result_id FROM zh_metric_facts WHERE id=?',[newUserFact]))[0].current_result_id)).toBe(newUserResult);
 });
 it('迁移重复执行保留双类型数据，旧插入仍默认为拉新',async()=>{
  await c.query("DELETE FROM schema_migrations WHERE name='029_metric_types.sql'");
  const rerun=await runMigrations(target,path.resolve('schema/zhihu'));expect(rerun.applied).toEqual(['029_metric_types.sql']);
  expect((await q('SELECT metric_type FROM zh_metric_facts ORDER BY id')).map(r=>r.metric_type)).toEqual(['new_user','activation']);
  const [definition]=await q("SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='zh_metric_facts' AND COLUMN_NAME='metric_type'");expect(definition.COLUMN_DEFAULT).toBe('new_user');
 });
 it('发布开关关闭时不接收新的拉活文件，拉新回归不受影响',async()=>{
  process.env.ZHIHU_ACTIVATION_ENABLED='false';
  await expect(workbench.uploadReport(admin,scope,file(`日期,渠道,关键词,拉活量\n${date},拉活测试渠道,浩浩哑女,9`),'activation')).rejects.toThrow('拉活报表尚未开放');
  expect((await q('SELECT COUNT(*) n FROM zh_import_batches'))[0].n).toBe(3);
  expect((await workbench.overview(admin,scope,{from:date,to:date})).summary.payable).toBe('25.5000');
  process.env.ZHIHU_ACTIVATION_ENABLED='true';
 });
 it('团长本人、独立达人、上级为管理员的达人分别计价，结算差异仅提示；未核验不入账',async()=>{
  const resources=await import('../../src/modules/zhihu/attribution/resources');
  for(const [actor,word,quantity,settlement] of [[leader,'团长拉活','2','3.00'],[independent,'独立拉活','3','6.00'],[staffChild,'直属拉活','1','2.00']] as const){
   const k=await resources.createKeyword(admin,scope,key(),{keyword:word,taskId:'1',mappingId,landingUrl:'https://example.com/activation',popularizeType:1});
   await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?",['plan-'+k.id,k.planId]);await resources.synchronizeKeywords(scope);
   const b=await resources.distribute(admin,scope,k.id,key(),actor.sub);
   if(actor.role==='leader')await resources.changeBinding(actor,scope,b.id,key(),{action:'assign',executorId:actor.sub});
   await resources.changeBinding(actor,scope,b.id,key(),{action:'activate'});await c.query('UPDATE zh_keyword_bindings SET activated_on=? WHERE id=?',[date,b.id]);
   await workbench.uploadReport(admin,scope,file(`日期,渠道,关键词,拉活量,结算金额\n${date},拉活测试渠道,${word},${quantity},${settlement}`),'activation');
  }
  const view=await workbench.overview(admin,scope,{from:date,to:date});
  expect(view.entries.find(e=>e.keyword==='团长拉活')).toMatchObject({amount:'3.2000',quantity:'2',settlementMismatch:{expected:'4.0000',actual:'3.0000'},ready:false,reasonCode:'WORK_MISSING'});
  expect(view.entries.find(e=>e.keyword==='独立拉活')).toMatchObject({amount:'3.6000',payeeId:'4',ready:false});
  expect(view.entries.find(e=>e.keyword==='直属拉活')).toMatchObject({amount:'1.2000',payeeId:'5',ready:false});
  expect((await workbench.overview(independent,scope,{from:date,to:date})).summary.byType.activation.receivable).toBe('3.6000');
  expect((await workbench.confirmBills(admin,scope,{from:date,to:date},key(),view.reviewHash)).confirmed).toBe(0);
  expect(view.summary.payable).toBe('25.5000');
 });
 it('角色单价按项目、类型及半开日期区间读取，缺价与重叠均不猜测',async()=>{
  const {rateFor}=await import('../../src/core/rates'),connection=await pool.getConnection();
  try{
   const s={projectId:'999',moduleId:'generic',metricType:'units',ruleCode:'creator',date:'2026-09-14'};
   expect(await rateFor(connection,s)).toBeNull();
   await c.query("INSERT INTO opc_rate_rules(project_id,module_id,metric_type,rule_code,unit_price,effective_from,effective_to) VALUES(999,'generic','units','creator',1.2345,'2026-09-14','2026-09-15')");
   expect(await rateFor(connection,s)).toBe('1.2345');expect(await rateFor(connection,{...s,date:'2026-09-15'})).toBeNull();expect(await rateFor(connection,{...s,metricType:'other'})).toBeNull();
   await c.query("INSERT INTO opc_rate_rules(project_id,module_id,metric_type,rule_code,unit_price,effective_from) VALUES(999,'generic','units','creator',9,'2026-09-14')");
   await expect(rateFor(connection,s)).rejects.toThrow('RATE_OVERLAP');
  }finally{connection.release();}
 });
 it('拉活缺价和重叠保留待办，管理员业绩不会分配到公共资金',async()=>{
  const {withTransaction}=await import('../../src/db'),{quoteActivation}=await import('../../src/modules/zhihu/attribution/activation-pricing');
  await withTransaction(async connection=>{
   const staff=await quoteActivation(connection,scope,{path_type:'staff_self',executor_id:'1'} as RecordRow,date,'2','4.0000');
   const result=workbench.allocations({date,keyword:'本人',orders:null,search:null,revenue:null,binding:null,metricType:'activation',activations:'2',...staff});
   expect(result).toEqual({total:'0.0000',staffAmount:'4.0000',list:[]});
  });
  const [fact]=await q("SELECT *,DATE_FORMAT(business_date,'%Y-%m-%d') business_day FROM zh_metric_facts WHERE keyword_id=(SELECT id FROM zh_keywords WHERE keyword='独立拉活')");
  await c.query("UPDATE opc_rate_rules SET status='draft' WHERE project_id=1 AND metric_type='activation' AND rule_code='creator'");
  await withTransaction(connection=>facts.attribute(connection,scope,fact));
  const missing=(await workbench.overview(admin,scope,{from:date,to:date})).entries.find(e=>e.keyword==='独立拉活');expect(missing).toMatchObject({amount:null,next:'财务：设置拉活单价'});
  await c.query("UPDATE opc_rate_rules SET status='published' WHERE project_id=1 AND metric_type='activation' AND rule_code='creator'");
  const [extra]=await c.query<mysql.ResultSetHeader>("INSERT INTO opc_rate_rules(project_id,module_id,metric_type,rule_code,unit_price,effective_from) VALUES(1,'zhihu','activation','creator',1.3,'2026-01-01')");
  await withTransaction(connection=>facts.attribute(connection,scope,fact));
  expect((await workbench.overview(admin,scope,{from:date,to:date})).entries.find(e=>e.keyword==='独立拉活')).toMatchObject({amount:null,reasonCode:'PRICE_OVERLAP'});
  await c.query('DELETE FROM opc_rate_rules WHERE id=?',[extra.insertId]);await withTransaction(connection=>facts.attribute(connection,scope,fact));
 });
 it('初始化单价重复执行不重复插入，也不改已有价格',async()=>{
  const sql=await readFile(path.resolve('schema/zhihu/030_activation_rates.sql'),'utf8');
  const before=await q("SELECT * FROM opc_rate_rules WHERE module_id='zhihu' ORDER BY id");expect(before.filter(r=>r.metric_type==='activation')).toHaveLength(5);expect(before.filter(r=>r.metric_type==='new_user')).toHaveLength(4);
  await c.query(sql);await c.query(sql);expect(await q("SELECT * FROM opc_rate_rules WHERE module_id='zhihu' ORDER BY id")).toEqual(before);
 });
 it('已确认拉活数量变动只追加更正，拉新账与已确认原行均保持不变',async()=>{
  const before=await q('SELECT id,amount FROM opc_income_entries ORDER BY id');
  const [revision]=await q("SELECT r.id,r.parent_revision_id FROM zh_metric_revisions r JOIN zh_metric_facts f ON f.id=r.fact_id WHERE r.status='pending' AND f.metric_type='activation'");
  await facts.acceptRevision(admin,scope,String(revision.id),key(),String(revision.parent_revision_id),'已核实为六个');
  const view=await workbench.overview(admin,scope,{from:date,to:date});
  expect(view.entries.find(e=>e.keyword==='浩浩哑女'&&e.metricType==='activation'&&e.payeeId==='3')).toMatchObject({amount:'7.2000',pendingAmount:'1.2000',kind:'adjustment'});
  expect((await workbench.confirmBills(admin,scope,{from:date,to:date},key(),view.reviewHash)).confirmed).toBe(1);
  const after=await q('SELECT id,amount FROM opc_income_entries ORDER BY id');expect(after.slice(0,before.length)).toEqual(before);expect(after.slice(before.length).map(r=>r.amount).sort()).toEqual(['0.4000','1.2000']);
  expect((await workbench.overview(admin,scope,{from:date,to:date})).summary.confirmedPayable).toBe('25.5000');
 });
});
