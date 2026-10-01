const test=require('node:test')
const assert=require('node:assert/strict')
const {fixture}=require('./cloud-fixture.cjs')
const d=require('../cloudfunctions/opc-api/lib/domain')
const {processRow}=require('../cloudfunctions/opc-api/lib/imports')
const {run}=require('../cloudfunctions/opc-api/lib/worker')
const XLSX=require('../cloudfunctions/opc-api/node_modules/xlsx')
const scope={projectId:'1',accountId:'10'}
test('upload completion rejects another user, environment and path, then accepts the assigned file',async()=>{
  const f=await fixture(),admin=await f.login('admin'),finance=await f.login('finance')
  const prepared=await f.call(admin,'POST','/core/files/prepare',{...scope,purpose:'report',name:'test.xlsx'})
  assert.equal(prepared.code,0,prepared.message)
  // Direct completion is retained only for files prepared by older versions.
  const legacy=await f.store.get('files',prepared.data.id);delete legacy.uploadTransport
  await f.store.put('files',legacy.id,legacy)
  const endpoint='/core/files/'+prepared.data.id+'/complete',fileID='cloud://test.bucket/'+prepared.data.cloudPath
  assert.equal((await f.call(finance,'POST',endpoint,{fileID})).statusCode,403)
  assert.equal((await f.call(admin,'POST',endpoint,{fileID:fileID.replace('test.bucket','wrong.bucket')})).statusCode,422)
  assert.equal((await f.call(admin,'POST',endpoint,{fileID:fileID+'bad'})).statusCode,422)
  assert.equal((await f.call(admin,'POST',endpoint,{fileID})).code,0)
})
test('real XLSX preview and durable import produce a visible exception for missing ownership',async()=>{
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['日期','渠道名称','关键词','搜索量','订单','收益'],['2026-09-01','test-channel','new-word',10,2,5]]),'Report')
  const buffer=XLSX.write(wb,{type:'buffer',bookType:'xlsx'})
  const f=await fixture({downloadFile:async()=>({fileContent:buffer}),uploadFile:async()=>({fileID:'sealed-report'})}),token=await f.login('finance')
  await f.store.put('files','100',{id:'100',...scope,userId:'4',purpose:'report',fileID:'file',name:'report.xlsx'})
  const prepared=await f.call(token,'POST','/modules/zhihu/imports',{...scope,fileId:'100'})
  assert.equal(prepared.code,0,prepared.message)
  const info=await f.call(token,'GET','/modules/zhihu/imports/'+prepared.data.id,scope)
  assert.equal(info.data.rowCount,1);assert.equal(info.data.rows[0].value.keyword,'new-word')
  const data={...scope,previewHash:prepared.data.previewHash,requestKey:'import-test-001'}
  assert.equal((await f.call(token,'POST','/modules/zhihu/imports/'+prepared.data.id+'/commit',data)).code,0)
  await run(f.store)
  assert.equal((await f.store.get('imports',prepared.data.id)).status,'completed')
  assert.equal(f.dump('exceptions').length,1)
  assert.equal((await f.call(token,'POST','/modules/zhihu/imports',{...scope,fileId:'100'})).data.status,'completed')
})
test('later report corrections supersede pending revisions instead of leaving unresolvable items',async()=>{
  const f=await fixture(),row={date:'2026-09-01',channel:'test-channel',keyword:'word',orders:'1',search:'2',revenue:'0.0000'}
  await f.store.transaction(tx=>processRow(tx,scope,{value:row},'batch'))
  await f.store.transaction(tx=>processRow(tx,scope,{value:{...row,orders:'2'}},'batch-2'))
  await f.store.transaction(tx=>processRow(tx,scope,{value:{...row,orders:'3'}},'batch-3'))
  assert.equal(f.dump('revisions').filter(r=>r.status==='pending').length,1)
  assert.equal(f.dump('revisions').filter(r=>r.status==='superseded').length,1)
})
test('payment validates actual proof, is replay-safe, and stores one immutable ledger event',async()=>{
  const f=await fixture({downloadFile:async()=>({fileContent:Buffer.from('%PDF-test-proof')}),uploadFile:async()=>({fileID:'sealed-proof'})}),token=await f.login('finance')
  await f.store.put('bindings','60',{id:'60',verificationStatus:'passed'})
  await f.store.put('facts','fact',{id:'fact',...scope,bindingId:'60',version:'v1'})
  await f.store.put('income','income',{id:'income',...scope,factId:'fact',version:'v1',userId:'3',amount:'10.0000',availability:'available'})
  await f.store.put('withdrawals','80',{id:'80',...scope,userId:'3',amount:'5.0000',status:'approved'})
  await f.store.put('files','100',{id:'100',...scope,userId:'4',purpose:'payment-proof',fileID:'file',name:'proof.pdf'})
  const path='/core/finance/withdrawals/80/pay',data={...scope,fileId:'100',reference:'bank-001',paidOn:d.today(),acknowledged:true}
  assert.equal((await f.call(token,'POST',path,{...data,acknowledged:false})).statusCode,422)
  assert.equal((await f.call(token,'POST',path,data)).code,0)
  assert.equal((await f.call(token,'POST',path,data)).code,0)
  assert.equal(f.dump('ledger').filter(e=>e.kind==='payment').length,1)
  assert.equal((await f.call(token,'POST',path,{...data,reference:'bank-002'})).statusCode,409)
})
test('report downloads use sealed bytes even if original client upload changes',async()=>{
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['日期','渠道名称','关键词','搜索量','订单','收益'],['2026-09-01','channel','word',10,2,5]]),'Report')
  let source=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),sealed,urlFile
  const f=await fixture({downloadFile:async({fileID})=>({fileContent:fileID==='sealed'?sealed:source}),uploadFile:async({cloudPath,fileContent})=>{assert.ok(cloudPath.startsWith('sealed-reports/'));sealed=Buffer.from(fileContent);return {fileID:'sealed'}},getTempFileURL:async({fileList})=>{urlFile=fileList[0].fileID;return {fileList:[{tempFileURL:'https://example.com/private-report'}]}}})
  const token=await f.login('finance');await f.store.put('files','100',{id:'100',...scope,userId:'4',purpose:'report',fileID:'source',name:'report.xlsx'})
  const created=await f.call(token,'POST','/modules/zhihu/imports',{...scope,fileId:'100'});assert.equal(created.code,0,created.message)
  source=Buffer.from('modified by uploader')
  const result=await f.call(token,'GET','/modules/zhihu/imports/'+created.data.id+'/file',scope)
  assert.equal(result.code,0);assert.equal(urlFile,'sealed')
  sealed=Buffer.from('corrupted sealed copy')
  assert.equal((await f.call(token,'GET','/modules/zhihu/imports/'+created.data.id+'/file',scope)).code,40900)
})
test('report preparation resumes after a committed 20-row checkpoint',async()=>{
  const wb=XLSX.utils.book_new(),rows=[['日期','渠道名称','关键词','搜索量','订单','收益']]
  for(let i=0;i<35;i++)rows.push(['2026-09-01','channel','word-'+i,10,2,5])
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Report');const buffer=XLSX.write(wb,{type:'buffer',bookType:'xlsx'})
  const f=await fixture({downloadFile:async()=>({fileContent:buffer}),uploadFile:async()=>({fileID:'sealed-report'})}),token=await f.login('finance')
  await f.store.put('files','100',{id:'100',...scope,userId:'4',purpose:'report',fileID:'source',name:'report.xlsx'})
  const runTransaction=f.db.runTransaction.bind(f.db);let failOnce=true
  f.db.runTransaction=work=>runTransaction(tx=>work({collection(name){
    const col=tx.collection(name)
    return {...col,doc(id){
      const doc=col.doc(id)
      return {...doc,async set(value){
        if(name==='opc_import_rows'&&String(id).endsWith('000020')&&failOnce){failOnce=false;throw Error('synthetic interruption')}
        return doc.set(value)
      }}
    }}
  }}))
  const originalError=console.error;console.error=()=>{}
  let response;try{response=await f.call(token,'POST','/modules/zhihu/imports',{...scope,fileId:'100'})}finally{console.error=originalError}
  assert.equal(response.code,50000)
  let batch=f.dump('imports')[0];assert.equal(batch.prepareCursor,20);assert.equal(f.dump('import_rows').length,20)
  await f.store.put('imports',batch.id,{...batch,leaseUntil:0})
  response=await f.call(token,'POST','/modules/zhihu/imports',{...scope,fileId:'100'})
  assert.equal(response.code,0,response.message);assert.equal(response.data.status,'preview')
  batch=await f.store.get('imports',batch.id);assert.equal(batch.prepareCursor,35);assert.equal(f.dump('import_rows').length,35)
})
