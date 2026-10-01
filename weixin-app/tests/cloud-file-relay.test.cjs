const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {fixture,scope,identity}=require('./cloud-fixture.cjs')
const {CHUNK_BYTES}=require('../cloudfunctions/opc-api/lib/file-relay')
function storage(){
  const objects=new Map();let writes=0,failOnce=false,deleteFails=false
  return {objects,get writes(){return writes},fail(){failOnce=true},failDelete(value){deleteFails=value},cloud:{
    uploadFile:async({cloudPath,fileContent})=>{if(failOnce){failOnce=false;throw Error('synthetic storage interruption')}const fileID='cloud://test.bucket/'+cloudPath;objects.set(fileID,Buffer.from(fileContent));writes++;return {fileID}},
    downloadFile:async({fileID})=>({fileContent:objects.get(fileID)}),
    deleteFile:async({fileList})=>{if(deleteFails)throw Error('synthetic cleanup interruption');for(const id of fileList)objects.delete(id);return {fileList:fileList.map(fileID=>({fileID,status:0}))}}
  }}
}
async function setup(purpose='report',name='report.xlsx'){
  const s=storage(),f=await fixture(s.cloud),token=await f.login('finance'),prepared=await f.call(token,'POST','/core/files/prepare',{...scope,purpose,name})
  assert.equal(prepared.code,0,prepared.message);assert.equal(prepared.data.upload.transport,'cloud-function')
  const id=prepared.data.id
  const part=(buffer,index=0,totalBytes=buffer.length,t=token)=>f.call(t,'POST','/core/files/'+id+'/upload-chunk',{index,totalBytes,base64:buffer.toString('base64')})
  const finish=(t=token)=>f.call(t,'POST','/core/files/'+id+'/finish-upload')
  return {...f,s,token,id,part,finish}
}
test('server relay assembles out-of-order chunks, deduplicates retries and cleans temporary objects',async()=>{
  const f=await setup(),first=Buffer.alloc(CHUNK_BYTES,17),last=Buffer.from('last chunk'),total=first.length+last.length
  assert.equal((await f.part(last,1,total)).code,0)
  assert.equal((await f.finish()).code,40900)
  assert.equal((await f.part(first,0,total)).code,0)
  assert.equal((await f.part(first,0,total)).code,0);assert.equal(f.s.writes,2)
  const done=await f.finish();assert.equal(done.code,0,done.message)
  const file=await f.store.get('files',f.id),expected=Buffer.concat([first,last])
  assert.deepEqual(f.s.objects.get(file.fileID),expected)
  assert.equal(done.data.sha256,crypto.createHash('sha256').update(expected).digest('hex'))
  assert.equal(file.upload.chunksRemoved,true);assert.equal(f.s.objects.size,1)
  assert.deepEqual((await f.finish()).data,done.data);assert.equal(f.s.writes,3)
  assert.equal((await f.part(last,1,total)).code,0);assert.equal(f.s.objects.size,1)
})
test('relay rejects a different owner, WeChat identity, project permission or direct completion',async()=>{
  const f=await setup(),admin=await f.login('admin'),bytes=Buffer.from('one')
  assert.equal((await f.part(bytes,0,bytes.length,admin)).code,40300)
  assert.equal((await f.finish(admin)).code,40300)
  const otherIdentity={...identity,openid:'other-wechat'},other=await f.login('finance',otherIdentity)
  assert.equal((await f.call(other,'POST','/core/files/'+f.id+'/upload-chunk',{index:0,totalBytes:3,base64:bytes.toString('base64')},otherIdentity)).code,40300)
  assert.equal((await f.call(f.token,'POST','/core/files/'+f.id+'/complete',{fileID:'cloud://test.bucket/private/wrong'})).code,40900)
  const project=await f.store.get('projects','1');await f.store.put('projects','1',{...project,isEnabled:false})
  assert.equal((await f.part(bytes)).code,40300);assert.equal(f.s.writes,0)
})
test('relay enforces purpose size, chunk size, base64 and ordinary request limits before storing',async()=>{
  const f=await setup('payment-proof','proof.pdf'),path='/core/files/'+f.id+'/upload-chunk'
  for(const data of [{index:0,totalBytes:5*1024*1024+1,base64:'eA=='},{index:-1,totalBytes:1,base64:'eA=='},{index:0,totalBytes:3,base64:'eA=='},{index:0,totalBytes:1,base64:'eA==\n'},{index:0,totalBytes:1,base64:'eB=='}])assert.notEqual((await f.call(f.token,'POST',path,data)).code,0)
  assert.equal((await f.call(f.token,'POST',path,{index:0,totalBytes:1,base64:'A'.repeat(800*1024)})).code,41300)
  assert.equal((await f.call(f.token,'POST','/core/files/prepare',{...scope,purpose:'report',name:'x.xlsx',extra:'A'.repeat(129*1024)})).code,41300)
  assert.equal(f.s.writes,0)
})
test('uncertain chunk upload can resume but reserved content and file size cannot change',async()=>{
  const f=await setup(),bytes=Buffer.from('first')
  f.s.fail();const old=console.error;console.error=()=>{}
  try{assert.equal((await f.part(bytes)).code,50000)}finally{console.error=old}
  assert.equal((await f.part(Buffer.from('other'))).code,40900)
  assert.equal((await f.part(Buffer.from('bigger'))).code,40900)
  assert.equal((await f.part(bytes)).code,0);assert.equal((await f.finish()).code,0)
})
test('corrupt chunks are rejected, merge lease is released, and completion cleanup can resume',async()=>{
  const f=await setup(),bytes=Buffer.from('contents')
  await f.part(bytes)
  const file=await f.store.get('files',f.id),chunkID=file.upload.chunks[0].fileID
  f.s.objects.set(chunkID,Buffer.from('tampered'))
  assert.equal((await f.finish()).code,40900)
  assert.equal((await f.store.get('files',f.id)).upload.leaseUntil,0)
  f.s.objects.set(chunkID,bytes);f.s.failDelete(true)
  assert.equal((await f.finish()).code,0)
  assert.equal(f.s.objects.size,2)
  f.s.failDelete(false);assert.equal((await f.finish()).code,0);assert.equal(f.s.objects.size,1)
})
test('concurrent different content cannot overwrite the accepted chunk',async()=>{
  const f=await setup(),a=Buffer.from('first'),b=Buffer.from('other')
  const responses=await Promise.all([f.part(a),f.part(b)])
  assert.deepEqual(responses.map(row=>row.code).sort(),[0,40900])
  assert.equal((await f.finish()).code,0)
  const file=await f.store.get('files',f.id),winner=responses[0].code===0?a:b
  assert.deepEqual(f.s.objects.get(file.fileID),winner)
})
test('invoice relay is restricted to the applicant and rejects a finished withdrawal',async()=>{
  const s=storage(),f=await fixture(s.cloud),creator=await f.login('creator')
  await f.store.put('legacy_withdrawals','80',{id:'80',userId:'3',settleType:'corporate',status:'pending'})
  const prepared=await f.call(creator,'POST','/modules/zhihu/withdrawals/80/invoice/prepare',{name:'invoice.pdf'})
  assert.equal(prepared.code,0,prepared.message);assert.equal(prepared.data.upload.maxBytes,5*1024*1024)
  const path='/core/files/'+prepared.data.id+'/upload-chunk',data={index:0,totalBytes:5,base64:Buffer.from('%PDF-').toString('base64')}
  assert.equal((await f.call(creator,'POST',path,data)).code,0)
  await f.store.put('legacy_withdrawals','80',{id:'80',userId:'3',settleType:'corporate',status:'approved'})
  assert.equal((await f.call(creator,'POST','/core/files/'+prepared.data.id+'/finish-upload')).code,40900)
})
