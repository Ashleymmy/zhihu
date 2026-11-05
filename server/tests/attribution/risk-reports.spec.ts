import {beforeAll,afterAll,it,expect} from 'vitest';
import {MySqlContainer,type StartedMySqlContainer} from '@testcontainers/mysql';
import mysql,{type Connection, type RowDataPacket} from 'mysql2/promise';
import request from 'supertest';
import type {Express} from 'express';
import {http,HttpResponse} from 'msw';
import {setupServer} from 'msw/node';
import {runOpcMigrations} from '../../scripts/opcMigrations';
import type {AuthUser} from '../../src/types';
import {buildSignature} from '../../src/modules/zhihu/sign/zhihu';
import {resolvePublicEndpoint} from '../../src/modules/zhihu/zhihu/allianceEndpointRegistry';
let container:StartedMySqlContainer,c:Connection,pool:typeof import('../../src/db').db,app:Express;
const scope={projectId:'1',accountId:'1'},headers:Record<string,Record<string,string>>={};
const key=()=>crypto.randomUUID(),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGQAAAABJRU5ErkJggg==','base64');
const actors=[['1','admin','all'],['2','admin','operations'],['3','developer','all'],['4','admin','finance'],['5','operator','operations'],['6','leader','all'],['7','creator','all']] as const;
const captures:{method:string;payload:Record<string,unknown>;header?:string|null}[]=[];
let sequence=0,sendMode='success',listMode='success';
const upstream=setupServer(
 http.get('https://open.zhihu.com/alliance/api/risk_words',({request})=>{
  const payload=Object.fromEntries(new URL(request.url).searchParams);captures.push({method:'GET',payload});
  if(payload.status!==undefined && !['0','1','2'].includes(payload.status))return HttpResponse.json({error:{code:400400,message:'status is invalid'}},{status:400});
  if(listMode==='fail')return HttpResponse.json({error:{message:'SECRET upstream failure'}},{status:503});
  return HttpResponse.json({data:[0,1,2,9].map(status=>({keyword:'风险词'+status,type:Number(payload.type),risk_type:1,status,channel:'渠道甲',create_channel:'渠道乙',valided_at:status===1?'2026-11-05 12:00:00':''})),pagination:{is_first:true,is_end:false,offset:Number(payload.offset),limit:Number(payload.limit),total:24}});
 }),
 http.post('https://open.zhihu.com/alliance/api/basic/file_upload',async({request})=>{
  const form=await request.formData(),payload:Record<string,unknown>={};
  for(const [k,v]of form.entries())payload[k]=typeof v==='string'?v:{type:v.type,size:v.size};
  captures.push({method:'UPLOAD',payload,header:request.headers.get('x-requested-with')});
  return HttpResponse.json({success:true,data:{file_token:'evidence-'+(++sequence),file_url:'https://pic1.zhimg.com/example.png'}});
 }),
 http.post('https://open.zhihu.com/alliance/api/risk_words',async({request})=>{
  captures.push({method:'POST',payload:await request.json() as Record<string,unknown>});
  if(sendMode==='unknown')return HttpResponse.error();
  if(sendMode==='rejected')return HttpResponse.json({success:false,error:{message:'SECRET rejection'}});
  if(sendMode==='malformed')return HttpResponse.json({data:''});
  return HttpResponse.json({success:true,data:'',msg:'操作成功'});
 }),
);
const url=(tail='')=>'/api/v1/modules/zhihu/risk-reports'+tail;
const get=(tail='',actor='1',extra={})=>request(app).get(url(tail)).set(headers[actor]).query({...scope,...extra});
const upload=(actor='1',data=png,type='image/png',extra={})=>request(app).post(url('/images')).set(headers[actor]).query({...scope,...extra}).attach('file',data,{filename:'evidence.png',contentType:type});
const send=(report:object,actor='1',requestKey=key(),extra={})=>request(app).post(url()).set(headers[actor]).send({...scope,requestKey,report,...extra});
const retry=(r:any,actor='1',checkedNotReceived=false)=>request(app).post(url('/'+r.id+'/retry')).set(headers[actor]).send({...scope,attempt:r.attempt,checkedNotReceived});
const input=(imageId:string,keyword:string=key())=>({compositionId:'1',keyword,riskType:1,imageIds:[imageId]});
const q=async(sql:string,args:unknown[]=[])=> (await c.query<RowDataPacket[]>(sql,args))[0];
beforeAll(async()=>{
 container=await new MySqlContainer('mysql:8.0').withDatabase('risk_reports_isolated').withUsername('test').withUserPassword('isolated').start();
 const target={host:container.getHost(),port:container.getPort(),database:container.getDatabase(),user:container.getUsername(),password:container.getUserPassword()};
 Object.assign(process.env,{DB_HOST:target.host,DB_PORT:String(target.port),DB_NAME:target.database,DB_USER:target.user,DB_PASS:target.password,OPC_MODULES:'zhihu',ZHIHU_ACCESS_TOKEN:'risk_test_token',ZHIHU_SECRET_KEY:'risk_test_secret',DEV_DEMO_AUTH:'0'});
 await runOpcMigrations(target,['zhihu']);c=await mysql.createConnection(target);
 for(const [id,role,duty]of actors)await c.query('INSERT INTO users(id,username,password_hash,role,display_name,admin_duty) VALUES(?,?,?,?,?,?)',[id,'risk'+id,'unused',role,'测试'+id,duty]);
 await c.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES(1,6,'member'),(1,7,'member')");
 await c.query("INSERT INTO plans(id,project_id,keyword,channel_id,zhihu_task_id,landing_url,popularize_type,owner_id,created_by,sync_status,zhihu_plan_id) VALUES(1,1,'受损作品词','channel','task','https://example.com/story',1,7,1,'synced','9001')");
 await c.query("INSERT INTO compositions(id,plan_id,owner_id,zhihu_composition_id,media_type,media_account,composition_type,composition_sub_type,title,promo_url,sync_status) VALUES(1,1,7,'2071000000000000001',1,'account',1,1,'原作品','https://example.com/work','synced'),(2,1,7,NULL,1,'account',1,1,'失败作品','https://example.com/failed','failed')");
 await c.query("INSERT INTO projects(id,name,slug) VALUES(2,'其他项目','other-risk')");
 await c.query("INSERT INTO integration_accounts(id,module_id,account_key,name) VALUES(2,'zhihu','unconfigured','其他来源')");
 await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(2,2)');
 const {ModuleRuntime}=await import('../../src/core/module-runtime'),{zhihuManifest}=await import('../../src/modules/zhihu/manifest'),{createZhihuModule}=await import('../../src/modules/zhihu/module'),{createCoreApp}=await import('../../src/core/app');
 const runtime=new ModuleRuntime([zhihuManifest]);runtime.register(createZhihuModule());app=createCoreApp(runtime);pool=(await import('../../src/db')).db;
 const {signToken}=await import('../../src/auth/jwt'),{issueRefreshSession}=await import('../../src/auth/tokenSessions');
 for(const [id,role,adminDuty] of actors){const client='risk-report-client-'+id,session=await issueRefreshSession(id,{type:'web',id:client});const actor:AuthUser={sub:id,role,adminDuty,parentId:null,displayName:'测试'+id,username:'risk'+id,jti:key()};headers[id]={'X-Client-Id':client,Authorization:'Bearer '+await signToken({...actor,id,sessionId:session.familyId})};}
 upstream.listen({onUnhandledRequest(req,print){if(new URL(req.url).hostname==='open.zhihu.com')print.error();}});
},90000);
afterAll(async()=>{upstream.close();if(pool)await pool.end();if(c)await c.end();if(container)await container.stop();});

