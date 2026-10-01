// Bounded keyset scan: a large queue must not fail because list() exceeds a cap.
// The persisted cursor advances past inspected jobs, not unprocessed candidates.
async function candidates(store,time=Date.now()){
  const state=await store.get('settings','worker-scan'),result=[]
  let cursor=state?.cursor||null
  for(let page=0;page<4;page++){
    const batch=await store.scan('jobs',{status:store.db.command.in(['pending','running']),nextAt:store.db.command.lte(time)},{after:cursor,limit:40})
    for(const job of batch.rows){
      cursor=job.id
      if(job.status==='pending'||Number(job.leaseUntil||0)<=time)result.push(job)
      if(result.length===2)break
    }
    if(result.length===2)break
    cursor=batch.cursor
    if(!cursor)break
  }
  await store.put('settings','worker-scan',{cursor,checkedAt:new Date(time).toISOString()})
  return result
}
module.exports={candidates}
