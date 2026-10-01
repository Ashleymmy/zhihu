const fs=require('node:fs'),path=require('node:path')
const d=require('../cloudfunctions/opc-api/lib/domain')
const directory=path.resolve(__dirname,'../../.runtime/cloud-migration')
const read=file=>JSON.parse(fs.readFileSync(path.join(directory,file),'utf8').replace(/^\uFEFF/,''))
const manifest=read('manifest.json'),settings=read('cloud-readback/settings.json')
const state=settings.find(row=>row._id==='migration')
if(!state)throw Error('Cloud migration manifest missing')
const batches=manifest.batches.map(batch=>read(batch.file)),invoiceChecks=[]
for(const batch of batches)for(const row of batch.rows)if(row.value.migrationSource==='withdrawal_requests'&&row.value.invoicePath){
  const file=path.resolve(__dirname,'../../server/uploads/invoices',path.basename(row.value.invoicePath))
  const hash=d.hash(fs.readFileSync(file).toString('base64')),receipt=settings.find(row=>row._id==='asset-'+hash)
  if(!receipt||receipt.hash!==hash||receipt.withdrawalId!==row.value.id||!receipt.fileID.startsWith('cloud://'+manifest.environmentId+'.')||!receipt.fileID.endsWith('/sealed-invoices/legacy-'+row.value.id+'/'+hash+'.pdf'))throw Error('Cloud invoice receipt does not match source asset')
  row.value.invoiceFileID=receipt.fileID;row.value.invoiceHash=hash
  manifest.blockers=manifest.blockers.filter(b=>!(b.table==='withdrawal_requests'&&b.id===row.value.id&&b.reason==='Invoice bytes must be copied to private cloud storage and hash verified'))
  const downloaded=path.join(directory,'cloud-readback','invoice-'+hash+'.pdf')
  invoiceChecks.push({sourceHash:hash,receiptMatches:true,cloudByteReadbackVerified:fs.existsSync(downloaded)&&d.hash(fs.readFileSync(downloaded).toString('base64'))===hash})
}
for(const batch of batches){batch.hash=d.hash(batch.rows);manifest.batches.find(row=>row.file===batch.file).hash=batch.hash}
manifest.readyToSeal=manifest.blockers.length===0
const manifestMatches=d.hash(manifest)===state.manifestHash&&d.hash(state.manifest)===state.manifestHash
const missing=[],mismatched=[],invalidCounts=[],receiptsMissing=[]
let checkedDocuments=0
for(const [collection,expected]of Object.entries(manifest.targetCounts)){
  const documents=read('cloud-readback/'+collection+'.json')
  if(documents.length!==expected)invalidCounts.push(collection)
  const byId=new Map(documents.map(({_id,...value})=>[String(_id),value]))
  for(const batch of batches.filter(b=>b.collection===collection)){
    const rows=batch.rows.map(row=>{const value=byId.get(row._id);if(!value)missing.push(batch.file);return {_id:row._id,value:value??null}})
    if(d.hash(rows)!==batch.hash)mismatched.push(batch.file)
    const receipt=settings.find(row=>row._id==='batch-'+d.hash([state.manifestHash,batch.file]))
    if(!receipt||receipt.hash!==batch.hash||receipt.collection!==batch.collection||d.hash(receipt.ids)!==d.hash(batch.rows.map(r=>r._id)))receiptsMissing.push(batch.file)
    checkedDocuments+=rows.length
  }
}
const databaseVerified=manifestMatches&&!missing.length&&!mismatched.length&&!invalidCounts.length&&!receiptsMissing.length
const report={checkedAt:new Date().toISOString(),environmentId:manifest.environmentId,source:'local development MySQL snapshot',method:'Official CLI readback; hash compared against local source batches and downloaded invoice bytes',manifestMatches,checkedBatches:batches.length,checkedDocuments,missing:[...new Set(missing)],mismatched,invalidCounts,receiptsMissing,blockers:manifest.blockers,invoiceChecks,databaseVerified,verified:databaseVerified&&invoiceChecks.every(row=>row.cloudByteReadbackVerified),cloudStatus:state.status,businessEnabled:false}
fs.writeFileSync(path.resolve(__dirname,'../cloudbase/import-verification.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
if(!report.verified)process.exitCode=1
