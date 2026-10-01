const d=require('./domain')
const {authorize}=require('./store')
async function assertNewRoute(tx,scope,date,confirm=false){
  const route=await tx.get('routes',d.hash(scope))
  if(!route||date<route.exclusiveFrom)d.fail('该业务日期属于旧引擎，或尚未配置切换边界',409)
  if(route.mode==='stopped')d.fail('新引擎已停止写入',409)
  if(confirm&&route.mode!=='enabled')d.fail('试算模式尚未启用对账确认',409)
}
async function assertLegacyRoute(tx,projectId,date){
  const routes=await tx.find('routes',projectId?{projectId}:{})
  if(routes.some(r=>!date||r.exclusiveFrom<=date))d.fail('来源属于新引擎周期或无法证明旧来源范围，禁止旧流程确认',409)
}
async function assertWritable(tx,scope){
  if((await tx.get('routes',d.hash(scope)))?.mode==='stopped')d.fail('新引擎已停止写入',409)
}
function register(r){
  r('GET','/modules/zhihu/engine-route',async c=>{const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);const row=await c.store.get('routes',d.hash(scope));return row?{...row,exclusive_from:row.exclusiveFrom,sample_verified:row.sampleVerified}:null})
  r('POST','/modules/zhihu/engine-route',async c=>{
    d.duty(c.user,'operations');const scope=d.scopeOf(c.data),from=d.day(c.data.from),reason=d.text(c.data.reason,'切换说明',1000),mode=c.data.mode
    if(!['trial','enabled','stopped'].includes(mode)||typeof c.data.sampleVerified!=='boolean')d.fail('切换参数不正确')
    return c.store.mutate(c.user,scope,'engine.configure',c.key,{from,reason,mode,sampleVerified:c.data.sampleVerified},async tx=>{
      await tx.lock('engine-gate');const id=d.hash(scope),old=await tx.get('routes',id)
      if(old&&old.exclusiveFrom!==from)d.fail('已登记的日期边界不可移动；回退请停止新引擎',409)
      if(!old){
        if(mode!=='trial')d.fail('首次配置必须先进入试算')
        for(const name of ['legacy_earnings','legacy_metrics']){
          const rows=await tx.find(name,{projectId:scope.projectId})
          if(rows.some(row=>(row.settleDate||row.statDate||'9999-12-31')>=from))d.fail('边界后已有旧来源或历史账，请选择未处理周期',409)
        }
        const archived=await tx.find('legacy',{table:'data_import_rows'})
        if(archived.some(row=>!row.data.occurredAt||String(row.data.occurredAt).slice(0,10)>=from))d.fail('边界后存在待核对的历史导入来源',409)
      }
      if(mode==='enabled'&&!c.data.sampleVerified)d.fail('启用前须完成真实样本口径核对')
      await tx.put('routes',id,{id,...scope,exclusiveFrom:from,mode,reason,sampleVerified:c.data.sampleVerified,updatedBy:c.user.id,updatedAt:d.now()});return {id}
    })
  })
  r('GET','/modules/zhihu/legacy-inventory',async c=>{
    d.duty(c.user,'operations');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const plans=await c.store.find('legacy_plans',{projectId:scope.projectId}),metrics=await c.store.find('legacy_metrics',{projectId:scope.projectId})
    return {...d.page(plans.map(p=>({plan_id:p.id,keyword:p.keyword,status:p.status,owner_id:p.ownerId,shared_count:plans.filter(x=>x.keyword===p.keyword).length,source_days:metrics.filter(m=>m.planId===p.id).length})),c.data),policy:'历史词保留旧归属；共词与无来源不迁入新绑定，使用新词进入新周期。'}
  })
}
module.exports={register,assertNewRoute,assertLegacyRoute,assertWritable}
