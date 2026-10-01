const d=require('./domain')
const {authorize}=require('./store')
async function owned(store,user,scope,id,purpose){
  const file=await store.get('files',id)
  if(!file||file.userId!==user.id||file.projectId!==scope.projectId||file.accountId!==scope.accountId||purpose&&file.purpose!==purpose)d.fail('无权使用此文件',403)
  if(!file.fileID)d.fail('请先完成文件上传')
  return file
}
async function download(cloud,file,max=10*1024*1024){
  const result=await cloud.downloadFile({fileID:file.fileID})
  const buffer=result.fileContent
  if(!Buffer.isBuffer(buffer)||buffer.length>max||!buffer.length)d.fail('文件大小不正确')
  return buffer
}
function register(r){
  require('./file-relay').register(r)
  r('POST','/core/files/prepare',async c=>{
    const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const purpose=c.data.purpose;if(!['report','payment-proof','alliance-xlsx'].includes(purpose))d.fail('文件用途不正确')
    d.duty(c.user,purpose==='alliance-xlsx'?'operations':'finance')
    const filename=d.text(c.data.name,'文件名',128),ext=filename.split('.').pop().toLowerCase()
    if(['report','alliance-xlsx'].includes(purpose)?ext!=='xlsx':!['png','jpg','jpeg','pdf'].includes(ext))d.fail('文件类型不支持')
    const id=d.uid(),cloudPath='private/'+c.identity.openid+'/'+purpose+'/'+id+'.'+ext
    await c.store.put('files',id,{id,...scope,userId:c.user.id,openid:c.identity.openid,purpose,name:filename,cloudPath,uploadTransport:'cloud-function',createdAt:d.now()})
    return {id,cloudPath,upload:require('./file-relay').descriptor(purpose)}
  })
  r('POST','/core/files/:id/complete',async c=>{
    const file=await c.store.get('files',c.params.id)
    if(!file||file.userId!==c.user.id||file.openid!==c.identity.openid)d.fail('无权使用此文件',403)
    if(file.upload||file.uploadTransport==='cloud-function')d.fail('此文件使用云函数上传，请调用 finish-upload 完成',409)
    if(file.purpose==='invoice'){
      const withdrawal=await c.store.get('legacy_withdrawals',file.withdrawalId)
      if(!withdrawal||withdrawal.userId!==c.user.id||withdrawal.settleType!=='corporate')d.fail('无权上传此发票',403)
    }else{d.duty(c.user,file.purpose==='alliance-xlsx'?'operations':'finance');await authorize(c.store,c.user,{projectId:file.projectId,accountId:file.accountId})}
    if(typeof c.data.fileID!=='string'||!c.data.fileID.startsWith('cloud://')||!c.data.fileID.endsWith('/'+file.cloudPath))d.fail('文件路径不匹配')
    const prefix=c.data.fileID.slice(8).split('/')[0]
    if(!prefix.startsWith(c.environment+'.'))d.fail('文件不属于当前云环境')
    await c.store.put('files',file.id,{...file,fileID:c.data.fileID});return {id:file.id}
  })
  r('POST','/modules/zhihu/withdrawals/:id/invoice/prepare',async c=>{
    const w=await c.store.get('legacy_withdrawals',c.params.id)
    if(!w||w.userId!==c.user.id||w.settleType!=='corporate')d.fail('仅申请人可为对公提现上传发票',403)
    if(['approved','cancelled','rejected'].includes(w.status))d.fail('申请已结束，不可修改发票',409)
    const name=d.text(c.data.name,'文件名',128),ext=name.split('.').pop().toLowerCase()
    if(!['png','jpg','jpeg','webp','pdf'].includes(ext))d.fail('发票须为图片或 PDF')
    const id=d.uid(),cloudPath='private/'+c.identity.openid+'/invoice/'+id+'.'+ext
    await c.store.put('files',id,{id,userId:c.user.id,openid:c.identity.openid,withdrawalId:w.id,purpose:'invoice',name,cloudPath,uploadTransport:'cloud-function',createdAt:d.now()});return {id,cloudPath,upload:require('./file-relay').descriptor('invoice')}
  })
  r('POST','/modules/zhihu/withdrawals/:id/invoice',async c=>{
    const {mutate}=require('./legacy-finance'),file=await c.store.get('files',d.id(c.data.fileId))
    if(!file||file.userId!==c.user.id||file.withdrawalId!==c.params.id||file.purpose!=='invoice'||!file.fileID)d.fail('无权使用此发票',403)
    const buffer=await download(c.cloud,file,5*1024*1024),hash=d.hash(buffer.toString('base64'))
    const type=buffer.subarray(0,5).toString()==='%PDF-'?'pdf':buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':buffer.subarray(0,3).equals(Buffer.from([255,216,255]))?'jpg':buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP'?'webp':null
    if(!type)d.fail('发票内容格式不正确')
    const w=await c.store.get('legacy_withdrawals',c.params.id)
    if(!w||w.userId!==c.user.id||w.settleType!=='corporate')d.fail('无权上传此发票',403)
    const saved=await c.cloud.uploadFile({cloudPath:'sealed-invoices/'+w.id+'/'+hash+'.'+type,fileContent:buffer})
    return mutate(c,'legacy.invoice.attach',{id:w.id,fileId:file.id,hash},async tx=>{
      const row=await tx.get('legacy_withdrawals',w.id)
      if(row.userId!==c.user.id||['approved','cancelled','rejected'].includes(row.status))d.fail('申请已变化，不可修改发票',409)
      await tx.put('legacy_withdrawals',row.id,{...row,invoiceFileID:saved.fileID,invoiceHash:hash,invoiceName:file.name,invoiceUploadedAt:d.now()});return {id:row.id,name:file.name}
    })
  })
  r('GET','/modules/zhihu/withdrawals/:id/invoice',async c=>{
    d.finance(c.user);const w=await c.store.get('legacy_withdrawals',c.params.id)
    if(!w||!await require('./legacy-finance').visible(c.store,c.user,w))d.fail('无权查看发票',403)
    if(!w.invoiceFileID)d.fail('发票尚未迁入云存储或未上传',404)
    const bytes=await download(c.cloud,{fileID:w.invoiceFileID},5*1024*1024)
    if(d.hash(bytes.toString('base64'))!==w.invoiceHash)d.fail('发票内容核对失败',409)
    const result=await c.cloud.getTempFileURL({fileList:[{fileID:w.invoiceFileID,maxAge:60}]})
    if(!result.fileList?.[0]?.tempFileURL)d.fail('获取发票失败',503)
    return {url:result.fileList[0].tempFileURL,name:w.invoiceName}
  })
  r('POST','/core/finance/withdrawals/:id/pay',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data),reference=d.text(c.data.reference,'付款流水号',128),paidOn=d.day(c.data.paidOn)
    if(c.data.acknowledged!==true||paidOn>d.today()||reference.length<4)d.fail('请核对付款流水、付款日期并确认实际付款')
    const file=await owned(c.store,c.user,scope,d.id(c.data.fileId),'payment-proof'),buffer=await download(c.cloud,file,5*1024*1024)
    if(!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&!buffer.subarray(0,3).equals(Buffer.from([255,216,255]))&&buffer.subarray(0,5).toString()!=='%PDF-')d.fail('凭证内容须为 PNG、JPG 或 PDF')
    const proofHash=d.hash(buffer.toString('base64'))
    await authorize(c.store,c.user,scope)
    const current=d.belongs(await c.store.get('withdrawals',c.params.id),scope)
    if(!['approved','paid'].includes(current.status))d.fail('仅已批准申请可登记付款',409)
    const saved=await c.cloud.uploadFile({cloudPath:'sealed-proofs/'+c.params.id+'/'+proofHash+'.'+file.name.split('.').pop().toLowerCase(),fileContent:buffer})
    return c.store.transaction(async tx=>{
      await tx.lock(['scope',scope]);await authorize(tx,c.user,scope);const w=d.belongs(await tx.get('withdrawals',c.params.id),scope)
      if(w.status==='paid'){if(w.paymentReference===reference&&w.proofHash===proofHash&&w.paidOn===paidOn)return {id:w.id};d.fail('付款记录已存在',409)}
      if(w.status!=='approved')d.fail('仅已批准申请可登记付款',409)
      const funds=await require('./finance').balance(tx,w.userId,scope);if(d.cash(funds.offset)>0n)d.fail('余额不足，请先核对收入',409)
      await tx.unique('payment-reference',[scope.accountId,reference],w.id)
      await tx.put('withdrawals',w.id,{...w,status:'paid',paymentReference:reference,paidOn,proofFileId:file.id,proofSnapshot:saved.fileID,proofHash,proofName:file.name,paidBy:c.user.id})
      const ledgerId=d.hash(['payment',w.id])
      await tx.put('ledger',ledgerId,{id:ledgerId,...scope,kind:'payment',userId:w.userId,withdrawalId:w.id,amount:w.amount,reference,paidOn,proofHash,operatorId:c.user.id,createdAt:d.now()})
      await tx.audit(c.user,'withdrawal.pay',w.id,{reference,proofHash});return {id:w.id}
    })
  })
  r('GET','/core/finance/withdrawals/:id/proof',async c=>{
    const scope=d.scopeOf(c.data);d.finance(c.user);await authorize(c.store,c.user,scope)
    const w=d.belongs(await c.store.get('withdrawals',c.params.id),scope)
    if(c.user.role!=='admin'&&w.userId!==c.user.id)d.fail('无权查看付款凭证',403)
    const file=w.proofFileId?await c.store.get('files',w.proofFileId):null;if(!file)d.fail('暂无付款凭证',404)
    const fileID=w.proofSnapshot||file.fileID,content=await download(c.cloud,{fileID},5*1024*1024)
    if(d.hash(content.toString('base64'))!==w.proofHash)d.fail('付款凭证与登记内容不一致，请联系财务核查',409)
    const result=await c.cloud.getTempFileURL({fileList:[{fileID,maxAge:60}]})
    if(!result.fileList?.[0]?.tempFileURL)d.fail('获取付款凭证失败，请重试',503)
    return {url:result.fileList[0].tempFileURL,name:file.name}
  })
}
module.exports={register,owned,download}
