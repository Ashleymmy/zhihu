const test=require('node:test'),assert=require('node:assert/strict')
const {memory}=require('./cloud-memory.cjs')
const {Store,transactionConflict,matches}=require('../cloudfunctions/opc-api/lib/store')
const conflictMessage='document.set:fail -501001 resource system error. [ResourceUnavailable.TransactionConflict] Transaction is conflict, maybe resource operated by others. Please check your request, but if the problem persists, contact us.'

test('real WeChat wrapped conflict retries, other resource errors do not',async()=>{
  const conflict=Object.assign(Error(conflictMessage),{errCode:-501001})
  assert.equal(transactionConflict(conflict),true)
  assert.equal(transactionConflict({code:'ResourceUnavailable.TransactionConflict'}),true)
  let calls=0
  const store=new Store({async runTransaction(work,retries){assert.equal(retries,0);if(++calls===1)throw conflict;return work({})}})
  assert.equal(await store.transaction(async()=>123),123);assert.equal(calls,2)
  for(const message of ['resource system error. [ResourceUnavailable.TransactionTimeout]','commit result unknown','resource system error. [ResourceUnavailable.TransactionFailed]']){
    const error=Object.assign(Error(message),{errCode:-501001});let attempts=0
    await assert.rejects(new Store({async runTransaction(){attempts++;throw error}}).transaction(()=>{}),e=>e===error)
    assert.equal(attempts,1)
  }
  assert.equal(require('../cloudfunctions/opc-api/lib/migration-diagnostic').diagnostic(conflict,'acceptance.transaction.concurrent').category,'transaction-conflict')
})

test('transaction queries use document reads and include own insert, update and deletion',async()=>{
  const f=memory()
  await f.store.put('settings','existing',{id:'existing',group:'before',date:'2026-09-01'})
  await f.store.put('settings','deleted',{id:'deleted',group:'match',date:'2026-09-10'})
  await f.store.transaction(async tx=>{
    await tx.put('settings','existing',{id:'existing',group:'match',date:'2026-09-12'})
    await tx.put('settings','new',{id:'new',group:'match',date:'2026-09-11'})
    await tx.remove('settings','deleted')
    await tx.put('settings','unrelated',{id:'unrelated'})
    const result=await tx.find('settings',{group:tx.db.command.in(['match']),date:tx.db.command.gte('2026-09-11').and(tx.db.command.lte('2026-09-12'))})
    assert.deepEqual(result.map(row=>row.id),['existing','new'])
  })
  assert.equal(await f.store.get('settings','deleted'),null)
  assert.equal(matches({nested:{}},{'nested.status':f.db.command.in(['active'])}),false)
})

test('empty transaction query guard prevents concurrent phantom insert',async()=>{
  const f=memory({optimistic:true});let arrived=0,release
  const bothQueried=new Promise(resolve=>{release=resolve}),attempts={a:0,b:0}
  const claim=id=>f.store.transaction(async tx=>{
    attempts[id]++
    const rows=await tx.find('settings',{kind:'singleton'})
    if(attempts[id]===1){if(++arrived===2)release();await bothQueried}
    if(rows.length)return false
    await tx.put('settings',id,{id,kind:'singleton'});return true
  })
  assert.equal((await Promise.all([claim('a'),claim('b')])).filter(Boolean).length,1)
  assert.equal(f.dump('settings').length,1)
  assert.equal(attempts.a+attempts.b,3)
})

test('query retries when a writer commits after its transaction snapshot started',async()=>{
  const f=memory({optimistic:true});let attempts=0
  const rows=await f.store.transaction(async tx=>{
    attempts++;await tx.get('settings','anchor')
    if(attempts===1)await f.store.put('settings','created',{id:'created',kind:'target'})
    return tx.find('settings',{kind:'target'})
  })
  assert.equal(attempts,2);assert.deepEqual(rows,[{id:'created',kind:'target'}])
})

test('operation budget aborts all staged writes, including collection revision',async()=>{
  const f=memory()
  await assert.rejects(f.store.transaction(async tx=>{
    await tx.put('settings','must-rollback',{value:1})
    for(let i=0;i<90;i++)await tx.get('settings','missing-'+i)
  }),error=>error.status===413)
  assert.deepEqual(f.dump('settings'),[]);assert.deepEqual(f.dump('locks'),[])
})

test('document reads normalize SDK missing records without hiding real failures',async()=>{
  const error=Object.assign(Error('document.get:fail -1 document with _id missing does not exist'),{errCode:-1})
  const db={collection:()=>({doc:()=>({get:async()=>{throw error}})})},store=new Store(db)
  assert.equal(await store.get('settings','missing'),null)
  error.errCode=-501001
  await assert.rejects(store.get('settings','missing'),e=>e===error)
})
