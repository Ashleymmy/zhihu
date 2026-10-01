const test=require('node:test'),assert=require('node:assert/strict')
const {fixture,scope}=require('./cloud-fixture.cjs')
const d=require('../cloudfunctions/opc-api/lib/domain')
const a=require('../cloudfunctions/opc-api/lib/accounting')
const {balance,funding}=require('../cloudfunctions/opc-api/lib/finance')
async function setup(){const f=await fixture();await f.store.put('bindings','b',{id:'b',verificationStatus:'passed'});return f}
async function confirm(f,version,amount){const fact={id:'f',...scope,version,allocations:[{userId:'3',amount}],bindingId:'b',date:'2026-09-01'};await f.store.transaction(async tx=>{await tx.put('facts','f',fact);await a.confirm(tx,scope,fact,'1')});return fact}
async function release(f){const row=await f.store.get('income',d.hash(['f','3']));await f.store.transaction(tx=>a.release(tx,row,'1','bank'))}
test('corrections preserve released income and fund only positive delta',async()=>{
 const f=await setup();await confirm(f,'v1','10.0000');await release(f)
 await confirm(f,'v2','15.0000');let b=await balance(f.store,'3',scope)
 assert.equal(b.available,'10.0000');assert.equal(b.held,'5.0000');assert.equal((await funding(f.store,scope)).amount,'5.0000')
 await release(f);assert.equal((await balance(f.store,'3',scope)).available,'15.0000')
 assert.equal(f.dump('ledger').filter(x=>x.kind==='confirmation').length,2)
})
test('reductions consume held income before available, and blocked debit remains payable',async()=>{
 const f=await setup();await confirm(f,'v1','10.0000');await release(f);await confirm(f,'v2','15.0000')
 await confirm(f,'v3','7.0000');let b=await balance(f.store,'3',scope);assert.equal(b.available,'7.0000');assert.equal(b.held,'0.0000')
 const row=await f.store.get('income',d.hash(['f','3']));assert.deepEqual(await a.totals(f.store,row),{available:70000n,held:0n})
 const fact=await f.store.get('facts','f');await f.store.put('facts','f',{...fact,pendingRevision:'next'})
 b=await balance(f.store,'3',scope);assert.equal(b.available,'0.0000');assert.equal(b.offset,'3.0000');assert.equal(b.held,'10.0000')
})
test('reconfirming a fact cannot duplicate income movements',async()=>{const f=await setup();await confirm(f,'v1','10.0000');await confirm(f,'v1','10.0000');assert.equal(f.dump('income_entries').length,1)})
test('trial/stopped boundaries reject confirmation and cannot be moved',async()=>{
 const f=await fixture(),t=await f.login('admin');await f.store.remove('routes',d.hash(scope))
 const input={...scope,from:'2026-09-01',mode:'trial',reason:'migration sample',sampleVerified:false,requestKey:'route-create-001'}
 assert.equal((await f.call(t,'POST','/modules/zhihu/engine-route',input)).code,0)
 const {assertNewRoute}=require('../cloudfunctions/opc-api/lib/routing')
 await assert.rejects(assertNewRoute(f.store,scope,'2026-09-01',true),/试算/)
 assert.equal((await f.call(t,'POST','/modules/zhihu/engine-route',{...input,from:'2026-10-01',requestKey:'route-create-002'})).statusCode,409)
})
test('legacy migration converts cents once, reconciles relay and retains approved state',()=>{
 const {migrateLegacy}=require('../scripts/legacy-migration.cjs'),output={}
 const tables={users:[{id:'3'}],projects:[{id:'1'}],earnings:[{id:'1',userId:'3',projectId:'1',amount:'60000.0000',status:'confirmed',sourceRef:'batch:1:item:1'}],withdrawal_requests:[{id:'1',userId:'3',amount:'5000.00',status:'approved'}],settlement_batches:[{id:'1'}],settlement_items:[{id:'1',batchId:'1',creatorId:'3'}],relay_logs:[{id:'1',batchId:'1',itemId:'1',earningId:'1',userId:'3',relayAmount:'600.0000'}]}
 const r=migrateLegacy(tables,(name,id,value)=>(output[name]??=[]).push(value),new Set())
 assert.deepEqual(r.blockers,[]);assert.equal(output.legacy_earnings[0].amountYuan,'600.0000');assert.equal(output.legacy_withdrawals[0].status,'approved');assert.equal(r.reconciliation.users['3'].available,'550.0000')
 tables.relay_logs[0].relayAmount='601.0000';assert.equal(migrateLegacy(tables,()=>{},new Set()).blockers.length,1)
})
