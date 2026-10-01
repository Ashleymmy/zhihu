const d=require('./domain')
const {assertLegacyRoute}=require('./routing')
const {listOf}=require('./catalog')
const {scopeRows}=require('./legacy-operations')
async function finish(store,job,lease,update={},work=async()=>{}){
  return store.transaction(async tx=>{await tx.lock(['scope',job.scope]);const current=await tx.get('jobs',job.id);if(current?.lease!==lease)d.fail('任务租约已变化',409);await work(tx);await tx.put('jobs',job.id,{...current,status:'completed',completedAt:d.now(),...update,lease:null,consecutiveFailures:0,error:null})})
}
async function run(store,upstream,job,lease){
  if(job.type==='legacy-push-plan'||job.type==='legacy-push-composition'){
    const isPlan=job.type==='legacy-push-plan',collection=isPlan?'legacy_plans':'legacy_compositions',row=await store.get(collection,job.resourceId)
    if(!row||row.status==='ended')return finish(store,job,lease,{status:'cancelled'})
    const plan=isPlan?row:await store.get('legacy_plans',row.planId)
    if(!plan||!(await scopeRows(store,job.scope,[plan])).length||row.accountId&&row.accountId!==job.scope.accountId)d.fail('任务接入账号与历史记录不一致',409)
    let method='POST',path='/popularize_plan',payload
    if(isPlan){
      if(row.zhihuPlanId)d.fail('知乎当前协议不支持修改已创建的推广计划',422)
      payload={task_id:row.zhihuTaskId,channel_id:row.channelId,content_url:row.landingUrl,keyword:row.keyword,popularize_type:row.popularizeType}
      if(row.secondChannelId)payload.second_channel_id=row.secondChannelId
    }else{
      if(plan?.syncStatus!=='synced'||!plan.zhihuPlanId)d.fail('推广计划尚未同步成功',422)
      if(row.zhihuCompositionId&&!/^[1-9]\d{0,19}$/.test(row.zhihuCompositionId))d.fail('作品编号不符合当前协议',422)
      path='/popularize_composition/v2'+(row.zhihuCompositionId?'/'+row.zhihuCompositionId:'');method=row.zhihuCompositionId?'PUT':'POST'
      payload={plan_id:plan.zhihuPlanId,channel_id:plan.channelId,media_type:row.mediaType,media_account:row.mediaAccount,composition_type:row.compositionType,composition_sub_type:row.compositionSubType,composition_url:row.promoUrl,release_time:Math.floor(Date.parse(row.releaseTime)/1000)}
    }
    const response=await upstream.request(method,path,payload),value=response.data||response,remote=value[isPlan?'plan_id':'composition_id']||value[isPlan?'planId':'compositionId']||value.id||row.zhihuCompositionId
    if(!remote)throw Error('Upstream ID missing')
    return finish(store,job,lease,{},async tx=>{const current=await tx.get(collection,row.id);await tx.put(collection,row.id,{...current,[isPlan?'zhihuPlanId':'zhihuCompositionId']:String(remote),syncStatus:'synced',syncError:null,updatedAt:d.now()})})
  }
  if(job.type==='legacy-sync-composition-status'){
    const planIds=job.planIds||(await scopeRows(store,job.scope,await store.find('legacy_plans',{projectId:job.scope.projectId}))).filter(p=>p.status!=='ended').map(p=>p.id),index=job.planCursor||0
    const p=planIds[index]?await store.get('legacy_plans',planIds[index]):null
    if(planIds[index]&&(!p||p.status==='ended'))return finish(store,job,lease,{status:'pending',planIds,planCursor:index+1,offset:0,pageRows:null,pageCursor:0,nextAt:Date.now()})
    if(!p)return finish(store,job,lease)
    if(!(await scopeRows(store,job.scope,[p])).length)d.fail('作品同步计划不属于当前接入账号',409)
    const offset=job.offset||0,rows=job.pageRows||listOf(await upstream.request('GET','/popularize_compositions',{channel_id:p.channelId,keyword:p.keyword,offset,limit:50}))
    if(rows.length>50||JSON.stringify(rows).length>500000)d.fail('上游分页返回异常',502)
    const start=job.pageCursor||0,end=Math.min(start+5,rows.length),done=end===rows.length
    const remoteIds=rows.slice(start,end).map(x=>String(x.composition_id||x.compositionId||x.id))
    return finish(store,job,lease,{status:'pending',planIds,planCursor:done&&rows.length<50?index+1:index,offset:done?(rows.length===50?offset+50:0):offset,pageRows:done?null:rows,pageCursor:done?0:end,nextAt:Date.now()},async tx=>{
      const plan=await tx.get('legacy_plans',p.id);if(!plan||!(await scopeRows(tx,job.scope,[plan])).length)d.fail('作品计划已变化',409)
      const local=remoteIds.length?await tx.find('legacy_compositions',{planId:p.id,zhihuCompositionId:tx.db.command.in(remoteIds)},{max:20}):[]
      for(const row of local){if(row.accountId&&row.accountId!==job.scope.accountId)continue;const match=rows.find(x=>String(x.composition_id||x.compositionId||x.id)===row.zhihuCompositionId);if(match)await tx.put('legacy_compositions',row.id,{...row,zhihuStatusJson:match,updatedAt:d.now()})}
    })
  }
  if(job.type==='legacy-sync-metrics'){
    let rows=job.rows
    if(!rows){rows=listOf(await upstream.request('GET','/data_report/daily_data',{start_date:job.from,end_date:job.to}));if(rows.length>1000||JSON.stringify(rows).length>500000)d.fail('报表过大，请使用云存储报表导入',413)}
    const cursor=job.cursor||0,end=Math.min(cursor+1,rows.length)
    return finish(store,job,lease,{status:end===rows.length?'completed':'pending',rows,cursor:end,nextAt:Date.now()},async tx=>{
      await tx.lock('engine-gate')
      for(const raw of rows.slice(cursor,end)){
        const date=d.day(raw.stat_date),channelId=String(raw.channel_id),keyword=d.text(raw.keyword,'关键词')
        await assertLegacyRoute(tx,job.scope.projectId,date)
        const plans=(await scopeRows(tx,job.scope,await tx.find('legacy_plans',{projectId:job.scope.projectId,channelId,keyword}))).filter(p=>p.status!=='ended')
        if(plans.length!==1)d.fail('日报关键词缺少唯一历史归属',409)
        const plan=plans[0],id=d.hash(['metric',job.scope,channelId,keyword,date]),previous=await tx.get('legacy_metrics',id)
        const existing=previous||(await scopeRows(tx,job.scope,await tx.find('legacy_metrics',{projectId:job.scope.projectId,channelId,keyword,statDate:date})))[0]
        const record={id:existing?.id||id,projectId:job.scope.projectId,accountId:job.scope.accountId,planId:plan.id,ownerId:plan.ownerId,channelId,keyword,statDate:date,earning:d.money(d.cash(String(raw.earning||0))),fetchedAt:d.now()}
        for(const field of ['impressions','clicks','conversions']){if(!/^\d+$/.test(String(raw[field]||0)))d.fail('报表计数格式不正确',502);record[field]=String(raw[field]||0)}
        if(existing&&(await tx.find('legacy_earnings',{sourceRef:'metric:'+existing.id})).length&&d.cash(record.earning)!==d.cash(existing.earning))d.fail('已结算日报发生变化，须先核对更正',409)
        await tx.put('legacy_metrics',record.id,record)
      }
    })
  }
  if(job.type==='legacy-settle-earnings'){
    const page=await store.scan('legacy_metrics',{projectId:job.scope.projectId,statDate:store.db.command.gte(job.from).and(store.db.command.lte(job.to))},{after:job.metricCursor,limit:1}),candidate=page.rows[0]
    const update={status:page.cursor?'pending':'completed',metricCursor:page.cursor,cursor:(job.cursor||0)+page.rows.length,nextAt:Date.now()}
    return finish(store,job,lease,update,async tx=>{
      await tx.lock('engine-gate');await tx.lock('legacy-finance')
      const rules=job.pricingRules||(await tx.find('legacy_rules',{status:'active'},{max:30})).sort((a,b)=>Number(b.priority||0)-Number(a.priority||0)||(BigInt(a.id)<BigInt(b.id)?1:-1)),creatorRule=rules.find(r=>r.targetRole==='creator'),leaderRule=rules.find(r=>r.targetRole==='leader')
      update.pricingRules=rules
      const {apply}=require('./relay')
      for(const id of candidate?[candidate.id]:[]){
        const m=await tx.get('legacy_metrics',id)
        if(!m||!(await scopeRows(tx,job.scope,[m])).length||m.statDate<job.from||m.statDate>job.to||!m.ownerId||d.cash(String(m.earning))<=0n)continue
        await assertLegacyRoute(tx,m.projectId,m.statDate)
        if((await tx.find('legacy_earnings',{sourceRef:'metric:'+m.id})).length)continue
        const creator=await tx.get('users',m.ownerId);if(!creator)d.fail('日报归属用户不存在',409)
        const source=d.cash(String(m.earning)),gross=apply(source,creatorRule),fee=creator.parentId&&leaderRule?.method==='percentage'?apply(gross,leaderRule):0n
        // Preserve the old daily-metric contract: amounts are already expressed in cents.
        for(const [userId,value,suffix]of [[m.ownerId,gross-fee,''],[creator.parentId,fee,':leader']])if(userId&&(suffix===''||value>0n)){
          const amount=d.money(value),sourceRef='metric:'+m.id+suffix
          await tx.add('legacy_earnings',{userId,projectId:m.projectId,planId:m.planId,settleDate:m.statDate,amount,amountUnit:'cent',status:'pending',sourceRef})
        }
      }
    })
  }
  d.fail('未知历史任务类型',422)
}
function register(r){
  for(const [path,type]of [['/metrics/sync','legacy-sync-metrics'],['/admin-tools/settle-earnings','legacy-settle-earnings'],['/admin-tools/sync-composition-status','legacy-sync-composition-status']])r('POST','/modules/zhihu'+path,async c=>{
    d.duty(c.user,type==='legacy-settle-earnings'?'finance':'operations');const scope=d.scopeOf(c.data),yesterday=new Date(Date.now()+28800000-86400000).toISOString().slice(0,10),from=d.day(c.data.from||c.data.settleDate||yesterday),to=d.day(c.data.to||c.data.settleDate||from)
    if(from>to)d.fail('日期范围不正确')
    return c.store.mutate(c.user,scope,type,c.key,{from,to},async tx=>{const row=await tx.add('jobs',{type,scope,from,to,status:'pending',attempts:0,nextAt:Date.now(),requestedBy:c.user.id});return {jobId:row.id,status:'queued'}})
  })
}
module.exports={run,register}