it('管理范围覆盖读写及旧接口，拒绝财务、普通运营、团长和达人',async()=>{
 for(const actor of ['4','5','6','7']){
  for(const tail of ['','/works','/history'])expect((await get(tail,actor)).status).toBe(403);
  expect((await upload(actor)).status).toBe(403);
  expect((await send(input(key()),actor)).status).toBe(403);
  expect((await retry({id:key(),attempt:1},actor,true)).status).toBe(403);
  expect((await request(app).get('/api/v1/modules/zhihu/zhihu-content/risk-words').set(headers[actor]).query(scope)).status).toBe(403);
 }
 for(const actor of ['1','2','3'])expect((await get('',actor)).status).toBe(200);
 expect(resolvePublicEndpoint('POST','/risk_words')).toBeUndefined();expect(resolvePublicEndpoint('POST','/basic/file_upload')).toBeUndefined();
});
it('检查项目和来源，不借用默认凭证，只有已成功提交作品可选择',async()=>{
 expect((await get('','1',{projectId:'999'})).status).toBe(403);
 expect((await get('','1',{projectId:'2',accountId:'2'})).status).toBe(409);
 expect((await get('/works')).body.data.list.map((r:any)=>r.id)).toEqual(['1']);
 const image=(await upload()).body.data.id;
 expect((await send({...input(image),compositionId:'2'})).status).toBe(422);
 expect((await send({...input(image),compositionId:'999'})).status).toBe(422);
 expect((await send(input(image),'1',key(),{projectId:'2',accountId:'2'})).status).toBe(409);
});
it('查询筛选 1/2/3 转成实测 0/1/2，响应状态分开显示，未知值不冒充审核中',async()=>{
 const r=await get('','1',{type:0,risk_type:2,status:2,offset:20,limit:20});expect(r.status,r.text).toBe(200);
 expect(r.body.data.list.map((x:any)=>x.status)).toEqual(['reviewing','violation','normal','unknown']);expect(r.body.data.hasNext).toBe(true);
 const last=captures.at(-1)!.payload;expect(last).toMatchObject({type:'0',risk_type:'2',status:'1',offset:'20',limit:'20',access_token:'risk_test_token'});
 expect(last).not.toHaveProperty('signature');expect(last).not.toHaveProperty('projectId');
 for(const status of [1,2,3]){expect((await get('','1',{status})).status).toBe(200);expect(captures.at(-1)!.payload.status).toBe(String(status-1));}
 const legacy=await request(app).get('/api/v1/modules/zhihu/zhihu-content/risk-words').set(headers['1']).query({...scope,status:3});
 expect(legacy.status,legacy.text).toBe(200);expect(captures.at(-1)!.payload.status).toBe('2');
 expect((await get('','1',{status:0})).status).toBe(422);
 listMode='fail';const bad=await get();listMode='success';expect(bad.status).toBe(502);expect(bad.text).not.toContain('SECRET');expect(bad.body.data).not.toEqual({list:[]});
});
it('截图检查格式、大小、数量；签名不含二进制，凭证不返回浏览器',async()=>{
 for(const [data,type]of [[Buffer.from('<svg>evil</svg>'),'image/png'],[png,'text/plain'],[Buffer.alloc(2*1024*1024+1),'image/png']] as const)expect((await upload('1',data,type)).status).toBe(422);
 const image=await upload();expect(image.status,image.text).toBe(200);expect(Object.keys(image.body.data)).toEqual(['id']);
 const last=captures.at(-1)!;expect(last.header).toBe('openApi');expect(last.payload.file).toMatchObject({size:png.length,type:'image/png'});
 const {file,signature,...fields}=last.payload;expect(signature).toBe(buildSignature(fields,'risk_test_secret',{excludedKeys:['signature']}));
 const report=input(image.body.data.id);
 expect((await send({...report,riskType:2})).status).toBe(422);
 expect((await send({...report,riskUrl:'javascript:alert(1)'})).status).toBe(422);
 expect((await send({...report,imageIds:[]})).status).toBe(422);
 expect((await send({...report,imageIds:[key(),key(),key(),key()]})).status).toBe(422);
 expect((await send({...report,imageIds:[image.body.data.id,image.body.data.id]})).status).toBe(422);
 expect((await send(report,'2')).status).toBe(422);
});
it('提交搬运词关联本地作品、真实字符串大编号，重复及并发不重复发送',async()=>{
 const image=(await upload()).body.data.id,report={...input(image),riskType:2,riskUrl:'https://example.com/risk',damageKeyword:'受损词'},requestKey=key();
 const before=captures.filter(x=>x.method==='POST').length;
 const responses=await Promise.all([send(report,'1',requestKey),send(report,'1',requestKey),send(report)]);
 responses.forEach(r=>expect(r.status,r.text).toBe(200));expect(new Set(responses.map(r=>r.body.data.id)).size).toBe(1);
 expect(captures.filter(x=>x.method==='POST').length-before).toBe(1);
 const saved=await send(report,'1',requestKey);expect(saved.body.data.status).toBe('submitted');
 const payload=captures.filter(x=>x.method==='POST').at(-1)!.payload;expect(payload).toMatchObject({composition_id:'2071000000000000001',risk_type:2,risk_url:'https://example.com/risk',damage_keyword:'受损词'});
 expect(payload.image_tokens).toMatch(/^evidence-/);expect(payload.signature).toBe(buildSignature(payload,'risk_test_secret',{excludedKeys:['signature']}));
 expect((await send({...report,keyword:'改变内容'},'1',requestKey)).status).toBe(409);
 const newImage=(await upload()).body.data.id;const duplicate=await send({...report,imageIds:[newImage]});expect(duplicate.body.data.id).toBe(saved.body.data.id);
 expect(captures.filter(x=>x.method==='POST').length-before).toBe(1);
 const history=await get('/history');expect(history.status).toBe(200);expect(history.text).not.toMatch(/file_token|image_tokens|risk_test_token|payload_json/);
});
it('拒绝和不确定结果留痕；不自动重发，手动核对重试有版本门禁',async()=>{
 for(const mode of ['rejected','unknown','malformed']){
  const image=(await upload()).body.data.id,report=input(image);sendMode=mode;
  const r=await send(report);expect(r.status,r.text).toBe(200);const record=r.body.data;
  expect(record.status).toBe(mode==='rejected'?'failed':'unknown');expect(r.text).not.toContain('SECRET');
  const count=captures.filter(x=>x.method==='POST').length;
  expect((await send(report)).body.data.id).toBe(record.id);expect(captures.filter(x=>x.method==='POST').length).toBe(count);
  if(mode!=='rejected')expect((await retry(record)).status).toBe(409);
  sendMode='success';const result=await retry(record,'1',true);expect(result.body.data.status).toBe('submitted');expect(result.body.data.attempt).toBe(2);
  const again=await retry(record,'1',true);expect(again.body.data.status).toBe('submitted');expect(captures.filter(x=>x.method==='POST').length).toBe(count+1);
 }
 expect((await q("SELECT COUNT(*) n FROM audit_logs WHERE action LIKE 'zhihu.risk.%'"))[0].n).toBeGreaterThan(0);
 expect((await q('SELECT COUNT(*) n FROM opc_income_entries'))[0].n).toBe(0);
});
it('过期截图可更新后手动重试；关联知乎作品变更后阻止沿用旧举报',async()=>{
 const image=(await upload()).body.data.id,report=input(image);sendMode='rejected';
 const record=(await send(report)).body.data;sendMode='success';
 await c.query('UPDATE zh_risk_images SET created_at=DATE_SUB(NOW(),INTERVAL 2 DAY) WHERE id=?',[image]);
 expect((await retry(record,'1',true)).status).toBe(422);
 const replacement=(await upload()).body.data.id;
 const updated=await send({...report,imageIds:[replacement]});expect(updated.body.data.id).toBe(record.id);expect(updated.body.data.status).toBe('failed');
 expect((await retry(record,'1',true)).body.data.status).toBe('submitted');
 sendMode='unknown';const uncertain=(await send(input(replacement))).body.data;sendMode='success';
 await c.query("UPDATE compositions SET zhihu_composition_id='2071000000000000002' WHERE id=1");
 expect((await retry(uncertain,'1',true)).status).toBe(409);
 await c.query("UPDATE compositions SET zhihu_composition_id='2071000000000000001' WHERE id=1");
});
it('同一知乎来源的不同项目仍隔离本地作品、截图及提交记录',async()=>{
 await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(2,1)');
 expect((await get('/works','1',{projectId:'2'})).body.data.list).toEqual([]);
 expect((await get('/history','1',{projectId:'2'})).body.data.list).toEqual([]);
 const image=(await upload()).body.data.id;
 expect((await send(input(image),'1',key(),{projectId:'2'})).status).toBe(422);
 const record=(await get('/history')).body.data.list[0];
 const r=await request(app).post(url('/'+record.id+'/retry')).set(headers['1']).send({...scope,projectId:'2',attempt:record.attempt,checkedNotReceived:true});
 expect(r.status).toBe(404);
});

