const d=require('./domain')
const {authorize}=require('./store')
const {assertNewRoute}=require('./routing')
const owns=(user,o)=>o.payerKind==='agency'?user.role==='admin':o.payerId===user.id
async function obligations(tx,fact){
  const b=await tx.get('bindings',fact.bindingId);if(!b)d.fail('归属绑定不存在',409)
  const amount=id=>d.cash((fact.allocations||[]).find(a=>a.userId===id)?.amount||'0',true)
  if(b.leaderId){
    const self=b.executorId===b.leaderId,gross=amount(b.leaderId)+(self?0n:amount(b.executorId))
    const upper={relationType:'agency_leader',payerKind:'agency',payerId:'1',payeeId:b.leaderId,targetAmount:d.money(gross)}
    return self?[upper]:[{relationType:'leader_creator',payerKind:'user',payerId:b.leaderId,payeeId:b.executorId,targetAmount:d.money(amount(b.executorId))},upper]
  }
  return [{relationType:'agency_creator',payerKind:'agency',payerId:'1',payeeId:b.executorId,targetAmount:d.money(amount(b.executorId))}]
}
async function latest(tx,factId,relationType){
  const rows=await tx.find('statements',{factId,relationType,status:'confirmed'})
  // A confirmed entry has exactly one successor; no clock ordering assumption.
  const superseded=new Set(rows.map(r=>r.previousEntryId).filter(Boolean))
  return rows.find(r=>!superseded.has(r.id))||null
}
async function build(tx,scope,fact,o){
  const previous=await latest(tx,fact.id,o.relationType)
  if(previous?.version===fact.version&&previous.targetAmount===o.targetAmount)return previous
  const input={...scope,factId:fact.id,version:fact.version,bindingId:fact.bindingId,...o,previousEntryId:previous?.id||null}
  const inputHash=d.hash(input),id=d.hash(['statement',inputHash]),existing=await tx.get('statements',id)
  if(existing)return existing
  const row={id,...input,inputHash,amount:d.money(d.cash(o.targetAmount,true)-d.cash(previous?.targetAmount||'0',true)),entryKind:previous?'adjustment':'initial',status:'draft',createdAt:d.now()}
  await tx.put('statements',id,row);return row
}
async function confirmEntry(tx,user,scope,id,expectedHash,central=false){
  const row=d.belongs(await tx.get('statements',id),scope)
  if(!central&&!owns(user,row))d.fail('只有付款主体可确认自己的应付',403)
  if(row.inputHash!==expectedHash)d.fail('草稿摘要不一致',409)
  if(row.status==='confirmed')return {id}
  const fact=d.belongs(await tx.get('facts',row.factId),scope),binding=await tx.get('bindings',fact.bindingId)
  await assertNewRoute(tx,scope,fact.date,true)
  if(row.status!=='draft'||fact.version!==row.version||fact.pendingRevision||fact.error||binding?.verificationStatus!=='passed')d.fail('来源已变化或存在争议，请重新核对',409)
  const previous=await latest(tx,fact.id,row.relationType)
  if((previous?.id||null)!==row.previousEntryId)d.fail('应付基数已变化，请刷新草稿',409)
  if(!central&&row.relationType==='agency_leader'&&binding.executorId!==binding.leaderId){
    const lower=(await obligations(tx,fact)).find(o=>o.relationType==='leader_creator'),confirmed=await latest(tx,fact.id,'leader_creator')
    if(!confirmed||confirmed.version!==fact.version||confirmed.targetAmount!==lower?.targetAmount)d.fail('须先由团长确认对达人的应付或调整',409)
  }
  await tx.put('statements',id,{...row,status:'confirmed',confirmedBy:user.id,confirmedAt:d.now()})
  await tx.audit(user,'statement.confirm',id,{factId:fact.id,amount:row.amount});return {id}
}
async function central(tx,user,scope,fact){
  for(const o of await obligations(tx,fact)){const row=await build(tx,scope,fact,o);await confirmEntry(tx,user,scope,row.id,row.inputHash,true)}
}
async function preview(c,period=false){
  d.finance(c.user);if(c.user.role==='creator')d.fail('仅付款主体可生成应付草稿',403)
  const scope=d.scopeOf(c.data),input=period?{from:d.day(c.data.from),to:d.day(c.data.to)}:{factId:String(c.data.factId||'')}
  if(period&&input.from>input.to)d.fail('日期范围不正确')
  return c.store.mutate(c.user,scope,'statement.preview',c.key,input,async tx=>{
    const facts=period?await tx.find('facts',{...scope,date:tx.db.command.gte(input.from).and(tx.db.command.lte(input.to))}):[d.belongs(await tx.get('facts',input.factId),scope)]
    if(facts.length>20)d.fail('一次最多预览 20 条来源，请缩小日期范围',413)
    const entries=[]
    for(const fact of facts){
      if(fact.error||fact.pendingRevision)d.fail('来源尚未完成归因或存在修订',409)
      await assertNewRoute(tx,scope,fact.date)
      for(const o of await obligations(tx,fact))if(owns(c.user,o))entries.push(await build(tx,scope,fact,o))
    }
    if(!period&&!entries.length)d.fail('无权生成其他付款主体的应付',403)
    return {entries}
  })
}
function register(r){
  r('GET','/modules/zhihu/statements',async c=>{d.finance(c.user);const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);return d.page((await c.store.find('statements',scope)).filter(row=>c.user.role==='admin'||row.payeeId===c.user.id||row.payerKind==='user'&&row.payerId===c.user.id),c.data)})
  r('POST','/modules/zhihu/statements/preview',c=>preview(c))
  r('POST','/modules/zhihu/statements/preview-period',c=>preview(c,true))
  r('POST','/modules/zhihu/statements/:id/confirm',async c=>{d.finance(c.user);const scope=d.scopeOf(c.data);return c.store.mutate(c.user,scope,'statement.confirm',c.key,{id:c.params.id,hash:c.data.expectedHash},tx=>confirmEntry(tx,c.user,scope,c.params.id,c.data.expectedHash))})
  r('POST','/modules/zhihu/statements/confirm-batch',async c=>{
    d.finance(c.user);const scope=d.scopeOf(c.data),entries=c.data.entries
    if(!Array.isArray(entries)||!entries.length||entries.length>20||new Set(entries.map(e=>e.id)).size!==entries.length)d.fail('请选择 1 至 20 条不同草稿',413)
    return c.store.mutate(c.user,scope,'statement.confirm-batch',c.key,entries,async tx=>{for(const entry of entries)await confirmEntry(tx,c.user,scope,entry.id,entry.expectedHash);return {confirmed:entries.length}})
  })
}
module.exports={register,central,obligations}
