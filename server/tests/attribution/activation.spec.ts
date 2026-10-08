import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {MySqlContainer,type StartedMySqlContainer} from '@testcontainers/mysql';
import mysql,{type Connection} from 'mysql2/promise';
import {parseReport,REPORT_TEMPLATE_VERSION,REPORT_TEMPLATE_VERSION_ACTIVATION} from '../../src/modules/zhihu/attribution/report';
import {runOpcMigrations} from '../../scripts/opcMigrations';
import {runMigrations} from '../../scripts/migrationRunner';
import type {AuthUser} from '../../src/types';
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
 const admin=user('1','admin'),leader=user('2','leader'),creator=user('3','creator','2');
 let newUserFact='',newUserResult='',newUserRevision='',activationBatch='';
 const q=async(sql:string,args:unknown[]=[])=> (await c.query<mysql.RowDataPacket[]>(sql,args))[0];
 beforeAll(async()=>{
  container=await new MySqlContainer('mysql:8.0').withDatabase('activation_test').withUsername('test').withUserPassword('isolated').start();
  target={host:container.getHost(),port:container.getPort(),database:container.getDatabase(),user:container.getUsername(),password:container.getUserPassword()};
  Object.assign(process.env,{DB_HOST:target.host,DB_PORT:String(target.port),DB_NAME:target.database,DB_USER:target.user,DB_PASS:target.password,OPC_MODULES:'zhihu',ZHIHU_ACTIVATION_ENABLED:'true'});
  await runOpcMigrations(target,['zhihu']);c=await mysql.createConnection(target);
  for(const actor of [admin,leader,creator])await c.query('INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(?,?,?,?,?,?)',[actor.sub,actor.username,'unused',actor.role,actor.displayName,actor.parentId]);
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3)');
  scope.accountId=String((await q('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
  await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'activation-channel',1,'拉活测试渠道')");
  await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'activation-task','拉活活动',NOW())");
  const resources=await import('../../src/modules/zhihu/attribution/resources'),pricing=await import('../../src/modules/zhihu/attribution/pricing'),statements=await import('../../src/modules/zhihu/attribution/statements');
  workbench=await import('../../src/modules/zhihu/attribution/workbench');facts=await import('../../src/modules/zhihu/attribution/facts');pool=(await import('../../src/db')).db;
  const mapping=await resources.createMapping(admin,scope,key(),{channelId:'1',name:'拉活测试渠道',from:date});
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
});