const personalUrl = (tail='') => '/api/v1/modules/zhihu/content-tools'+tail;
const personalGet = (tail:string,actor='7',extra={}) => request(app).get(personalUrl(tail)).set(headers[actor]).query({...scope,...extra});
const personalImage = (actor='7',base64=png.toString('base64')) => request(app).post(personalUrl('/images')).set(headers[actor]).send({...scope,base64});
const personalSend = (report:object,actor='7',requestKey=key()) => request(app).post(personalUrl('/reports')).set(headers[actor]).send({...scope,requestKey,report});
it('成员工具限定本人作品，财务和未授权项目被拒绝，管理端入口仍隔离',async()=>{
 await c.query("INSERT INTO compositions(id,plan_id,owner_id,zhihu_composition_id,media_type,media_account,composition_type,composition_sub_type,title,promo_url,sync_status) VALUES(3,1,6,'2071000000000000003',1,'account',1,1,'团长原作品','https://example.com/leader','synced')");
 expect((await personalGet('/works')).body.data.list.map((row:any)=>row.id)).toEqual(['1']);
 expect((await personalGet('/works','6')).body.data.list.map((row:any)=>row.id)).toEqual(['3']);
 expect((await personalGet('/works','1')).body.data.list).toEqual([]);
 expect((await personalGet('/works','5')).status).toBe(200);
 expect((await personalGet('/works/3/risks','7')).status).toBe(404);
 const ownRisk=await personalGet('/works/1/risks');expect(ownRisk.status,ownRisk.text).toBe(200);
 expect(captures.at(-1)!.payload).toMatchObject({type:'0',keyword:'受损作品词'});
 expect(ownRisk.text).not.toMatch(/渠道|createChannel|channel|风险词0/);
 expect((await personalGet('/works','4')).status).toBe(403);
 expect((await personalImage('4')).status).toBe(403);
 expect((await personalGet('/reports','7',{projectId:'2'})).status).toBe(403);
 expect((await get('','7')).status).toBe(403);
 expect((await request(app).get(personalUrl('/works')).query(scope)).status).toBe(401);
});
it('小程序截图通过现有 JSON 网关大小限制，服务端验证图片与本人作品',async()=>{
 expect((await personalImage('7','<svg>bad</svg>')).status).toBe(422);
 expect((await personalImage('7',Buffer.from('not an image').toString('base64'))).status).toBe(422);
 expect((await personalImage('7',Buffer.alloc(700*1024+1).toString('base64'))).status).toBe(422);
 const image=await personalImage();expect(image.status,image.text).toBe(200);
 expect(Object.keys(image.body.data)).toEqual(['id']);
 expect((await personalSend({...input(image.body.data.id),compositionId:'3'})).status).toBe(422);
 expect((await personalSend({...input(image.body.data.id),compositionId:'2'})).status).toBe(422);
 expect((await personalSend(input(image.body.data.id),'6')).status).toBe(422);
 const report={...input(image.body.data.id),damageKeyword:'客户端伪造的原作品词'},requestKey=key(),before=captures.filter(x=>x.method==='POST').length;
 const responses=await Promise.all([personalSend(report,'7',requestKey),personalSend(report,'7',requestKey)]);
 responses.forEach(response=>expect(response.status,response.text).toBe(200));
 expect(new Set(responses.map(response=>response.body.data.id)).size).toBe(1);
 expect(captures.filter(x=>x.method==='POST').length-before).toBe(1);
 expect(captures.filter(x=>x.method==='POST').at(-1)!.payload.damage_keyword).toBe('受损作品词');
});
it('我的举报、重试与风险词结果均隔离本人，知乎渠道和其他风险词不会返回',async()=>{
 const ownImage=(await personalImage()).body.data.id;
 const own=(await personalSend(input(ownImage,'风险词1'))).body.data;
 const otherImage=(await personalImage('6')).body.data.id;
 const other=(await personalSend({...input(otherImage,'团长举报'),compositionId:'3'},'6')).body.data;
 const history=await personalGet('/reports');expect(history.status).toBe(200);
 expect(history.body.data.list.some((row:any)=>row.id===own.id)).toBe(true);
 expect(history.body.data.list.some((row:any)=>row.id===other.id)).toBe(false);
 expect(history.text).not.toMatch(/payload_json|file_token|upstream_composition_id/);
 expect((await personalGet('/reports/'+other.id+'/result')).status).toBe(404);
 expect((await request(app).post(personalUrl('/reports/'+other.id+'/retry')).set(headers['7']).send({...scope,attempt:1,checkedNotReceived:true})).status).toBe(404);
 const result=await personalGet('/reports/'+own.id+'/result');expect(result.status,result.text).toBe(200);
 expect(result.body.data.list).toHaveLength(1);expect(result.body.data.list[0]).toMatchObject({keyword:'风险词1',status:'violation'});
 expect(result.text).not.toMatch(/渠道|createChannel|channel/);
 const capture=captures.at(-1)!.payload;expect(capture).toMatchObject({type:'1',keyword:'风险词1',risk_type:'1'});
});
it('成员重试延续不确定结果保护，作品转移后不能重试或读出别人的重复记录',async()=>{
 const image=(await personalImage()).body.data.id,report=input(image);sendMode='unknown';
 const record=(await personalSend(report)).body.data;sendMode='success';
 const postRetry=(actor:string,checked:boolean)=>request(app).post(personalUrl('/reports/'+record.id+'/retry')).set(headers[actor]).send({...scope,attempt:1,checkedNotReceived:checked});
 expect((await postRetry('7',false)).status).toBe(409);
 await c.query('UPDATE compositions SET owner_id=6 WHERE id=1');
 try {
  expect((await postRetry('7',true)).status).toBe(422);
  const otherImage=(await personalImage('6')).body.data.id;
  const duplicate=await personalSend({...report,imageIds:[otherImage]},'6');
  expect(duplicate.status,duplicate.text).toBe(409);expect(duplicate.text).not.toContain(record.id);
 } finally {await c.query('UPDATE compositions SET owner_id=7 WHERE id=1');}
 expect((await postRetry('7',true)).body.data.status).toBe('submitted');
 expect((await q('SELECT COUNT(*) n FROM opc_income_entries'))[0].n).toBe(0);
});
it('撤销项目授权后，成员不能继续上传、查询或提交举报',async()=>{
 const before=captures.length;
 await c.query('UPDATE project_members SET left_at=NOW() WHERE project_id=1 AND user_id=7');
 expect((await personalGet('/works')).status).toBe(403);
 expect((await personalGet('/reports')).status).toBe(403);
 expect((await personalImage()).status).toBe(403);
 expect((await personalSend(input(key()))).status).toBe(403);
 expect(captures.length).toBe(before);
});
