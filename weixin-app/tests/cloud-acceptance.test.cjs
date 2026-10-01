const test=require('node:test'),assert=require('node:assert/strict'),{memory}=require('./cloud-memory.cjs')
test('cloud acceptance uses isolated control records and cleans transaction probes',async()=>{
  const f=memory();await f.store.put('settings','migration',{status:'importing'})
  const result=await require('../cloudfunctions/opc-api/lib/cloud-acceptance').transactions(f.store)
  assert.equal(result.passed,true);assert.equal(result.cleanupCompleted,true);assert.deepEqual(f.dump('settings'),[{status:'importing'}])
})
test('runtime readiness requires a one-use server capability and never exposes secrets',async()=>{
  const f=memory(),{check,invoke}=require('../cloudfunctions/opc-api/lib/runtime-readiness')
  assert.equal((await check(f.store,{OPENID:'client'})).code,40300)
  assert.equal((await check(f.store,{SOURCE:'wx_client'})).code,40300)
  assert.equal((await check(f.store,{APPID:'wx-test'})).code,40300)
  assert.equal((await check(f.store,{APPID:'wx-test',SOURCE:'wx_cloud'})).code,40300)
  assert.equal((await check(f.store,{APPID:'wx-test',SOURCE:'wx_client,wx_cloud'})).code,40300)
  assert.equal((await check(f.store,{OPENID:'client',APPID:'wx-test',SOURCE:'wx_cloud'})).code,40300)
  assert.equal((await check(f.store,{SOURCE:'unknown_client'})).code,40300)
  let captured
  const result=await invoke(f.store,{callFunction:async({name,data})=>{
    captured=data.probe
    assert.equal((await check(f.store,{}, {functionName:'opc-worker',probe:data.probe})).code,40300)
    return {result:await check(f.store,{APPID:'inherited',SOURCE:'unknown-cloud-source'},{functionName:name,probe:data.probe})}
  }},'opc-api')
  assert.equal(result.code,0);assert.equal(typeof result.data.credentialsConfigured,'boolean');assert.equal(result.data.upstreamReadVerified,false);assert.equal(result.data.ZHIHU_ACCESS_TOKEN,undefined)
  assert.equal((await check(f.store,{}, {functionName:'opc-api',probe:captured})).code,40300)
  assert.deepEqual(f.dump('settings'),[])
})

test('runtime capability expires, cannot be forged or consumed twice and is cleaned after invoke failure',async()=>{
  const f=memory({optimistic:true}),{check,invoke}=require('../cloudfunctions/opc-api/lib/runtime-readiness'),d=require('../cloudfunctions/opc-api/lib/domain')
  const probe={id:'a'.repeat(32),token:'b'.repeat(64)},id='runtime-readiness-'+probe.id,options={functionName:'opc-api',probe}
  await f.store.put('settings',id,{target:'opc-api',tokenHash:d.hash(probe.token),expiresAt:Date.now()-1})
  assert.equal((await check(f.store,{},options)).code,40300)
  await f.store.put('settings',id,{target:'opc-api',tokenHash:d.hash(probe.token),expiresAt:Date.now()+60000})
  assert.equal((await check(f.store,{}, {...options,probe:{...probe,token:'c'.repeat(64)}})).code,40300)
  const results=await Promise.all([check(f.store,{},options),check(f.store,{},options)])
  assert.equal(results.filter(row=>row.code===0).length,1)
  await assert.rejects(invoke(f.store,{callFunction:async()=>{throw Error('invoke failed')}},'opc-api'),/invoke failed/)
  assert.deepEqual(f.dump('settings'),[])
})
test('wrapped SDK transaction conflicts retry only after rollback, unknown failures do not retry',async()=>{
  const {Store}=require('../cloudfunctions/opc-api/lib/store');let calls=0,rollbackFinished=false
  const db={runTransaction:async(callback,retries)=>{assert.equal(retries,0);calls++;if(calls===1){await new Promise(resolve=>setTimeout(resolve,1));rollbackFinished=true;throw Object.assign(Error('document.set:fail -501001 database transaction conflict'),{errCode:-501001})}assert.equal(rollbackFinished,true);return callback({})}}
  assert.equal(await new Store(db).transaction(async()=>42),42);assert.equal(calls,2)
  for(const error of [Object.assign(Error('transaction timeout'),{errCode:-501001}),Object.assign(Error('database unavailable'),{errCode:-501001}),new Error('business validation')]){
    let attempts=0;const store=new Store({runTransaction:async()=>{attempts++;throw error}})
    await assert.rejects(store.transaction(async()=>null),e=>e===error);assert.equal(attempts,1)
  }
})
test('cloud transaction failure preserves original stage and waits for all cleanup',async()=>{
  const f=memory(),failure=Object.assign(Error('transaction failure'),{errCode:-501001});let phase,settled=0
  const transaction=f.store.transaction.bind(f.store)
  f.store.transaction=async work=>{
    if(phase!=='acceptance.transaction.single-update')return transaction(work)
    await new Promise(resolve=>setTimeout(resolve,5));settled++;throw failure
  }
  await assert.rejects(require('../cloudfunctions/opc-api/lib/cloud-acceptance').transactions(f.store,value=>{phase=value}),e=>e===failure)
  assert.equal(settled,1);assert.equal(phase,'acceptance.transaction.single-update');assert.equal(failure.cleanupCompleted,true);assert.deepEqual(f.dump('settings'),[])
})
test('synthetic probe diagnostics redact environment secrets and probe IDs',()=>{
  const {diagnostic}=require('../cloudfunctions/opc-api/lib/migration-diagnostic'),old=process.env.OPC_MIGRATION_SECRET
  process.env.OPC_MIGRATION_SECRET='private-test-migration-credential'
  try{
    const error=Error('document.set failed: transaction locked, id=acceptance-123456789-counter private-test-migration-credential https://example.com/private')
    const result=diagnostic(error,'acceptance.transaction.single-update')
    assert.ok(result.sdkMessage.includes('transaction locked'));assert.ok(!result.sdkMessage.includes(process.env.OPC_MIGRATION_SECRET));assert.ok(!result.sdkMessage.includes('123456789'));assert.ok(!result.sdkMessage.includes('example.com'))
    assert.equal(diagnostic(error,'import.transaction:users').sdkMessage,undefined)
  }finally{if(old===undefined)delete process.env.OPC_MIGRATION_SECRET;else process.env.OPC_MIGRATION_SECRET=old}
})
