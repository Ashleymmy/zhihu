const test=require('node:test'),assert=require('node:assert/strict'),{fixture,scope}=require('./cloud-fixture.cjs'),d=require('../cloudfunctions/opc-api/lib/domain')
test('relay batch preserves rule priority, exact decimal conversion and one approval',async()=>{
 const f=await fixture(),admin=await f.login('admin');await f.store.remove('routes',d.hash(scope));await f.store.put('projects','1',{id:'1',slug:'zhihu',isEnabled:true})
 for(const [role,percentage]of [['creator','0.6'],['leader','0.1']])assert.equal((await f.call(admin,'POST','/modules/zhihu/finance/rules',{targetRole:role,method:'percentage',percentage,requestKey:'rule-'+role+'-001'})).code,0)
 const created=await f.call(admin,'POST','/modules/zhihu/finance/batches',{title:'Exact settlement',periodStart:'2026-08-01',periodEnd:'2026-08-31',items:[{creatorId:'3',sourceAmount:'800.5000'}],requestKey:'batch-create-001'})
 assert.equal(created.code,0);const path='/modules/zhihu/finance/batches/'+created.data.id+'/approve',body={requestKey:'batch-approve-001'}
 assert.equal((await f.call(admin,'POST',path,body)).code,0);assert.equal((await f.call(admin,'POST',path,body)).code,0)
 const rows=f.dump('legacy_earnings');assert.equal(rows.length,2);assert.equal(rows.find(e=>e.userId==='3').amount,'48030.0000');assert.equal(rows.find(e=>e.userId==='2').amountYuan,'80.0500')
 assert.equal((await f.call(admin,'POST',path,{requestKey:'batch-approve-002'})).statusCode,409)
})
test('callback rotation returns once-scoped secret without storing plaintext in idempotency records',async()=>{
 process.env.OPC_CALLBACK_KEY='a'.repeat(64)
 try{const f=await fixture(),admin=await f.login('admin'),creator=await f.login('creator'),body={...scope,requestKey:'rotate-secret-001'}
 const first=await f.call(admin,'POST','/modules/zhihu/callbacks/secret/rotate',body),retry=await f.call(admin,'POST','/modules/zhihu/callbacks/secret/rotate',body)
 assert.equal(first.code,0);assert.equal(first.data.signKey,retry.data.signKey);assert.ok(!JSON.stringify(f.dump('requests')).includes(first.data.signKey))
 assert.equal((await f.call(creator,'GET','/modules/zhihu/callbacks/secret',scope)).statusCode,403)
 }finally{delete process.env.OPC_CALLBACK_KEY}
})
