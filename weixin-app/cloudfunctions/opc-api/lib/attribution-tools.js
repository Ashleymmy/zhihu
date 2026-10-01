const d=require('./domain')
const {authorize}=require('./store')
const {attribute}=require('./imports')
const {pair,own}=require('./keywords')
async function visible(c,fact){
  if(c.user.role==='admin')return true
  const binding=fact.bindingId?await c.store.get('bindings',fact.bindingId):null
  return !!binding&&(binding.executorId===c.user.id||binding.leaderId===c.user.id)
}
function publicFact(user,fact){return user.role==='creator'?{...fact,allocations:(fact.allocations||[]).filter(a=>a.userId===user.id),priceIds:undefined}:fact}
function register(r){
  r('GET','/modules/zhihu/attributions',async c=>{
    const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const rows=[];for(const fact of await c.store.find('facts',scope))if(await visible(c,fact))rows.push(publicFact(c.user,fact))
    return d.page(rows.sort((a,b)=>b.date.localeCompare(a.date)),c.data)
  })
  r('GET','/modules/zhihu/attributions/:id/trace',async c=>{
    const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const fact=d.belongs(await c.store.get('facts',c.params.id),scope);if(!await visible(c,fact))d.fail('无权查看来源',403)
    const ledger=(await c.store.find('ledger',{...scope,factId:fact.id})).filter(e=>c.user.role!=='creator'||e.userId===c.user.id)
    const revisions=await c.store.find('revisions',{...scope,factId:fact.id})
    return {fact:publicFact(c.user,fact),revisions:revisions.map(({value,...r})=>({...r,value:{date:value.date,channel:value.channel,keyword:value.keyword,orders:value.orders,search:value.search}})),ledger}
  })
  r('POST','/modules/zhihu/attributions/:id/recompute',async c=>{
    d.duty(c.user,'operations');const scope=d.scopeOf(c.data)
    return c.store.mutate(c.user,scope,'attribution.recompute',c.key,{id:c.params.id},async tx=>{
      const fact=d.belongs(await tx.get('facts',c.params.id),scope);if(fact.pendingRevision)d.fail('请先核对待处理修订',409)
      const next=await attribute(tx,scope,fact),digest=d.hash({bindingId:next.bindingId,allocations:next.allocations,priceIds:next.priceIds})
      const oldDigest=d.hash({bindingId:fact.bindingId,allocations:fact.allocations,priceIds:fact.priceIds})
      if(digest===oldDigest&&!fact.error)return {id:fact.id,changed:false}
      const allocations=[...next.allocations];for(const a of fact.allocations||[])if(!allocations.some(b=>b.userId===a.userId))allocations.push({userId:a.userId,amount:'0.0000'})
      await tx.put('facts',fact.id,{...fact,...next,allocations,error:null,version:d.hash([fact.version,digest]),recomputedAt:d.now()})
      const issue=await tx.get('exceptions',fact.id);if(issue)await tx.put('exceptions',fact.id,{...issue,status:'resolved'})
      return {id:fact.id,changed:true}
    })
  })
  r('POST','/modules/zhihu/evidence-bindings/:id/dispute',async c=>{
    d.operate(c.user);const scope=d.scopeOf(c.data),reason=d.text(c.data.reason,'争议说明',500),resolve=c.data.resolve
    if(typeof resolve!=='boolean')d.fail('请指定争议操作');if(resolve)d.duty(c.user,'operations')
    return c.store.mutate(c.user,scope,'evidence.dispute',c.key,{id:c.params.id,reason,resolve},async tx=>{
      const {binding}=await pair(tx,scope,c.params.id);own(c.user,binding)
      const passed=(await tx.find('evidence',{bindingId:binding.id,status:'passed'})).length>0
      await tx.put('bindings',binding.id,{...binding,verificationStatus:resolve?(passed?'passed':'pending'):'disputed',disputed:!resolve,disputeReason:reason})
      // Even a resolved dispute requires a new financial review.
      for(const fact of await tx.find('facts',{...scope,bindingId:binding.id}))await tx.put('facts',fact.id,{...fact,version:d.hash([fact.version,'dispute',c.key,resolve])})
      return {id:binding.id}
    })
  })
  r('POST','/modules/zhihu/metric-revisions/:id/rebase',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data),reason=d.text(c.data.reason,'重建原因',500)
    return c.store.mutate(c.user,scope,'revision.rebase',c.key,{id:c.params.id,expectedRevisionId:c.data.expectedRevisionId,reason},async tx=>{
      const rev=d.belongs(await tx.get('revisions',c.params.id),scope),fact=await tx.get('facts',rev.factId)
      if(rev.status!=='pending'||fact.pendingRevision!==rev.id||c.data.expectedRevisionId!==fact.version)d.fail('修订基线已变化，请刷新',409)
      await tx.put('revisions',rev.id,{...rev,previousVersion:fact.version,rebaseReason:reason,rebasedBy:c.user.id});return {id:rev.id}
    })
  })
  r('GET','/modules/zhihu/imports/:id/file',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const batch=d.belongs(await c.store.get('imports',c.params.id),scope),file=d.belongs(await c.store.get('files',batch.fileId),scope)
    const fileID=batch.sourceSnapshot||file.fileID
    if(batch.sourceHash){const content=await require('./files').download(c.cloud,{fileID});if(d.hash(content.toString('base64'))!==batch.sourceHash)d.fail('报表原件与导入内容不一致',409)}
    const result=await c.cloud.getTempFileURL({fileList:[{fileID,maxAge:60}]})
    if(!result.fileList?.[0]?.tempFileURL)d.fail('获取报表失败',503)
    return {url:result.fileList[0].tempFileURL,name:file.name}
  })
  r('POST','/modules/zhihu/imports/:id/process',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data)
    return c.store.mutate(c.user,scope,'import.resume',c.key,{id:c.params.id},async tx=>{
      const batch=d.belongs(await tx.get('imports',c.params.id),scope),job=await tx.get('jobs','import-'+batch.id)
      if(batch.status==='completed')return {id:batch.id,status:'completed'}
      if(!job||!['failed','pending'].includes(job.status))d.fail('任务未提交或正在运行',409)
      await tx.put('jobs',job.id,{...job,status:'pending',attempts:0,nextAt:Date.now()})
      await tx.put('imports',batch.id,{...batch,status:'queued',error:null});return {id:batch.id,status:'queued'}
    })
  })
  r('POST','/modules/zhihu/workbench/import',c=>require('./imports').prepare(c))
}
module.exports={register}
