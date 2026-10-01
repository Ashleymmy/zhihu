const test=require('node:test'),assert=require('node:assert/strict'),{memory}=require('./cloud-memory.cjs'),d=require('../cloudfunctions/opc-api/lib/domain')
const {bootstrap}=require('../cloudfunctions/opc-api/lib/bootstrap'),{createMigration}=require('../cloudfunctions/opc-api/lib/migration')
test('bundled migration resumes immutable batches and never auto-seals business',async()=>{
 const f=memory(),migration=createMigration(f.store,f.db,'test',{ready:false,blockers:['cloud acceptance']})
 const batches=Array.from({length:5},(_,index)=>{const rows=[{_id:String(index+1),value:{id:String(index+1),role:'admin',isActive:true}}];return {action:'import',collection:'users',file:'users-'+String(index).padStart(6,'0')+'.json',rows,hash:d.hash(rows)}})
 const snapshot={manifest:{formatVersion:1,environmentId:'test',targetCounts:{users:5},batches:batches.map(b=>({file:b.file,hash:b.hash,collection:b.collection,count:1})),blockers:[],readyToSeal:true},batches}
 assert.equal((await bootstrap(f.store,migration,{},snapshot)).remainingBatches,2)
 const next=await bootstrap(f.store,migration,{},snapshot);assert.equal(next.status,'imported-awaiting-acceptance');assert.equal(next.verification.verified,true)
 assert.equal((await f.store.get('settings','migration')).status,'importing');assert.equal(f.dump('users').length,5)
 assert.equal((await bootstrap(f.store,migration,{},snapshot)).verification.verified,true)
})
test('migration copies and rechecks original invoice bytes before removing its blocker',async()=>{
 const f=memory(),migration=createMigration(f.store,f.db,'test',{ready:false,blockers:['acceptance']}),bytes=Buffer.from('%PDF-1.4\nTest invoice'),hash=d.hash(bytes.toString('base64'))
 const rows=[{_id:'3',value:{id:'3',migrationSource:'withdrawal_requests',invoicePath:'wd-3.pdf',status:'pending'}}],batch={action:'import',collection:'legacy_withdrawals',file:'legacy_withdrawals-000000.json',rows,hash:d.hash(rows)}
 const snapshot={manifest:{formatVersion:1,environmentId:'test',targetCounts:{legacy_withdrawals:1},batches:[{file:batch.file,hash:batch.hash,collection:batch.collection,count:1}],blockers:[{table:'withdrawal_requests',id:'3',reason:'Invoice bytes must be copied to private cloud storage and hash verified'}],readyToSeal:false},batches:[batch],assets:[{withdrawalId:'3',base64:bytes.toString('base64'),hash}]}
 let uploads=0;const cloud={uploadFile:async()=>{uploads++;return {fileID:'cloud://test.bucket/sealed-invoices/test.pdf'}},downloadFile:async()=>({fileContent:bytes})}
 const first=await bootstrap(f.store,migration,cloud,snapshot);assert.equal(first.verification.verified,true);assert.deepEqual(first.verification.blockers,[])
 assert.equal((await bootstrap(f.store,migration,cloud,snapshot)).verification.verified,true);assert.equal(uploads,1)
 assert.equal((await f.store.get('legacy_withdrawals','3')).invoiceHash,hash)
})

test('collection initialization tolerates existing resources independently of SDK wording',async()=>{
 const {ensureCollection}=require('../cloudfunctions/opc-api/lib/migration'),existing=new Set(['opc_settings']);let created=0
 const db={collection:name=>({count:async()=>{if(!existing.has(name))throw Error('missing');return {total:0}}}),createCollection:async name=>{created++;if(existing.has(name))throw Error('ResourceExist');existing.add(name)}}
 await ensureCollection(db,'opc_settings');assert.equal(created,0)
 await ensureCollection(db,'opc_users');assert.equal(created,1)
 await ensureCollection(db,'opc_users');assert.equal(created,1)
 let reads=0
 await ensureCollection({collection:()=>({count:async()=>{if(reads++===0)throw Error('temporary');return {total:0}}}),createCollection:async()=>{throw Error('table exist')}},'opc_settings')
 await assert.rejects(ensureCollection({collection:()=>({count:async()=>{throw Error('missing')}}),createCollection:async()=>{throw Error('quota reached')}},'opc_users'),/quota reached/)
})

test('migration diagnostics never include raw messages, credentials or document values',()=>{
 const {diagnostic}=require('../cloudfunctions/opc-api/lib/migration-diagnostic')
 const error=Object.assign(Error('database.createCollection:fail collection already exists secret=private-value'),{errCode:-502001,event:{secret:'private-value'}})
 const result=diagnostic(error,'initialize.collection:opc_settings')
 assert.equal(result.phase,'initialize.collection:opc_settings');assert.equal(result.sdkCode,-502001);assert.equal(result.category,'collection-exists');assert.equal(result.operation,'database.createCollection')
 assert.equal(JSON.stringify(result).includes('private-value'),false);assert.equal(result.message,undefined);assert.equal(result.event,undefined)
})
