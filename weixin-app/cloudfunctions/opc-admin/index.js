const cloud=require('wx-server-sdk')
const crypto=require('node:crypto')
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV})
const {Store,collections,PREFIX}=require('./lib/store')
const d=require('./lib/domain')
const db=cloud.database(),store=new Store(db)
function authenticate(event){
  const secret=process.env.OPC_MIGRATION_SECRET
  if(!secret||secret.length<32||typeof event.secret!=='string')d.fail('云函数未开放迁移入口',403)
  const a=crypto.createHash('sha256').update(secret).digest(),b=crypto.createHash('sha256').update(event.secret).digest()
  if(!crypto.timingSafeEqual(a,b))d.fail('迁移凭据不正确',403)
}
const environment=process.env.TCB_ENV||process.env.SCF_NAMESPACE||'cloud1-d4g9ou4cd3b80d764'
exports.main=async event=>{
  let phase='authentication'
  const reportStage=value=>{phase=value}
  try{
    const context=cloud.getWXContext()
    if(context.OPENID||context.APPID) d.fail('迁移函数不可从小程序调用',403)
    if(!event||typeof event!=='object') d.fail('请求格式不正确')
    authenticate(event)
    if(event.action==='check-business'){
      // 隔离业务验收的唯一前置是「环境仍在迁移中」：seal 之后一律拒绝，
      // 因为它会写入隔离命名空间的业务记录。这里曾经额外硬编码开发环境 ID，
      // 导致 PRODUCTION-ROLLOUT 第 8 步（在新建环境跑隔离业务验收）必然 403，
      // 而验收本身不依赖环境身份。
      if((await store.get('settings','migration'))?.status!=='importing')d.fail('仅允许在迁移中的环境执行隔离业务验收',403)
      if(event.restart===true){
        const existing=await store.get('settings','business-acceptance')
        if(existing?.status==='cleaning')await require('./lib/acceptance-store').cleanup(require('./lib/acceptance-store').isolatedStore(db,existing.runId))
        if(existing?.status==='cleaning'||existing?.status==='failed')await store.remove('settings','business-acceptance')
      }
      return {code:0,data:await require('./lib/business-acceptance').run(store,db,cloud)}
    }
    if(event.action==='check-runtime'){
      let transactions;const functions={}
      try{transactions=await require('./lib/cloud-acceptance').transactions(store,reportStage)}catch(error){transactions={passed:false,diagnostic:require('./lib/migration-diagnostic').diagnostic(error,phase)}}
      for(const name of ['opc-api','opc-worker']){
        reportStage('acceptance.function:'+name)
        try{functions[name]=await require('./lib/runtime-readiness').invoke(store,cloud,name)}catch(error){functions[name]={code:50000,diagnostic:require('./lib/migration-diagnostic').diagnostic(error,phase)}}
      }
      const result={checkedAt:d.now(),transactions,functions,businessEnabled:false}
      reportStage('acceptance.record');await store.put('settings','runtime-acceptance',result)
      return {code:0,data:result}
    }
    if(event.action==='check-storage'){
      // 与 check-business 不同，这里不限制迁移阶段：存储验收只用自己的隔离命名空间，
      // 不依赖迁移数据，seal 之后同样可以跑（生产环境上线前也需要验证一次真实存储）。
      // 云存储对象与隔离记录都会在结束时删除。
      return {code:0,data:Object.assign({environment},await require('./lib/storage-acceptance').run(store,db,cloud))}
    }
    if(event.action==='backfill-plan-status'){
      return {code:0,data:await require('./lib/plan-status-backfill').run(store,{dryRun:event.dryRun===true})}
    }
    const migration=require('./lib/migration').createMigration(store,db,environment,require('./release.json'),reportStage)
    if(event.action==='bootstrap'){
      const snapshot=typeof OPC_BUNDLED_MIGRATION==='undefined'?null:OPC_BUNDLED_MIGRATION
      return {code:0,data:await require('./lib/bootstrap').bootstrap(store,migration,cloud,snapshot,reportStage)}
    }
    return {code:0,data:await migration.handle(event)}
  }catch(error){
    if(error instanceof d.Fault)return {code:error.code,message:error.message}
    const detail=require('./lib/migration-diagnostic').diagnostic(error,phase)
    console.error('opc-admin migration failure',JSON.stringify(detail))
    return {code:50000,message:'迁移失败，请提供 diagnostic 阶段信息',diagnostic:detail}
  }
}
