const test=require('node:test'),assert=require('node:assert/strict')
const {fixture,identity}=require('./cloud-fixture.cjs')
const {gateway}=require('../cloudfunctions/opc-api/lib/gateway')
const config={enabled:true,mode:'ui-preview',environmentId:'test'}
const trusted=()=>({OPENID:identity.openid,APPID:identity.appid})

test('UI preview permits real login and page reads without sealing or relaxing roles',async()=>{
  const f=await fixture();await f.store.put('settings','migration',{status:'importing'})
  const handle=gateway(f.store,f.api,trusted,{environment:'test',developmentAccess:config})
  const login=await handle({method:'POST',path:'/core/auth/login',data:{username:'admin',password:'Test-password-123'}})
  assert.equal(login.code,0,login.message)
  const token=login.data.token
  assert.equal((await handle({method:'GET',path:'/core/auth/me',token})).data.role,'admin')
  assert.equal((await handle({method:'GET',path:'/core/projects',token})).data.length,1)
  assert.equal((await handle({method:'GET',path:'/core/projects/1/integrations',token})).data.length,1)
  assert.equal((await handle({method:'GET',path:'/core/auth/me'})).code,40100)
  assert.equal((await handle({method:'POST',path:'/core/auth/login',data:{username:'admin',password:'wrong-password'}})).code,40100)
  const creator=await f.login('creator')
  assert.equal((await handle({method:'GET',path:'/core/staff',token:creator})).code,40300)
  assert.equal((await handle({method:'POST',path:'/core/auth/logout',token})).code,0)
  assert.equal((await handle({method:'GET',path:'/core/auth/me',token})).code,40100)
  assert.equal((await f.store.get('settings','migration')).status,'importing')
})

test('preview denies all business mutations and upstream reads before side effects',async()=>{
  let calls=0
  const handle=gateway({get:async()=>({status:'sealed'})},{handle:async()=>{calls++;return {code:0}}},trusted,{environment:'test',developmentAccess:config})
  for(const [method,path]of [
    ['POST','/modules/zhihu/keywords'],['PATCH','/core/projects/1'],['DELETE','/core/team/members/3'],
    ['POST','/core/finance/withdrawals'],['POST','/core/files/prepare'],
    ['GET','/modules/zhihu/alliance/api/get_agent_channels'],['GET','/modules/zhihu/zhihu-content/books']
  ])assert.equal((await handle({method,path})).code,40900)
  assert.equal(calls,0)
})

test('client cannot enable preview, and server preview configuration is environment bound',async()=>{
  let calls=0;const store={get:async()=>({status:'importing'})},api={handle:async()=>{calls++;return {code:0}}}
  for(const options of [{},{environment:'production',developmentAccess:config},{environment:'test',developmentAccess:{...config,enabled:false}}]){
    const handle=gateway(store,api,trusted,options)
    assert.equal((await handle({method:'GET',path:'/core/projects',developmentAccess:config})).code,50300)
  }
  assert.equal(calls,0)
})
