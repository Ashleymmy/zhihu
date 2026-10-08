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
const answer=(id:string,askId:string,option:string,u=ops,selection?:unknown,requestKey=key())=>request(app).post(endpoint(id)+'/answers').set(headers[u.sub]).send({...scope,askId,option,selection,requestKey});
beforeAll(async()=>{
 container=await new MySqlContainer('mysql:8.0').withCommand(['--log-bin-trust-function-creators=1']).withDatabase('name_matching_test').withUsername('test').withUserPassword('isolated').start();
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
afterAll(async()=>{if(pool)await pool.end();if(c)await c.end();if(container)await container.stop();});
const upload=async(day:string,channel:string,keyword:string,quantity='3')=>(await workbench.uploadReport(finance,scope,file(`日期,渠道,关键词,订单量,收益\n${day},${channel},${keyword},${quantity},987654.3210`))).id;
it('空白与全角字符仅用于名称比较，原始行和文件保持原样',async()=>{
 const text=`日期,渠道,关键词,订单量\n${date},分　析 渠道,分 析关　键词,3`,source=file(text),id=(await workbench.uploadReport(finance,scope,source)).id;
 const run=(await get(id)).body.data;expect(run).toMatchObject({status:'done',totals:{billableAmount:'24.0000'}});
 const detail=await facts.importDetail(finance,scope,id,1,25);expect(detail.rows[0].normalized_json).toMatchObject({channel:'分　析 渠道',keyword:'分 析关　键词'});
 expect((await facts.originalFile(finance,scope,id)).bytes.equals(source.buffer)).toBe(true);
 const {normalizedName}=await import('../../src/modules/zhihu/attribution/matching');expect(normalizedName(' ＡＢＣ　１２３ ')).toBe('ABC123');
});
it('字母大小写不同的关键词不会自动合并，全角同字才会匹配',async()=>{
 const resources=await import('../../src/modules/zhihu/attribution/resources');
 const word=await resources.createKeyword(admin,scope,key(),{keyword:'全角ABC',taskId:'1',mappingId,landingUrl:'https://example.com/width',popularizeType:1});
 const full=await upload('2026-09-24','分析渠道','全角ＡＢＣ'),lower=await upload('2026-09-24','分析渠道','全角abc');
 const [matched]=await q('SELECT f.keyword_id FROM zh_import_rows r JOIN zh_metric_facts f ON f.id=r.fact_id WHERE r.batch_id=?',[full]);expect(String(matched.keyword_id)).toBe(word.id);
 expect(await q('SELECT fact_id,error_text FROM zh_import_rows WHERE batch_id=?',[lower])).toEqual([{fact_id:null,error_text:'KEYWORD_UNKNOWN'}]);
});
it('相近名称不自动归属，运营逐步确认后同组行自动合并重算并记审计',async()=>{
 const text='日期,渠道,关键词,订单量,收益\n2026-09-15,分析渠到,分析关键字,3,987654.3210\n2026-09-15,分析渠到,分析关键字,3,987654.3210';
 const id=(await workbench.uploadReport(finance,scope,file(text))).id,original=await q('SELECT normalized_json,raw_json FROM zh_import_rows WHERE batch_id=? ORDER BY id',[id]);
 const run=(await get(id,ops)).body.data,channel=run.steps[1].asks[0];expect(channel.text).toContain('2 行');expect(channel.options[0].label).toBe('是「分析渠道」');expect(run.progress).toEqual({done:2,total:2});
 expect(run.steps[2].status).toBe('pending');expect(run.steps[3].status).toBe('pending');
 expect(await q('SELECT id FROM zh_metric_facts WHERE business_date=?',['2026-09-15'])).toHaveLength(0);
 expect((await get(id)).body.data.steps[1].asks[0].options.every((o:{disabled:boolean})=>o.disabled)).toBe(true);
 expect((await answer(id,channel.id,channel.options[0].key,finance)).status).toBe(403);
 const requestKey=key(),selected=await answer(id,channel.id,channel.options[0].key,ops,undefined,requestKey);expect(selected.status,selected.text).toBe(200);
 expect((await answer(id,channel.id,channel.options[0].key,ops,undefined,requestKey)).body.data).toEqual(selected.body.data);
 expect(selected.body.data.steps[1].status).toBe('done');const word=selected.body.data.steps[2].asks[0];expect(word.text).toContain('2 行');
 const done=await answer(id,word.id,word.options[0].key);expect(done.status,done.text).toBe(200);expect(done.body.data.steps[2].status).toBe('done');
 expect(JSON.stringify(done.body.data)).not.toMatch(/987654|revenue|settlement|¥/);
 expect((await get(id)).body.data.totals.billableAmount).toBe('24.0000');
 expect(await q('SELECT normalized_json,raw_json FROM zh_import_rows WHERE batch_id=? ORDER BY id',[id])).toEqual(original);
 expect(await q("SELECT DATE_FORMAT(effective_from,'%Y-%m-%d') start,canonical_id FROM zh_channel_mappings WHERE channel_name='分析渠到'")).toEqual([{start:'2026-09-15',canonical_id:Number(mappingId)}]);
 expect(await q("SELECT e.id FROM zh_exceptions e JOIN zh_import_rows r ON r.id=e.source_row_id WHERE r.batch_id=? AND e.status='open'",[id])).toHaveLength(0);
 expect(await q('SELECT * FROM zh_import_row_matches')).toHaveLength(2);
 const next=await upload('2026-09-16','分析渠到','分析关键词');expect((await get(next)).body.data.steps[1].status).toBe('done');
});
it('关键词跳过与行级选择可重复迁移，越权和其他报表的选项不能执行',async()=>{
 const id=await upload('2026-09-17','分析渠道','分析关键字'),other=await upload('2026-09-18','分析渠道','分析关键字');
 const ask=(await get(id,ops)).body.data.steps[2].asks[0],before=await q('SELECT * FROM zh_import_rows WHERE batch_id=?',[id]);
 expect((await answer(id,ask.id,'skip')).status).toBe(200);expect((await get(id,ops)).body.data.steps[2].status).toBe('skipped');
 expect(await q('SELECT * FROM zh_import_rows WHERE batch_id=?',[id])).toEqual(before);
 expect((await answer(other,ask.id,ask.options[0].key)).status).toBe(409);
 expect((await answer(id,ask.id,'keyword:999999')).status).toBe(409);
 for(const actor of [finance,creator,leader])expect((await answer(id,ask.id,ask.options[0].key,actor)).status).toBe(403);
 expect((await request(app).post(endpoint(id)+'/answers').set(headers[ops.sub]).send({...scope,projectId:'999',askId:ask.id,option:ask.options[0].key,requestKey:key()})).status).toBe(403);
 const tables=['zh_import_row_matches','zh_metric_facts','zh_metric_revisions','zh_statement_entries','opc_income_entries'];
 const snapshots=await Promise.all(tables.map(table=>q('SELECT * FROM '+table)));
 const migration=await readFile('schema/zhihu/032_report_name_choices.sql','utf8');await c.query(migration);await c.query(migration);
 expect(await Promise.all(tables.map(table=>q('SELECT * FROM '+table)))).toEqual(snapshots);
 expect((await answer(id,ask.id,ask.options[0].key)).status).toBe(200);expect((await answer(id,ask.id,ask.options[0].key)).status).toBe(409);
});
it('运营的分析和待办只含安全字段，原始报表及金额追溯接口拒绝读取',async()=>{
 const id=await upload('2026-09-19','分析渠道','分析关键字');
 for(const path of [endpoint(id),endpoint(id)+'/file','/api/v1/modules/zhihu/attributions','/api/v1/modules/zhihu/attributions/1/trace','/api/v1/modules/zhihu/price-agreements','/api/v1/modules/zhihu/statements']){
   const res=await request(app).get(path).set(headers[ops.sub]).query(scope);expect(res.status,path+res.text).toBe(403);
 }
 const res=await request(app).get('/api/v1/modules/zhihu/exceptions').set(headers[ops.sub]).query({...scope,pageSize:100});expect(res.status,res.text).toBe(200);
 expect(JSON.stringify(res.body.data)).not.toMatch(/987654|revenue|settlement|agencyMargin/);expect(res.body.data.list.some((i:{batchId:string})=>i.batchId===id)).toBe(true);
});
it('选择过程失败时资料、行状态、审计和已保存的回答全部回滚',async()=>{
 const id=await upload('2026-09-23','失败测试新渠道','待登记词'),ask=(await get(id,ops)).body.data.steps[1].asks[0];
 const tables=['channels','zh_channel_mappings','zh_import_rows','zh_import_row_matches','opc_analysis_answers'];
 const before=await Promise.all(tables.map(table=>q('SELECT * FROM '+table)));
 await c.query("CREATE TRIGGER test_reject_name_choice BEFORE INSERT ON zh_import_row_matches FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated rollback check'");
 try{expect((await answer(id,ask.id,'other-channel',ops,{upstreamId:'rollback-channel',generation:1})).status).toBe(500);}finally{await c.query('DROP TRIGGER test_reject_name_choice');}
 expect(await Promise.all(tables.map(table=>q('SELECT * FROM '+table)))).toEqual(before);
 expect((await get(id,ops)).body.data.steps[1].asks[0].id).toBe(ask.id);
});
it('新渠道与现有渠道可在当前分析中登记，使用报表日期且不推送上游',async()=>{
 const id=await upload('2026-09-20','全新业务基地','全新历史词'),ask=(await get(id,ops)).body.data.steps[1].asks[0];
 expect(ask.options).toEqual([{key:'other-channel',label:'其他或新渠道',disabled:false}]);
 const denied=await answer(id,ask.id,'other-channel',ops,{channelId:'999999'});expect(denied.status).toBe(409);
 const response=await answer(id,ask.id,'other-channel',ops,{upstreamId:'new-local-channel',generation:1});expect(response.status,response.text).toBe(200);
 expect(response.body.data.steps[1].status).toBe('done');expect(response.body.data.steps[2].status).toBe('ask');
 expect(await q("SELECT DATE_FORMAT(effective_from,'%Y-%m-%d') start FROM zh_channel_mappings WHERE channel_name='全新业务基地'")).toEqual([{start:'2026-09-20'}]);
 await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(30,1,'local-existing',1,'另一渠道')");
 const second=await upload('2026-09-21','填报名称差别很大','全新历史词'),other=(await get(second,ops)).body.data.steps[1].asks[0];
 expect((await answer(second,other.id,'other-channel',ops,{channelId:'30'})).status).toBe(200);
 expect(await q("SELECT channel_id,DATE_FORMAT(effective_from,'%Y-%m-%d') start FROM zh_channel_mappings WHERE channel_id=30")).toEqual([{channel_id:30,start:'2026-09-21'}]);
});
it('名称归一化后有歧义时仍必须选择，原映射与已确认资金一律不改',async()=>{
 const before=await workbench.overview(finance,scope,{from:date,to:date});await workbench.confirmBills(finance,scope,{from:date,to:date},key(),before.reviewHash);
 const bills=await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id"),income=await q('SELECT * FROM opc_income_entries ORDER BY id');
 await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(40,1,'ambiguous',1,'分析渠道二')");
 await c.query("INSERT INTO zh_channel_mappings(account_id,project_id,channel_id,channel_name,effective_from,created_by) VALUES(?,1,40,'分析 渠道','2026-09-01',1)",[scope.accountId]);
 const mappings=await q('SELECT * FROM zh_channel_mappings ORDER BY id'),id=await upload('2026-09-22','分析渠道','分析关键词');
 const ask=(await get(id,ops)).body.data.steps[1].asks[0];expect(ask.options.filter((o:{key:string})=>o.key.startsWith('channel:'))).toHaveLength(2);
 expect((await answer(id,ask.id,'channel:'+mappingId)).status).toBe(200);
 expect(await q('SELECT * FROM zh_channel_mappings ORDER BY id')).toEqual(mappings);
 expect(await q("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id")).toEqual(bills);expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(income);
 const [fact]=await q('SELECT keyword_id FROM zh_metric_facts WHERE business_date=?',['2026-09-22']);expect(String(fact.keyword_id)).toBe(wordId);
});
it('首次为既有渠道建名称时采用最早关键词日期',async()=>{
 await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(50,1,'old-plans',1,'最早关键词渠道')");
 const [plan]=await q('SELECT plan_id FROM zh_keywords WHERE id=?',[wordId]);
 await c.query("UPDATE plans SET channel_id='old-plans',created_at='2026-08-01 12:00:00' WHERE id=?",[plan.plan_id]);
 const {ensurePoolMapping}=await import('../../src/modules/zhihu/attribution/plan-pool'),connection=await pool.getConnection();
 try{const id=await ensurePoolMapping(connection,ops,scope,'50');expect(await q("SELECT DATE_FORMAT(effective_from,'%Y-%m-%d') start FROM zh_channel_mappings WHERE id=?",[id])).toEqual([{start:'2026-08-01'}]);}finally{connection.release();}
});
