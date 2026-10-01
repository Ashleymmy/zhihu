const test=require('node:test')
const assert=require('node:assert/strict')
const {memory}=require('./cloud-memory.cjs')
const d=require('../cloudfunctions/opc-api/lib/domain')
const {createMigration}=require('../cloudfunctions/opc-api/lib/migration')
const {gateway}=require('../cloudfunctions/opc-api/lib/gateway')
function input(blockers=[]){
  const rows=[{_id:'1',value:{id:'1',role:'admin',isActive:true,adminDuty:'all'}}]
  const batch={file:'users-000000.json',collection:'users',count:1,hash:d.hash(rows)}
  return {rows,batch,manifest:{formatVersion:1,environmentId:'test',targetCounts:{users:1},batches:[batch],blockers,readyToSeal:!blockers.length}}
}
test('migration validates immutable manifests, exact batches and persisted content before sealing',async()=>{
  const f=memory(),m=createMigration(f.store,f.db,'test',{ready:true,blockers:[]}),i=input()
  const started=await m.handle({action:'initialize',manifest:i.manifest})
  await assert.rejects(m.handle({action:'import',...i.batch,rows:[{_id:'1',value:{id:'2'}}]}),/清单/)
  await m.handle({action:'import',...i.batch,rows:i.rows})
  assert.equal((await m.handle({action:'verify'})).verified,true)
  await f.store.put('users','1',{id:'1',role:'creator'})
  assert.equal((await m.handle({action:'verify'})).verified,false)
  await assert.rejects(m.handle({action:'seal',confirmation:started.manifestHash,cloudAcceptanceVerified:true}),/核对未通过/)
})
test('release refuses incomplete legacy migration even when collection counts match',async()=>{
  const f=memory(),m=createMigration(f.store,f.db,'test',{ready:true,blockers:[]}),i=input([{table:'withdrawals',count:1}])
  const started=await m.handle({action:'initialize',manifest:i.manifest})
  await m.handle({action:'import',...i.batch,rows:i.rows})
  await assert.rejects(m.handle({action:'seal',confirmation:started.manifestHash,cloudAcceptanceVerified:true}),/对账/)
})
test('release refuses incomplete API migration and seals only after both gates pass',async()=>{
  const f=memory(),release={ready:false,blockers:['API parity']},m=createMigration(f.store,f.db,'test',release),i=input()
  const started=await m.handle({action:'initialize',manifest:i.manifest})
  await m.handle({action:'import',...i.batch,rows:i.rows})
  const seal={action:'seal',confirmation:started.manifestHash,cloudAcceptanceVerified:true}
  await assert.rejects(m.handle(seal),/接口迁移/)
  release.ready=true;release.blockers=[]
  assert.deepEqual(await m.handle(seal),{sealed:true})
  await assert.rejects(m.handle({action:'import',...i.batch,rows:i.rows}),/已关闭/)
})
test('cloud entry returns useful 503 before database initialization and validates trusted identity',async()=>{
  let calls=0
  const handle=gateway({get:async()=>{throw Error('collection missing')}},{handle:async()=>{calls++;return {code:0}}},()=>({OPENID:'trusted',APPID:'app'}))
  const r=await handle({method:'POST',path:'/core/auth/login'})
  assert.equal(r.statusCode,503);assert.equal(calls,0)
  assert.equal((await handle({method:'GET',path:'/system/identity'})).code,0)
})
