const d=require('./domain')
// 修正旧 worker 遗留：push-plan 成功却未同步 planStatus 的关键词。新代码已同时写入
// 两个字段，这里只处理历史存量，逻辑与 catalog.js 的 confirm-upstream 一致。
async function run(store,{dryRun=false}={}){
  const rows=(await store.find('keywords',{syncStatus:'synced',planStatus:'pending'})).filter(row=>row.zhihuPlanId)
  if(dryRun)return {dryRun:true,scanned:rows.length,keywordIds:rows.map(row=>row.id)}
  const fixed=[]
  for(const row of rows){
    const changed=await store.transaction(async tx=>{
      const word=await tx.get('keywords',row.id)
      if(!word||word.syncStatus!=='synced'||word.planStatus!=='pending'||!word.zhihuPlanId)return false
      const priorityUntil=new Date(Date.now()+86400000).toISOString()
      await tx.put('keywords',word.id,{...word,planStatus:'active',lifecycleStatus:word.bindingId?word.lifecycleStatus:'available',priorityUntil:word.priorityUntil||priorityUntil})
      const job=await tx.get('jobs','plan-'+word.id)
      if(job)await tx.put('jobs',job.id,{...job,reconciledBy:'backfill-plan-status',reconciledAt:d.now()})
      return true
    })
    if(changed)fixed.push(row.id)
  }
  const result={checkedAt:d.now(),scanned:rows.length,fixed:fixed.length,keywordIds:fixed}
  await store.put('settings','plan-status-backfill',result)
  return result
}
module.exports={run}
