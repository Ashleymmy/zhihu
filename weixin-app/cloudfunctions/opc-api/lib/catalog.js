const d=require('./domain')
const {authorize}=require('./store')
function listOf(response){const value=response?.data??response;if(Array.isArray(value))return value;if(Array.isArray(value?.list))return value.list;if(Array.isArray(value?.items))return value.items;d.fail('上游返回结构不正确',502)}
async function upstream(c,path,params={}){return (c.upstream||require('./upstream')).request('GET',path,params)}
function register(r){
  for(const type of ['channels','tasks'])r('GET','/modules/zhihu/'+type,async c=>{const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);return d.page(await c.store.find(type,{projectId:scope.projectId}),c.data)})
  for(const type of ['channels','tasks'])r('POST','/modules/zhihu/'+type+'/sync',async c=>{
    d.duty(c.user,'operations');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    // One page per invocation; the caller must continue until hasMore=false.
    const offset=Number(c.data.offset||0);if(!Number.isInteger(offset)||offset<0)d.fail('分页参数不正确')
    const params=type==='channels'?{}:{channel_id:d.text(c.data.channelId,'知乎渠道 ID'),offset,limit:50}
    const rows=listOf(await upstream(c,type==='channels'?'/get_agent_channels':'/popularize_tasks',params))
    if(rows.length>500)d.fail('上游返回过大',502)
    for(let start=0;start<rows.length;start+=20)await c.store.transaction(async tx=>{
      for(const item of rows.slice(start,start+20)){
        const remote=String(item[type==='channels'?'channel_id':'task_id']||item.id||'');if(!remote)d.fail('上游记录缺少 ID',502)
        const key=d.hash([scope.accountId,scope.projectId,type,remote]),lookup=await tx.get('keys',key),id=lookup?.owner||d.uid()
        const old=await tx.get(type,id)
        const row={...old,id,projectId:scope.projectId,accountId:scope.accountId,name:String(item.channel_name||item.task_name||item.name||remote),syncedAt:d.now()}
        if(type==='channels')Object.assign(row,{zhihuChannelId:remote,isEnabled:old?.isEnabled??true})
        else Object.assign(row,{zhihuTaskId:remote,popularizeType:item.popularize_type??0,status:String(item.status||''),raw:item})
        await tx.put(type,id,row);await tx.put('keys',key,{owner:id})
      }
    })
    return {count:rows.length,nextOffset:offset+rows.length,hasMore:type==='tasks'&&rows.length===50}
  })
  // 人工核对入口，不是常规流程：worker 对「上游结果不确定」的作业（请求超时、但知乎那边
  // 可能已经建好计划）会标 uncertain 并**拒绝自动重放**，此时只能在运营核对知乎后台后走
  // 这里把状态对齐 —— 它会同时把 plan-<id> 作业标为 completed，并记录核对人与核对依据。
  // 同一套修正逻辑还有一处批量版本：lib/plan-status-backfill.js（修旧 worker 遗留的存量）。
  r('POST','/modules/zhihu/keywords/:id/confirm-upstream',async c=>{
    d.duty(c.user,'operations');const scope=d.scopeOf(c.data),reason=d.text(c.data.reason,'核对依据',500)
    if(!c.data.zhihuPlanId||c.data.acknowledged!==true)d.fail('请提供已核实的知乎计划编号并确认可用')
    return c.store.mutate(c.user,scope,'keyword.confirm-upstream',c.key,{id:c.params.id,reason,planId:c.data.zhihuPlanId},async tx=>{
      await authorize(tx,c.user,scope);const word=d.belongs(await tx.get('keywords',c.params.id),scope)
      if(word.zhihuPlanId&&word.zhihuPlanId!==String(c.data.zhihuPlanId))d.fail('计划编号与同步记录不一致',409)
      const priorityUntil=new Date(Date.now()+86400000).toISOString()
      await tx.put('keywords',word.id,{...word,zhihuPlanId:d.text(String(c.data.zhihuPlanId),'计划编号'),planStatus:'active',syncStatus:'synced',syncError:null,lifecycleStatus:word.bindingId?word.lifecycleStatus:'available',priorityUntil:word.priorityUntil||priorityUntil})
      const job=await tx.get('jobs','plan-'+word.id);if(job)await tx.put('jobs',job.id,{...job,status:'completed',reconciledBy:c.user.id,reason})
      return {id:word.id}
    })
  })
  r('GET','/modules/zhihu/jobs',async c=>{d.duty(c.user,'operations');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);return d.page((await c.store.find('jobs',{'scope.projectId':scope.projectId,'scope.accountId':scope.accountId})).map(({payload,...job})=>job),c.data)})
  r('GET','/modules/zhihu/keywords/diagnostics',async c=>{
    d.duty(c.user,'operations');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const all=await c.store.find('keywords',scope)
    const statusMismatch=all.filter(w=>w.syncStatus==='synced'&&w.planStatus==='pending'&&w.zhihuPlanId)
    const uncertainJobs=await c.store.find('jobs',{'scope.projectId':scope.projectId,'scope.accountId':scope.accountId,status:'uncertain'})
    const uncertainKeywords=uncertainJobs.filter(j=>j.type==='push-plan').map(j=>all.find(w=>w.id===j.keywordId)).filter(Boolean)
    const failedKeywords=all.filter(w=>w.syncStatus==='failed')
    return {statusMismatch:statusMismatch.map(w=>({id:w.id,keyword:w.keyword,syncStatus:w.syncStatus,planStatus:w.planStatus,zhihuPlanId:w.zhihuPlanId,createdAt:w.createdAt})),uncertainKeywords:uncertainKeywords.map(w=>({id:w.id,keyword:w.keyword,lifecycleStatus:w.lifecycleStatus,createdAt:w.createdAt})),failedKeywords:failedKeywords.map(w=>({id:w.id,keyword:w.keyword,syncError:w.syncError,createdAt:w.createdAt}))}
  })
  r('POST','/modules/zhihu/keywords/fix-plan-status',async c=>{
    d.duty(c.user,'operations');const scope=d.scopeOf(c.data)
    return c.store.mutate(c.user,scope,'keyword.fix-plan-status',c.key,{},async tx=>{
      await authorize(tx,c.user,scope)
      const rows=(await tx.find('keywords',{...scope,syncStatus:'synced',planStatus:'pending'})).filter(row=>row.zhihuPlanId)
      const fixed=[]
      for(const row of rows){
        const word=await tx.get('keywords',row.id)
        if(!word||word.syncStatus!=='synced'||word.planStatus!=='pending'||!word.zhihuPlanId)continue
        const priorityUntil=new Date(Date.now()+86400000).toISOString()
        await tx.put('keywords',word.id,{...word,planStatus:'active',lifecycleStatus:word.bindingId?word.lifecycleStatus:'available',priorityUntil:word.priorityUntil||priorityUntil})
        const job=await tx.get('jobs','plan-'+word.id)
        if(job)await tx.put('jobs',job.id,{...job,reconciledBy:c.user.id,reconciledAt:d.now()})
        fixed.push(word.id)
      }
      return {scanned:rows.length,fixed:fixed.length,keywordIds:fixed}
    })
  })
  const proxies={
    '/salt/boards':'/vip/content/rule/labels',
    '/salt/boards/:ruleId/contents':'/vip/rule_contents',
    '/audio/contents':'/vip/audio/contents',
    '/comic-dramas':'/comic_dramas',
    '/intercept-words':'/intercept_words',
    '/risk-words':'/risk_words',
    '/content-tag':'/content_tag',
  }
  for(const [path,remote]of Object.entries(proxies))r('GET','/modules/zhihu/zhihu-content'+path,async c=>{
    d.operate(c.user)
    const allowed=['offset','limit','title','type','keyword','status','risk_type','url','tags'],params={}
    for(const key of allowed)if(c.data[key]!==undefined){if(!['string','number'].includes(typeof c.data[key])||String(c.data[key]).length>2048)d.fail('查询参数不正确');params[key]=c.data[key]}
    if(params.limit!==undefined&&(Number(params.limit)<1||Number(params.limit)>100))d.fail('每页最多 100 条')
    if(c.params.ruleId)params.rule_id=c.params.ruleId
    return upstream(c,remote,params)
  })
}
module.exports={register,listOf}
