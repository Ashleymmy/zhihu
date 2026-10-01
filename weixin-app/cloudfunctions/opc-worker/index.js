const cloud=require('wx-server-sdk')
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV})
const {Store}=require('./lib/store')
const {run}=require('./lib/worker')
exports.main=async event=>{
  const identity=cloud.getWXContext()
  if(event?.action==='runtime-readiness')return require('./lib/runtime-readiness').check(new Store(cloud.database()),identity,{functionName:'opc-worker',probe:event.probe,upstream:true})
  const store=new Store(cloud.database())
  return require('./lib/worker-entry').execute(store,event,identity,()=>run(store,undefined,cloud))
}
