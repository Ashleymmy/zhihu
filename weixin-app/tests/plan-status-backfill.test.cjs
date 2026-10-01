const test=require('node:test'),assert=require('node:assert/strict')
const {memory}=require('./cloud-memory.cjs')
const backfill=require('../cloudfunctions/opc-api/lib/plan-status-backfill')

test('backfill corrects keywords stuck synced+pending with a plan id, leaves everything else alone',async()=>{
  const f=memory()
  await f.store.put('keywords','stuck-unbound',{id:'stuck-unbound',syncStatus:'synced',planStatus:'pending',zhihuPlanId:'p1'})
  await f.store.put('keywords','stuck-bound',{id:'stuck-bound',syncStatus:'synced',planStatus:'pending',zhihuPlanId:'p2',bindingId:'b1',lifecycleStatus:'reserved'})
  await f.store.put('keywords','already-active',{id:'already-active',syncStatus:'synced',planStatus:'active',zhihuPlanId:'p3'})
  await f.store.put('keywords','failed-sync',{id:'failed-sync',syncStatus:'failed',planStatus:'pending',zhihuPlanId:'p4'})
  await f.store.put('keywords','no-plan-id',{id:'no-plan-id',syncStatus:'synced',planStatus:'pending'})
  await f.store.put('jobs','plan-stuck-unbound',{id:'plan-stuck-unbound',status:'completed'})

  const result=await backfill.run(f.store)
  assert.equal(result.scanned,2);assert.equal(result.fixed,2)
  assert.deepEqual(new Set(result.keywordIds),new Set(['stuck-unbound','stuck-bound']))

  const unbound=await f.store.get('keywords','stuck-unbound')
  assert.equal(unbound.planStatus,'active');assert.equal(unbound.lifecycleStatus,'available');assert.ok(unbound.priorityUntil)
  const bound=await f.store.get('keywords','stuck-bound')
  assert.equal(bound.planStatus,'active');assert.equal(bound.lifecycleStatus,'reserved')
  assert.equal((await f.store.get('keywords','already-active')).planStatus,'active')
  assert.equal((await f.store.get('keywords','failed-sync')).planStatus,'pending')
  assert.equal((await f.store.get('keywords','no-plan-id')).planStatus,'pending')

  const job=await f.store.get('jobs','plan-stuck-unbound')
  assert.equal(job.reconciledBy,'backfill-plan-status');assert.ok(job.reconciledAt)
  assert.equal((await f.store.get('settings','plan-status-backfill')).fixed,2)
})

test('dryRun reports the same rows without writing anything',async()=>{
  const f=memory()
  await f.store.put('keywords','stuck',{id:'stuck',syncStatus:'synced',planStatus:'pending',zhihuPlanId:'p1'})
  const result=await backfill.run(f.store,{dryRun:true})
  assert.deepEqual(result,{dryRun:true,scanned:1,keywordIds:['stuck']})
  assert.equal((await f.store.get('keywords','stuck')).planStatus,'pending')
  assert.equal(await f.store.get('settings','plan-status-backfill'),null)
})

test('running twice is a no-op the second time',async()=>{
  const f=memory()
  await f.store.put('keywords','stuck',{id:'stuck',syncStatus:'synced',planStatus:'pending',zhihuPlanId:'p1'})
  await backfill.run(f.store)
  const second=await backfill.run(f.store)
  assert.equal(second.scanned,0);assert.equal(second.fixed,0)
})
