const d=require('./domain')
const {authorize}=require('./store')
const {owned,download}=require('./files')
const {parseReport}=require('../vendor/attribution/report')
function amount(price,orders){return d.money(d.cash(price)*BigInt(orders))}
async function quote(tx,scope,word,binding,date,orders){
  const prices=await tx.find('prices',{...scope,taskId:word.taskId,priceStatus:'published'})
  // 价格解析顺序：个人定价优先；没有则用该角色的全局兜底价（payeeId=role:creator/leader）
  const get=(relationType,payerId,payeeId)=>{
    const inWindow=p=>p.relationType===relationType&&p.payerId===payerId&&p.startDay<=date&&(!p.endDay||p.endDay>date)
    const exact=prices.filter(p=>inWindow(p)&&p.payeeId===payeeId)
    if(exact.length===1)return {priceId:exact[0].id,price:exact[0].price}
    if(exact.length>1)d.fail('存在多条适用单价，请检查定价')
    const roleKey=relationType==='agency_leader'?'role:leader':'role:creator'
    const dflt=prices.filter(p=>inWindow(p)&&p.payeeId===roleKey)
    if(dflt.length===1)return {priceId:dflt[0].id,price:dflt[0].price}
    if(dflt.length>1)d.fail('角色全局单价存在多条，请检查定价')
    d.fail('缺少唯一适用单价')
  }
  if(binding.leaderId){
    const upper=get('agency_leader','1',binding.leaderId),gross=amount(upper.price,orders)
    if(binding.executorId===binding.leaderId)return {allocations:[{userId:binding.leaderId,amount:gross}],priceIds:[upper.priceId]}
    const lower=get('leader_creator',binding.leaderId,binding.executorId),fee=amount(lower.price,orders)
    if(d.cash(fee)>d.cash(gross))d.fail('达人单价超过团长进价')
    return {allocations:[{userId:binding.leaderId,amount:d.money(d.cash(gross)-d.cash(fee))},{userId:binding.executorId,amount:fee}],priceIds:[upper.priceId,lower.priceId]}
  }
  const direct=get('agency_creator','1',binding.executorId)
  return {allocations:[{userId:binding.executorId,amount:amount(direct.price,orders)}],priceIds:[direct.priceId]}
}
async function attribute(tx,scope,row){
  await require('./routing').assertNewRoute(tx,scope,row.date)
  const mappings=(await tx.find('mappings',{accountId:scope.accountId,channelName:row.channel})).filter(m=>m.projectId===scope.projectId&&m.from<=row.date&&(!m.to||m.to>row.date))
  if(mappings.length!==1)d.fail('渠道映射缺失或冲突')
  const mapping=mappings[0].canonicalId?await tx.get('mappings',mappings[0].canonicalId):mappings[0]
  const key=await tx.get('keys',d.hash(['keyword',row.keyword])),word=key?await tx.get('keywords',key.owner):null
  if(!word||word.projectId!==scope.projectId||word.accountId!==scope.accountId||word.mappingId!==mapping.id)d.fail('关键词归属不匹配')
  const bindings=(await tx.find('bindings',{keywordId:word.id})).filter(b=>b.usedAt&&!b.releasedAt&&b.executorId&&b.activatedOn<=row.date)
  if(bindings.length!==1)d.fail('缺少唯一已使用的关键词归属')
  const binding=bindings[0]
  if(binding.stopNewUseAt&&row.date>binding.stopNewUseAt.slice(0,10))d.fail('关键词已停止新增使用，需人工核对')
  if(row.orders===null)d.fail('尚缺订单数据')
  return {keywordId:word.id,bindingId:binding.id,...await quote(tx,scope,word,binding,row.date,row.orders)}
}
async function processRow(tx,scope,source,batchId){
  const row=source.value,key=d.hash([scope,row.date,row.channel,row.keyword]),old=await tx.get('facts',key)
  const merged=old?{...row,search:row.search??old.search,orders:row.orders??old.orders,revenue:row.revenue??old.revenue}:row
  const version=d.hash(merged)
  if(old?.version===version)return {status:'duplicate',factId:key}
  if(old){
    const revisionId=d.hash([key,version])
    if(old.pendingRevision===revisionId)return {status:'revision',factId:key}
    if(old.pendingRevision){const prior=await tx.get('revisions',old.pendingRevision);if(prior?.status==='pending')await tx.put('revisions',prior.id,{...prior,status:'superseded',supersededBy:revisionId})}
    await tx.put('revisions',revisionId,{id:revisionId,...scope,factId:key,value:merged,version,previousVersion:old.version,status:'pending',batchId,createdAt:d.now()})
    await tx.put('facts',key,{...old,pendingRevision:revisionId})
    return {status:'revision',factId:key}
  }
  let attribution={},error=null
  try{attribution=await attribute(tx,scope,merged)}catch(e){if(!(e instanceof d.Fault)||e.status!==422)throw e;error=e.message}
  const fact={id:key,...scope,...merged,...attribution,allocations:attribution.allocations||[],version,pendingRevision:null,error,createdAt:d.now(),batchId}
  await tx.put('facts',key,fact)
  if(error)await tx.put('exceptions',key,{id:key,...scope,factId:key,reason:error,status:'open',createdAt:d.now()})
  return {status:error?'blocked':'ready',factId:key}
}
async function prepare(c){
  const deadline=Date.now()+40000
  d.duty(c.user,'finance');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
  const file=await owned(c.store,c.user,scope,d.id(c.data.fileId),'report'),buffer=await download(c.cloud,file)
  const upload={buffer,originalname:file.name,mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:buffer.length}
  let kind=c.data.reportKind||'combined',rows
  try{rows=await parseReport(upload,kind)}catch(e){if(c.data.reportKind||e.message!=='报告类型与指标列不一致')throw e;try{kind='order';rows=await parseReport(upload,kind)}catch(e2){if(e2.message!=='报告类型与指标列不一致')throw e2;kind='search';rows=await parseReport(upload,kind)}}
  const invalid=rows.filter(r=>r.error);if(invalid.length)d.fail('报表有 '+invalid.length+' 行错误：'+invalid.slice(0,3).map(r=>r.rowNumber+' 行 '+r.error).join('；'))
  const digest=d.hash(buffer.toString('base64')),id=d.hash([scope,kind,digest])
  const lease=d.uid(),previewHash=d.hash(rows)
  const known=await c.store.get('imports',id)
  if(known&&known.status!=='preparing')return {id,previewHash:known.previewHash,status:known.status}
  const snapshot=await c.cloud.uploadFile({cloudPath:'sealed-reports/'+id+'/'+digest+'.xlsx',fileContent:buffer})
  const batch=await c.store.transaction(async tx=>{
    const existing=await tx.get('imports',id)
    if(existing&&existing.status!=='preparing')return existing
    if(existing?.leaseUntil>Date.now())d.fail('该报表正在解析，请稍后刷新导入记录',409)
    if(existing&&existing.previewHash!==previewHash)d.fail('相同文件的解析结果发生变化，需核对后重试',409)
    const next={id,...scope,userId:c.user.id,fileId:file.id,sourceSnapshot:snapshot.fileID,sourceHash:digest,kind,status:'preparing',rowCount:rows.length,previewHash,createdAt:existing?.createdAt||d.now(),cursor:0,prepareCursor:existing?.prepareCursor||0,lease,leaseUntil:Date.now()+65000}
    await tx.put('imports',id,next);return next
  })
  if(batch.status!=='preparing')return {id,previewHash:batch.previewHash,status:batch.status}
  // Preparation is restartable; ready is only set after every immutable row exists.
  for(let start=batch.prepareCursor;start<rows.length;start+=20){
    if(Date.now()>=deadline){await c.store.transaction(async tx=>{const current=await tx.get('imports',id);if(current.lease!==lease)d.fail('报表解析任务已变化',409);await tx.put('imports',id,{...current,lease:null,leaseUntil:0})});return {id,previewHash,status:'preparing',nextAction:'prepare',preparedRows:start,rowCount:rows.length}}
    const part=rows.slice(start,start+20)
    await c.store.transaction(async tx=>{const current=await tx.get('imports',id);if(current.lease!==lease||current.status!=='preparing')d.fail('报表解析任务已变化',409);for(let offset=0;offset<part.length;offset++){const index=start+offset;await tx.put('import_rows',id+'-'+String(index).padStart(6,'0'),{id:id+'-'+String(index).padStart(6,'0'),batchId:id,index,...scope,...part[offset]})}await tx.put('imports',id,{...current,prepareCursor:start+part.length})})
  }
  await c.store.transaction(async tx=>{const current=await tx.get('imports',id);if(current.lease!==lease||current.status!=='preparing')d.fail('报表解析任务已变化',409);await tx.put('imports',id,{...current,status:'preview',lease:null,leaseUntil:0})})
  return {id,previewHash,status:'preview',preparedRows:rows.length,rowCount:rows.length}
}
function register(r){
  r('POST','/modules/zhihu/imports',prepare)
  r('GET','/modules/zhihu/imports',async c=>{d.duty(c.user,'finance');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);return d.page(await c.store.find('imports',scope),c.data)})
  r('GET','/modules/zhihu/imports/:id',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);const batch=d.belongs(await c.store.get('imports',c.params.id),scope)
    const page=Number(c.data.page||1),size=Number(c.data.pageSize||20);if(!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1||size>100)d.fail('分页参数不正确')
    const rows=[];for(let index=(page-1)*size;index<Math.min(page*size,batch.rowCount);index++){const row=await c.store.get('import_rows',batch.id+'-'+String(index).padStart(6,'0'));if(row)rows.push(row)}
    return {...batch,rows,list:rows,total:batch.rowCount,page,pageSize:size}
  })
  r('POST','/modules/zhihu/imports/:id/commit',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data)
    return c.store.mutate(c.user,scope,'import.commit',c.key,{id:c.params.id,previewHash:c.data.previewHash},async tx=>{
      await authorize(tx,c.user,scope);const batch=d.belongs(await tx.get('imports',c.params.id),scope)
      if(batch.previewHash!==c.data.previewHash)d.fail('报表预览已变化',409)
      if(batch.status!=='preview'&&!['queued','processing','completed'].includes(batch.status))d.fail('报表尚未准备好',409)
      if(batch.status==='preview'){await tx.put('imports',batch.id,{...batch,status:'queued'});await tx.put('jobs','import-'+batch.id,{id:'import-'+batch.id,type:'import',scope,batchId:batch.id,status:'pending',nextAt:Date.now(),attempts:0,createdAt:d.now()})}
      return {id:batch.id,status:'queued'}
    })
  })
  r('GET','/modules/zhihu/exceptions',async c=>{d.duty(c.user,'finance');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);return d.page(await c.store.find('exceptions',{...scope,status:'open'}),c.data)})
  r('POST','/modules/zhihu/exceptions/:id/retry',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data),reason=d.text(c.data.reason,'重试说明',500)
    return c.store.mutate(c.user,scope,'exception.retry',c.key,{id:c.params.id,reason},async tx=>{
      await authorize(tx,c.user,scope);const issue=d.belongs(await tx.get('exceptions',c.params.id),scope),fact=await tx.get('facts',issue.factId)
      const attribution=await attribute(tx,scope,fact)
      await tx.put('facts',fact.id,{...fact,...attribution,error:null});await tx.put('exceptions',issue.id,{...issue,status:'resolved',reason});return {id:issue.id}
    })
  })
  r('GET','/modules/zhihu/metric-revisions',async c=>{d.duty(c.user,'finance');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);return d.page(await c.store.find('revisions',{...scope,status:'pending'}),c.data)})
  r('POST','/modules/zhihu/metric-revisions/:id/resolve',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data),reason=d.text(c.data.reason,'修订说明',500)
    if(typeof c.data.accept!=='boolean')d.fail('请指定是否接受更正')
    return c.store.mutate(c.user,scope,'revision.resolve',c.key,{id:c.params.id,accept:c.data.accept,reason},async tx=>{
      await authorize(tx,c.user,scope);const rev=d.belongs(await tx.get('revisions',c.params.id),scope),old=await tx.get('facts',rev.factId)
      if(rev.status!=='pending'||old.pendingRevision!==rev.id||old.version!==rev.previousVersion)d.fail('修订状态已变化',409)
      if(c.data.accept){const attribution=await attribute(tx,scope,rev.value),priorIds=(old.allocations||[]).map(a=>a.userId),newIds=attribution.allocations.map(a=>a.userId);for(const id of priorIds)if(!newIds.includes(id))attribution.allocations.push({userId:id,amount:'0.0000'});await tx.put('facts',old.id,{...old,...rev.value,...attribution,version:rev.version,pendingRevision:null,error:null})}
      else await tx.put('facts',old.id,{...old,pendingRevision:null})
      await tx.put('revisions',rev.id,{...rev,status:c.data.accept?'accepted':'rejected',reason,reviewedBy:c.user.id});return {id:rev.id}
    })
  })
}
module.exports={register,processRow,attribute,prepare}
