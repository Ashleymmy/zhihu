const d=require('./domain')
function register(r){
  r('POST','/core/auth/refresh',async()=>d.fail('小程序会话到期后请重新登录',401))
  for(const [method,path,replacement]of [
    ['POST','/data-import/parse','POST /modules/zhihu/imports'],
    ['POST','/data-import/confirm','POST /modules/zhihu/imports/:id/commit'],
    ['POST','/data-import/:id/confirm','POST /modules/zhihu/imports/:id/commit'],
    ['POST','/data-import/:id/reject','POST /modules/zhihu/imports/:id/reject'],
    ['GET','/data-import/batches','GET /modules/zhihu/imports'],
    ['GET','/data-import/:id','GET /modules/zhihu/imports/:id']
  ])r(method,'/modules/zhihu'+path,async c=>{d.duty(c.user,'finance');d.fail('旧导入入口已停用，请使用云报表接口：'+replacement,410)})
  r('POST','/modules/zhihu/admin-tools/sync-plan-status',async c=>{d.duty(c.user,'operations');d.fail('知乎计划查询协议尚未核实，请使用计划人工核对入口',409)})
  r('POST','/modules/zhihu/plans/:id/confirm-upstream',async c=>{
    d.duty(c.user,'operations');const scope=d.scopeOf(c.data),reason=d.text(c.data.reason,'核对依据',500),remote=d.text(String(c.data.zhihuPlanId||''),'知乎计划编号'),status=c.data.status
    if(c.data.acknowledged!==true||!['active','pending','rejected','paused','ended'].includes(status))d.fail('请确认已在知乎核对计划状态')
    return c.store.mutate(c.user,scope,'legacy.plan.reconcile',c.key,{id:c.params.id,reason,remote,status},async tx=>{
      const row=await require('./legacy-operations').plan(tx,c.user,scope,c.params.id)
      if(row.zhihuPlanId&&row.zhihuPlanId!==remote)d.fail('知乎计划编号与原记录不一致',409)
      const job=await tx.get('jobs','legacy-push-plan-'+row.id);if(job?.status==='running')d.fail('同步仍在执行，请稍后核对',409)
      await tx.put('legacy_plans',row.id,{...row,zhihuPlanId:remote,status,syncStatus:'synced',syncError:null,reconciliationReason:reason,reconciledBy:c.user.id,reconciledAt:d.now()})
      if(job)await tx.put('jobs',job.id,{...job,status:'completed',reconciledBy:c.user.id});return {id:row.id}
    })
  })
  r('POST','/modules/zhihu/imports/:id/reject',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data),reason=d.text(c.data.reason,'退回原因',500)
    return c.store.mutate(c.user,scope,'import.reject',c.key,{id:c.params.id,reason},async tx=>{const row=d.belongs(await tx.get('imports',c.params.id),scope);if(row.status!=='preview')d.fail('仅未提交的预览可以退回',409);await tx.put('imports',row.id,{...row,status:'rejected',reason,rejectedBy:c.user.id,rejectedAt:d.now()});return {id:row.id}})
  })
}
module.exports={register}
