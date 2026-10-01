const {serverOnly}=require('./runtime-readiness'),d=require('./domain')
async function execute(store,event,identity,run){
  if(!serverOnly(identity))return {code:40300,message:'后台任务不可由小程序直接调用'}
  const isTimer=event?.Type==='Timer'&&event.TriggerName==='opc-jobs-every-minute'
  const record=async outcome=>{
    if(!isTimer)return
    await store.transaction(async tx=>{const old=await tx.get('settings','worker-heartbeat');await tx.put('settings','worker-heartbeat',{triggerName:event.TriggerName,lastTriggeredAt:d.now(),runs:(old?.runs||0)+1,outcome})})
  }
  const migration=await store.get('settings','migration')
  if(migration?.status!=='sealed'){await record('migration-gated');return {code:50300,message:'迁移未完成，暂停后台任务'}}
  try{const result=await run();await record('completed');return {code:0,data:result}}
  catch(error){await record('failed');console.error('opc-worker failed',JSON.stringify({code:error.code||error.errCode||'unknown'}));return {code:50000,message:'后台任务执行失败，请查看云函数日志'}}
}
module.exports={execute}
