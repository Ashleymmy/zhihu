const test=require('node:test'),assert=require('node:assert/strict'),{fixture,scope}=require('./cloud-fixture.cjs')
async function prepare(){const f=await fixture();await f.store.put('bindings','b',{id:'b',leaderId:'2',executorId:'3',verificationStatus:'passed'});await f.store.put('facts','f',{id:'f',...scope,date:'2026-09-01',version:'v1',bindingId:'b',orders:'1',allocations:[{userId:'2',amount:'3.0000'},{userId:'3',amount:'7.0000'}]});return f}
test('statement payer ownership, lower-before-upper and financial confirmation stay separate',async()=>{
 const f=await prepare(),leader=await f.login('leader'),admin=await f.login('admin'),creator=await f.login('creator')
 const upper=(await f.call(admin,'POST','/modules/zhihu/statements/preview',{...scope,factId:'f',requestKey:'upper-preview-001'})).data.entries[0]
 assert.equal(upper.targetAmount,'10.0000')
 assert.equal((await f.call(admin,'POST','/modules/zhihu/statements/'+upper.id+'/confirm',{...scope,expectedHash:upper.inputHash,requestKey:'upper-confirm-001'})).statusCode,409)
 const lower=(await f.call(leader,'POST','/modules/zhihu/statements/preview',{...scope,factId:'f',requestKey:'lower-preview-001'})).data.entries[0]
 assert.equal(lower.targetAmount,'7.0000')
 assert.equal((await f.call(creator,'POST','/modules/zhihu/statements/'+lower.id+'/confirm',{...scope,expectedHash:lower.inputHash,requestKey:'forged-confirm-001'})).statusCode,403)
 assert.equal((await f.call(leader,'POST','/modules/zhihu/statements/'+lower.id+'/confirm',{...scope,expectedHash:lower.inputHash,requestKey:'lower-confirm-001'})).code,0)
 assert.equal((await f.call(admin,'POST','/modules/zhihu/statements/'+upper.id+'/confirm',{...scope,expectedHash:upper.inputHash,requestKey:'upper-confirm-002'})).code,0)
 assert.equal(f.dump('income').length,0)
 const period={...scope,from:'2026-09-01',to:'2026-09-01'},report=await f.call(admin,'GET','/modules/zhihu/workbench',period)
 assert.equal((await f.call(admin,'POST','/modules/zhihu/workbench/confirm',{...period,acknowledged:true,reviewHash:report.data.reviewHash,requestKey:'financial-confirm-001'})).code,0)
 assert.equal(f.dump('income').length,2);assert.equal(f.dump('statements').length,2)
})
test('statement confirmation rolls back an entire batch with one stale fact',async()=>{
 const f=await prepare(),admin=await f.login('admin'),leader=await f.login('leader')
 const lower=(await f.call(leader,'POST','/modules/zhihu/statements/preview',{...scope,factId:'f',requestKey:'draft-preview-001'})).data.entries[0]
 const fact=await f.store.get('facts','f');await f.store.put('facts','f',{...fact,pendingRevision:'rev'})
 assert.equal((await f.call(leader,'POST','/modules/zhihu/statements/confirm-batch',{...scope,entries:[{id:lower.id,expectedHash:lower.inputHash}],requestKey:'batch-confirm-001'})).statusCode,409)
 assert.equal((await f.store.get('statements',lower.id)).status,'draft')
 assert.equal((await f.call(admin,'GET','/modules/zhihu/statements',scope)).data.total,1)
})
