const test=require('node:test'),assert=require('node:assert/strict')
const {fixture,scope}=require('./cloud-fixture.cjs'),{memory}=require('./cloud-memory.cjs')
const d=require('../cloudfunctions/opc-api/lib/domain'),{run}=require('../cloudfunctions/opc-api/lib/worker')
async function report(f,count){
  await f.store.put('prices','price',{id:'price',...scope,taskId:'20',relationType:'agency_creator',payerId:'1',payeeId:'3',startDay:'2020-01-01',endDay:null,price:'2.0000',priceStatus:'published'})
  for(let i=0;i<count;i++){
    const word='batch-word-'+i,id=String(100+i),bindingId=String(300+i)
    await f.store.put('keywords',id,{id,...scope,keyword:word,mappingId:'40',taskId:'20'})
    await f.store.put('keys',d.hash(['keyword',word]),{owner:id})
    await f.store.put('bindings',bindingId,{id:bindingId,keywordId:id,executorId:'3',usedAt:d.now(),activatedOn:'2020-01-01',verificationStatus:'passed'})
    const key='large-report-'+String(i).padStart(6,'0')
    await f.store.put('import_rows',key,{id:key,batchId:'large-report',value:{date:'2026-09-01',channel:'test-channel',keyword:word,orders:'1',search:'2',revenue:'2.0000'}})
  }
  await f.store.put('imports','large-report',{id:'large-report',...scope,cursor:0,rowCount:count,status:'queued'})
  await f.store.put('jobs','report-job',{id:'report-job',type:'import',scope,batchId:'large-report',status:'pending',nextAt:0,attempts:0})
}
test('multi-transaction report resumes all rows without exceeding 90 operations or duplicating facts',async()=>{
  const f=await fixture();await report(f,27)
  for(let i=0;i<8;i++)await run(f.store)
  assert.equal((await f.store.get('imports','large-report')).cursor,27)
  assert.equal((await f.store.get('imports','large-report')).status,'completed')
  assert.equal(f.dump('facts').length,27);assert.equal(f.dump('income').length,0)
  assert.ok(f.dump('facts').every(row=>row.allocations[0].amount==='2.0000'))
  await run(f.store);assert.equal(f.dump('facts').length,27)
})
test('late import row failure preserves committed progress and counts consecutive failures only',async()=>{
  const f=await fixture();await report(f,3)
  const id='large-report-000001',row=await f.store.get('import_rows',id);await f.store.remove('import_rows',id)
  await f.store.put('jobs','report-job',{...(await f.store.get('jobs','report-job')),attempts:20})
  await run(f.store)
  assert.equal((await f.store.get('imports','large-report')).cursor,1)
  let job=await f.store.get('jobs','report-job');assert.equal(job.status,'pending');assert.equal(job.consecutiveFailures,1)
  await f.store.put('import_rows',id,row);await f.store.put('jobs',job.id,{...job,nextAt:0})
  await run(f.store);await run(f.store)
  job=await f.store.get('jobs','report-job');assert.equal(job.status,'completed');assert.equal(job.consecutiveFailures,0)
  assert.equal(f.dump('facts').length,3)
})
test('job scanner handles more than 1000 jobs and skips active leases without starving later jobs',async()=>{
  const f=memory()
  for(let i=0;i<1100;i++){const id=String(i).padStart(6,'0');await f.db.collection('opc_jobs').doc(id).set({data:{id,status:'running',nextAt:0,leaseUntil:Date.now()+90000}})}
  await f.store.put('jobs','z-ready',{id:'z-ready',status:'pending',nextAt:0})
  const {candidates}=require('../cloudfunctions/opc-api/lib/job-queue');let found=[]
  for(let i=0;i<8;i++)found.push(...await candidates(f.store))
  assert.ok(found.some(row=>row.id==='z-ready'))
})
test('audit cleanup advances over retained financial records and deletes only one bounded page',async()=>{
  const f=await fixture(),token=await f.login('admin')
  for(let i=0;i<75;i++){const id='old-'+String(i).padStart(3,'0');await f.store.put('audit',id,{id,createdAt:'2020-01-01',action:i%3===0?'statement.confirm':'project.view'})}
  await f.store.put('audit','old-legacy',{id:'old-legacy',createdAt:'2020-01-01',action:'legacy.batch.approve'})
  let cursor=null,deleted=0
  for(let i=0;i<5;i++){
    const response=await f.call(token,'POST','/core/admin-tools/audit-cleanup',{days:30,cursor,requestKey:'audit-cleanup-'+i})
    assert.equal(response.code,0,response.message);deleted+=response.data.deleted;cursor=response.data.nextCursor;if(!cursor)break
  }
  assert.equal(deleted,50);assert.equal(f.dump('audit').filter(row=>row.action==='statement.confirm').length,25)
  assert.ok(await f.store.get('audit','old-legacy'))
})
test('selected financial confirmation and funding use exact reviewed rows and replay keys',async()=>{
  const f=await fixture(),token=await f.login('finance'),period={...scope,from:'2026-09-01',to:'2026-09-30'}
  await f.store.put('bindings','60',{id:'60',executorId:'3',verificationStatus:'passed'})
  for(let i=0;i<12;i++)await f.store.put('facts','fact-'+i,{id:'fact-'+i,...scope,date:'2026-09-01',keyword:'word',orders:'1',bindingId:'60',version:'v1',allocations:[{userId:'3',amount:'10.0000'}]})
  const selection={...period,factIds:['fact-0']},preview=await f.call(token,'GET','/modules/zhihu/workbench',selection)
  assert.equal(preview.data.entries.length,1)
  const input={...selection,reviewHash:preview.data.reviewHash,acknowledged:true,requestKey:'confirm-selection-001'}
  assert.equal((await f.call(token,'POST','/modules/zhihu/workbench/confirm',input)).code,0)
  assert.equal((await f.call(token,'POST','/modules/zhihu/workbench/confirm',input)).code,0)
  assert.equal(f.dump('income').length,1)
  assert.equal((await f.call(token,'POST','/modules/zhihu/workbench/confirm',{...input,factIds:['fact-1']})).code,40900)
  const incomeIds=[f.dump('income')[0].id],fund=await f.call(token,'GET','/core/finance/funding-preview',{...scope,incomeIds})
  assert.equal(fund.data.amount,'10.0000')
  const funding={...scope,incomeIds,hash:fund.data.hash,reference:'verified-deposit',requestKey:'fund-selection-001'}
  assert.equal((await f.call(token,'POST','/core/finance/funding',funding)).code,0)
  assert.equal((await f.call(token,'POST','/core/finance/funding',funding)).code,0)
  assert.equal(f.dump('ledger').filter(row=>row.kind==='funding').length,1)
  assert.equal((await f.call(token,'GET','/core/finance/funding-preview',{...scope,incomeIds})).code,40900)
})
test('metric synchronization cannot reuse another integration account metric',async()=>{
  const f=await fixture();await f.store.remove('routes',d.hash(scope))
  const other={projectId:'1',accountId:'11'}
  await f.store.put('links',d.hash(other),other)
  for(const [id,accountId]of [['80','10'],['81','11']])await f.store.put('legacy_plans',id,{id,projectId:'1',accountId,channelId:'300',keyword:'shared',ownerId:'3',status:'active'})
  await f.store.put('legacy_metrics','other',{id:'other',...other,planId:'81',channelId:'300',keyword:'shared',statDate:'2026-09-01',earning:'88.0000'})
  await f.store.put('jobs','metric-job',{id:'metric-job',scope,type:'legacy-sync-metrics',from:'2026-09-01',to:'2026-09-01',status:'pending',nextAt:0})
  await run(f.store,{request:async()=>[{stat_date:'2026-09-01',channel_id:'300',keyword:'shared',earning:'12'}]})
  assert.equal((await f.store.get('legacy_metrics','other')).earning,'88.0000')
  assert.equal(f.dump('legacy_metrics').find(row=>row.accountId==='10').earning,'12.0000')
})
test('worker timer records actual executions while migration gate prevents business jobs',async()=>{
  const f=memory(),{execute}=require('../cloudfunctions/opc-api/lib/worker-entry');let calls=0
  const event={Type:'Timer',TriggerName:'opc-jobs-every-minute'},work=async()=>{calls++;return []}
  assert.equal((await execute(f.store,event,{OPENID:'client'},work)).code,40300)
  assert.equal(await f.store.get('settings','worker-heartbeat'),null)
  assert.equal((await execute(f.store,event,{},work)).code,50300)
  assert.equal((await f.store.get('settings','worker-heartbeat')).outcome,'migration-gated');assert.equal(calls,0)
  await f.store.put('settings','migration',{status:'sealed'})
  assert.equal((await execute(f.store,event,{},work)).code,0)
  assert.equal((await f.store.get('settings','worker-heartbeat')).runs,2);assert.equal(calls,1)
})
