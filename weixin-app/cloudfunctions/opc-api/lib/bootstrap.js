const d=require('./domain')
// Runs only behind opc-admin's control-plane identity and migration-secret gates.
async function bootstrap(store,migration,cloud,snapshot,reportStage=()=>{}){
  if(!snapshot?.manifest||!Array.isArray(snapshot.batches))d.fail('部署包未包含迁移快照',409)
  reportStage('bootstrap.state')
  const state=await store.get('settings','migration').catch(error=>{if(/collection|not exist|不存在/i.test(error.message||error.errMsg||''))return null;throw error})
  if(state?.status==='sealed')d.fail('迁移已关闭',409)
  const working=d.clean(snapshot),assets=working.assets||[]
  for(const asset of assets){
    const row=working.batches.flatMap(b=>b.rows).find(r=>r.value.migrationSource==='withdrawal_requests'&&r.value.id===asset.withdrawalId)
    if(!row)d.fail('发票对应提现记录缺失',409)
    const content=Buffer.from(asset.base64,'base64')
    if(d.hash(content.toString('base64'))!==asset.hash||content.length>5*1024*1024||content.subarray(0,5).toString()!=='%PDF-')d.fail('历史发票内容校验失败',409)
    let fileID
    if(state){
      // Deterministic contents are already part of the registered manifest's batch hash.
      const receipt=await store.get('settings','asset-'+asset.hash);if(receipt)fileID=receipt.fileID
    }
    if(!fileID){
      reportStage('bootstrap.invoice.upload')
      const uploaded=await cloud.uploadFile({cloudPath:'sealed-invoices/legacy-'+asset.withdrawalId+'/'+asset.hash+'.pdf',fileContent:content})
      reportStage('bootstrap.invoice.download')
      const downloaded=await cloud.downloadFile({fileID:uploaded.fileID})
      if(!Buffer.isBuffer(downloaded.fileContent)||d.hash(downloaded.fileContent.toString('base64'))!==asset.hash)d.fail('云端历史发票校验失败',409)
      fileID=uploaded.fileID
    }
    row.value.invoiceFileID=fileID;row.value.invoiceHash=asset.hash
    asset.fileID=fileID
    working.manifest.blockers=working.manifest.blockers.filter(b=>!(b.table==='withdrawal_requests'&&b.id===asset.withdrawalId&&b.reason==='Invoice bytes must be copied to private cloud storage and hash verified'))
  }
  for(const batch of working.batches){batch.hash=d.hash(batch.rows);working.manifest.batches.find(b=>b.file===batch.file).hash=batch.hash}
  working.manifest.readyToSeal=working.manifest.blockers.length===0
  reportStage('bootstrap.initialize')
  const initialized=await migration.handle({action:'initialize',manifest:working.manifest})
  reportStage('bootstrap.invoice.receipt')
  for(const asset of assets)await store.put('settings','asset-'+asset.hash,{fileID:asset.fileID,hash:asset.hash,withdrawalId:asset.withdrawalId})
  let imported=0,remaining=0
  for(const batch of working.batches){
    const receipt=await store.get('settings','batch-'+d.hash([initialized.manifestHash,batch.file]))
    if(receipt)continue
    if(imported>=3){remaining++;continue}
    await migration.handle(batch);imported++
  }
  if(remaining)return {status:'importing',importedBatches:imported,remainingBatches:remaining,nextAction:'bootstrap'}
  const verification=await migration.handle({action:'verify'})
  return {status:verification.verified?'imported-awaiting-acceptance':'verification-failed',verification}
}
module.exports={bootstrap}
