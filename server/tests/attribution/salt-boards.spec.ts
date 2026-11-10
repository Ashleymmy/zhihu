import {beforeAll,afterAll,it,expect} from 'vitest';
import {MySqlContainer,type StartedMySqlContainer} from '@testcontainers/mysql';
import mysql,{type Connection} from 'mysql2/promise';
import request from 'supertest';
import type {Express} from 'express';
import {http,HttpResponse} from 'msw';
import {setupServer} from 'msw/node';
import {runOpcMigrations} from '../../scripts/opcMigrations';
import {saltFixtureBoards,saltFixtureContents} from '../attribution-ui/salt-upstream';
let container:StartedMySqlContainer,c:Connection,pool:typeof import('../../src/db').db,app:Express;
const scope={projectId:'1',accountId:'1'},headers:Record<string,Record<string,string>>={},captures:Record<string,string>[]=[];
const actors=[['1','admin','all'],['2','admin','operations'],['3','developer','all'],['4','admin','finance'],['5','operator','operations'],['6','leader','all'],['7','creator','all']] as const;
let mode='normal';
const upstream=setupServer(
 http.get('https://open.zhihu.com/alliance/api/vip/content/rule/labels',({request})=>{
  captures.push(Object.fromEntries(new URL(request.url).searchParams));
  if(mode==='error')return HttpResponse.json({error:{message:'SECRET token details'}},{status:503});
  if(mode==='bad')return HttpResponse.json({error:{message:'SECRET failure'}});
  if(mode==='precision')return HttpResponse.json([{...saltFixtureBoards[0],id:1e30}]);
  if(mode==='numeric')return new HttpResponse('[{"id":1661766472115556352,"name":"高评论书籍","type":1}]',{headers:{'Content-Type':'application/json'}});
  return HttpResponse.json(mode==='empty'?[]:saltFixtureBoards);
 }),
 http.get('https://open.zhihu.com/alliance/api/vip/rule_contents',({request})=>{
  const p=Object.fromEntries(new URL(request.url).searchParams);captures.push(p);
  const response=saltFixtureContents(p.rule_id,Number(p.offset),Number(p.limit));
  if(mode==='bad')return HttpResponse.json({data:[]});
  if(mode==='pagination')response.pagination.offset++;
  if(mode==='link'&&response.data[0]){response.data[0].url='javascript:alert(1)';response.data[0].paid_column.url='https://secret:password@example.com';}
  return HttpResponse.json(response);
 }),
);
const url='/api/v1/modules/zhihu/zhihu-content/salt/boards';
const get=(tail='',actor='1',extra={})=>request(app).get(url+tail).set(headers[actor]).query({...scope,...extra});
beforeAll(async()=>{
 container=await new MySqlContainer('mysql:8.0').withDatabase('salt_boards_isolated').withUsername('test').withUserPassword('isolated').start();
 const target={host:container.getHost(),port:container.getPort(),database:container.getDatabase(),user:container.getUsername(),password:container.getUserPassword()};
 Object.assign(process.env,{DB_HOST:target.host,DB_PORT:String(target.port),DB_NAME:target.database,DB_USER:target.user,DB_PASS:target.password,OPC_MODULES:'zhihu',ZHIHU_ACCESS_TOKEN:'salt_test_token',ZHIHU_SECRET_KEY:'salt_test_secret',DEV_DEMO_AUTH:'0'});
 await runOpcMigrations(target,['zhihu']);c=await mysql.createConnection(target);
 for(const [id,role,duty]of actors)await c.query('INSERT INTO users(id,username,password_hash,role,display_name,admin_duty) VALUES(?,?,?,?,?,?)',[id,'salt'+id,'unused',role,'测试'+id,duty]);
 await c.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES(1,6,'member'),(1,7,'member')");
 await c.query("INSERT INTO projects(id,name,slug) VALUES(2,'未接通项目','salt-other')");
 await c.query("INSERT INTO integration_accounts(id,module_id,account_key,name) VALUES(2,'zhihu','unconfigured','其他来源')");
 await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(2,2)');
 const {ModuleRuntime}=await import('../../src/core/module-runtime'),{zhihuManifest}=await import('../../src/modules/zhihu/manifest'),{createZhihuModule}=await import('../../src/modules/zhihu/module'),{createCoreApp}=await import('../../src/core/app');
 const runtime=new ModuleRuntime([zhihuManifest]);runtime.register(createZhihuModule());app=createCoreApp(runtime);pool=(await import('../../src/db')).db;
 const {signToken}=await import('../../src/auth/jwt'),{issueRefreshSession}=await import('../../src/auth/tokenSessions');
 for(const [id,role,adminDuty] of actors){const client='salt-board-test-client-'+id,session=await issueRefreshSession(id,{type:'web',id:client});headers[id]={'X-Client-Id':client,Authorization:'Bearer '+await signToken({id,role,adminDuty,parentId:null,displayName:'测试'+id,username:'salt'+id,sessionId:session.familyId})};}
 upstream.listen({onUnhandledRequest(req,print){if(new URL(req.url).hostname==='open.zhihu.com')print.error();}});
},90000);
afterAll(async()=>{upstream.close();if(pool)await pool.end();if(c)await c.end();if(container)await container.stop();});
it('只向 Web 管理岗位开放，新旧读入口均拒绝财务和成员',async()=>{
 expect((await request(app).get(url).query(scope)).status).toBe(401);
 for(const actor of ['1','2','3','5'])expect((await get('',actor)).status).toBe(200);
 const start=captures.length;
 for(const actor of ['4','6','7']){
  expect((await get('',actor)).status).toBe(403);expect((await get('/'+saltFixtureBoards[0].id+'/contents',actor)).status).toBe(403);
  expect((await request(app).get('/api/v1/zhihu-content/salt/boards').set(headers[actor]).query(scope)).status).toBe(403);
  for(const endpoint of ['vip/content/rule/labels','vip/rule_contents'])expect((await request(app).get('/api/alliance/api/'+endpoint).set(headers[actor]).query({rule_id:saltFixtureBoards[0].id})).status).toBe(404);
 }
 expect(captures.length).toBe(start);
});
it('项目与数据来源必须匹配，其他项目不能借用当前凭证',async()=>{
 const start=captures.length;
 expect((await request(app).get(url).set(headers['1'])).status).toBe(422);
 expect((await get('','1',{projectId:'999'})).status).toBe(403);
 expect((await get('','1',{projectId:'2',accountId:'2'})).status).toBe(409);
 expect((await get('','1',{accountId:'2'})).status).toBe(403);expect(captures.length).toBe(start);
});
it('榜单 ID 不丢精度，仅发送必要的 token 查询参数',async()=>{
 const r=await get('','1',{access_token:'attacker',signature:'fake',api_base:'http://evil'});expect(r.status).toBe(200);expect(r.body.data.list[0].id).toBe('1661766472115556352');
 expect(captures.at(-1)).toEqual({access_token:'salt_test_token'});
 mode='numeric';expect((await get()).body.data.list[0].id).toBe('1661766472115556352');mode='normal';
 const content=await get('/1661766472115556352/contents','1',{offset:20,limit:20,rule_id:'999'});expect(content.status).toBe(200);
 expect(content.body.data.list[0].id).toBe(String(2099827666153124981n+20n));expect(content.body.data.list.length).toBe(4);expect(content.body.data.hasNext).toBe(false);
 expect(captures.at(-1)).toEqual({rule_id:'1661766472115556352',offset:'20',limit:'20',access_token:'salt_test_token'});
});
it('分页、有数据详情、推荐字段、空榜单均按真实结构解析',async()=>{
 const first=await get('/1661766472115556352/contents');expect(first.body.data.list.length).toBe(20);expect(first.body.data.total).toBe(24);expect(first.body.data.hasNext).toBe(true);
 expect(first.body.data.list[0]).toMatchObject({columnTitle:'所属专栏',topics:['情感','现代'],theme:''});
 const recommended=await get('/1710322868645269504/contents');expect(recommended.body.data.list[0]).toMatchObject({firstCategory:'情感',secondCategory:'家庭 / 婚姻',contentLevel:'2',theme:'亲情',consumeValue:'推荐内容'});
 const empty=await get('/1710322868645269505/contents');expect(empty.body.data).toMatchObject({list:[],total:0,hasNext:false});
 mode='empty';expect((await get()).body.data.list).toEqual([]);mode='normal';
});
it('格式异常、接口失败和不可信数字不会伪装成空结果',async()=>{
 for(const failure of ['error','bad','precision']){mode=failure;const r=await get();expect(r.status).toBe(502);expect(r.text).not.toContain('SECRET');expect(r.body.data).not.toEqual({list:[]});}
 for(const failure of ['bad','pagination']){mode=failure;expect((await get('/1661766472115556352/contents')).status).toBe(502);}mode='normal';
});
it('外链协议和分页边界校验，拒绝危险链接或不合法参数',async()=>{
 for(const tail of ['/invalid/contents','/1661766472115556352/contents?offset=-1','/1661766472115556352/contents?limit=101'])expect((await get(tail)).status).toBe(422);
 mode='link';const r=await get('/1661766472115556352/contents');mode='normal';expect(r.body.data.list[0]).toMatchObject({url:'',columnUrl:''});
 expect((await c.query<any[]>("SELECT COUNT(*) n FROM opc_income_entries"))[0][0].n).toBe(0);
});
it('小程序选书按项目授权开放给团长与达人，不开放原管理端接口',async()=>{
 const customer='/api/v1/modules/zhihu/content-tools/boards';
 for(const actor of ['1','2','3','5','6','7']){
  const r=await request(app).get(customer).set(headers[actor]).query(scope);expect(r.status,r.text).toBe(200);
  expect(r.body.data.list[0].id).toBe('1661766472115556352');
 }
 expect((await request(app).get(customer).set(headers['4']).query(scope)).status).toBe(403);
 expect((await request(app).get(customer).set(headers['7']).query({...scope,projectId:'2',accountId:'2'})).status).toBe(403);
 const contents=await request(app).get(customer+'/1661766472115556352/contents').set(headers['7']).query({...scope,offset:20,limit:20});
 expect(contents.status,contents.text).toBe(200);expect(contents.body.data.list).toHaveLength(4);
 expect((await get('','7')).status).toBe(403);
 await c.query('UPDATE project_members SET left_at=NOW() WHERE project_id=1 AND user_id=7');
 expect((await request(app).get(customer).set(headers['7']).query(scope)).status).toBe(403);
});
