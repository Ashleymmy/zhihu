const d=require('./domain')
async function acquire(store){
  const configured=Number(process.env.OPC_ZHIHU_DAILY_LIMIT||1000)
  if(!Number.isSafeInteger(configured)||configured<1||configured>1000000)d.fail('知乎配额配置不正确',503)
  const id='zhihu-'+d.today(),lease=d.uid()
  await store.transaction(async tx=>{
    const row=await tx.get('limits',id)||{count:0,leases:{}}
    const leases=Object.fromEntries(Object.entries(row.leases||{}).filter(([,expires])=>expires>Date.now()))
    if(row.count>=configured)d.fail('知乎当日请求配额已用尽',429)
    if(Object.keys(leases).length>=4)d.fail('知乎请求繁忙，请稍后重试',429)
    leases[lease]=Date.now()+30000
    await tx.put('limits',id,{count:row.count+1,leases})
  })
  return async()=>store.transaction(async tx=>{const row=await tx.get('limits',id);if(row){delete row.leases[lease];await tx.put('limits',id,row)}})
}
module.exports={acquire}
