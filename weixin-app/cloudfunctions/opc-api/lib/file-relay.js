const crypto=require('node:crypto'),d=require('./domain'),{authorize}=require('./store')
const CHUNK_BYTES=512*1024,MAX_BYTES=10*1024*1024,REQUEST_BYTES=720*1024
const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex')
const maxBytes=purpose=>['invoice','payment-proof'].includes(purpose)?5*1024*1024:MAX_BYTES
function descriptor(purpose){return {transport:'cloud-function',chunkBytes:CHUNK_BYTES,maxBytes:maxBytes(purpose)}}
async function access(c,store=c.store){
  const file=await store.get('files',c.params.id)
  if(!file||file.userId!==c.user.id||file.openid!==c.identity.openid)d.fail('无权使用此文件',403)
  if(file.purpose==='invoice'){
    const w=await store.get('legacy_withdrawals',file.withdrawalId)
    if(!w||w.userId!==c.user.id||w.settleType!=='corporate')d.fail('无权上传此发票',403)
    if(['approved','cancelled','rejected'].includes(w.status))d.fail('申请已结束，不可修改发票',409)
  }else{
    d.duty(c.user,file.purpose==='alliance-xlsx'?'operations':'finance')
    await authorize(store,c.user,{projectId:file.projectId,accountId:file.accountId})
  }
  return file
}
function result(file){return {id:file.id,size:file.size,sha256:file.sha256,complete:true}}
async function removeChunks(c,file){
  if(file.upload.chunksRemoved||typeof c.cloud.deleteFile!=='function')return
  const fileList=Object.values(file.upload.chunks).map(chunk=>chunk.fileID)
  try{
    const removed=await c.cloud.deleteFile({fileList})
    if(!Array.isArray(removed.fileList)||removed.fileList.length!==fileList.length||removed.fileList.some(row=>row.status!==0))return
    await c.store.transaction(async tx=>{const current=await tx.get('files',file.id);if(current?.upload?.status==='complete')await tx.put('files',file.id,{...current,upload:{...current.upload,chunksRemoved:true}})})
  }catch(_){/* Completed file remains usable; repeating completion retries temporary cleanup. */}
}
async function chunk(c){
  const file=await access(c),{index,totalBytes,base64}=c.data
  if(!Number.isSafeInteger(totalBytes)||totalBytes<1||totalBytes>maxBytes(file.purpose))d.fail('文件大小不正确',413)
  const totalChunks=Math.ceil(totalBytes/CHUNK_BYTES)
  if(!Number.isSafeInteger(index)||index<0||index>=totalChunks)d.fail('文件分片序号不正确')
  if(typeof base64!=='string'||base64.length>Math.ceil(CHUNK_BYTES/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))d.fail('文件分片编码不正确')
  const buffer=Buffer.from(base64,'base64'),size=index===totalChunks-1?totalBytes-index*CHUNK_BYTES:CHUNK_BYTES
  if(buffer.length!==size||buffer.toString('base64')!==base64)d.fail('文件分片大小不正确')
  const sha256=digest(buffer),slot=String(index)
  const reserved=await c.store.transaction(async tx=>{
    const current=await access(c,tx),upload=current.upload
    if(current.fileID&&!upload)d.fail('文件已通过其他方式完成上传',409)
    if(upload&&upload.totalBytes!==totalBytes)d.fail('同一文件不能更改上传大小',409)
    const old=upload?.chunks[slot]
    if(old&&old.sha256!==sha256)d.fail('同一文件分片不能替换为不同内容',409)
    if(old?.fileID)return old
    if(upload?.leaseUntil>Date.now())d.fail('文件正在合并，请稍后重试',409)
    const item={sha256,size}
    await tx.put('files',file.id,{...current,upload:{transport:'cloud-function',status:'uploading',totalBytes,totalChunks,chunks:{...upload?.chunks,[slot]:item}}})
    return item
  })
  if(reserved.fileID)return {id:file.id,index,received:true}
  // The server chooses every path. Content addressing makes uncertain retries safe.
  const saved=await c.cloud.uploadFile({cloudPath:'relay-chunks/'+file.id+'/'+index+'-'+sha256,fileContent:buffer})
  if(typeof saved.fileID!=='string'||!saved.fileID)d.fail('云存储未返回文件标识',503)
  await c.store.transaction(async tx=>{
    const current=await access(c,tx),upload=current.upload
    if(upload?.chunks[slot]?.sha256!==sha256)d.fail('上传状态已变化',409)
    if(upload.status==='complete')return
    await tx.put('files',file.id,{...current,upload:{...upload,chunks:{...upload.chunks,[slot]:{sha256,size,fileID:saved.fileID}}}})
  })
  return {id:file.id,index,received:true}
}
async function complete(c){
  const lease=d.uid()
  const file=await c.store.transaction(async tx=>{
    const current=await access(c,tx),upload=current.upload
    if(upload?.status==='complete')return current
    if(!upload||Array.from({length:upload.totalChunks},(_,i)=>upload.chunks[i]).some(row=>!row?.fileID))d.fail('文件分片尚未全部上传',409)
    if(upload.leaseUntil>Date.now())d.fail('文件正在合并，请稍后重试',409)
    const next={...current,upload:{...upload,lease,leaseUntil:Date.now()+90000}}
    await tx.put('files',current.id,next);return next
  })
  if(file.upload.status==='complete'){await removeChunks(c,file);return result(file)}
  try{
    const parts=[]
    for(let start=0;start<file.upload.totalChunks;start+=4){
      const batch=Array.from({length:Math.min(4,file.upload.totalChunks-start)},(_,offset)=>start+offset)
      const buffers=await Promise.all(batch.map(async index=>{
        const part=file.upload.chunks[index],downloaded=await c.cloud.downloadFile({fileID:part.fileID}),buffer=downloaded.fileContent
        if(!Buffer.isBuffer(buffer)||buffer.length!==part.size||digest(buffer)!==part.sha256)d.fail('文件分片内容核对失败，请重新准备文件',409)
        return buffer
      }))
      parts.push(...buffers)
    }
    const buffer=Buffer.concat(parts),sha256=digest(buffer)
    if(buffer.length!==file.upload.totalBytes)d.fail('完整文件大小不匹配',409)
    const ext=file.name.split('.').pop().toLowerCase()
    const saved=await c.cloud.uploadFile({cloudPath:'server-uploads/'+file.id+'/'+sha256+'.'+ext,fileContent:buffer})
    if(typeof saved.fileID!=='string'||!saved.fileID)d.fail('云存储未返回文件标识',503)
    const finished=await c.store.transaction(async tx=>{
      const current=await access(c,tx)
      if(current.upload.lease!==lease)d.fail('文件合并租约已变化，请重试',409)
      const next={...current,fileID:saved.fileID,size:buffer.length,sha256,upload:{...current.upload,status:'complete',lease:null,leaseUntil:0}}
      await tx.put('files',file.id,next);return next
    })
    await removeChunks(c,finished);return result(finished)
  }catch(error){
    await c.store.transaction(async tx=>{const current=await tx.get('files',file.id);if(current?.upload?.lease===lease)await tx.put('files',file.id,{...current,upload:{...current.upload,lease:null,leaseUntil:0}})})
    throw error
  }
}
function register(r){r('POST','/core/files/:id/upload-chunk',chunk);r('POST','/core/files/:id/finish-upload',complete)}
module.exports={register,descriptor,CHUNK_BYTES,REQUEST_BYTES}
