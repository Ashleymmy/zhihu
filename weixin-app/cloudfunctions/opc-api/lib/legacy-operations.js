const d=require('./domain')
const {authorize}=require('./store')
const {visible,list}=require('./legacy-finance')
const composition=require('../vendor/zhihu/composition')
async function scopeRows(tx,scope,rows){
  const candidates=rows.filter(row=>row.projectId===scope.projectId)
  if(candidates.some(row=>!row.accountId)){
    const links=await tx.find('links',{projectId:scope.projectId})
    // Source-era rows have no account ID. Never infer ownership from the caller
    // when the project is linked to more than one integration account.
    if(links.length!==1||links[0].accountId!==scope.accountId)d.fail('历史记录缺少唯一接入账号归属，请先核对迁移映射',409)
  }
  return candidates.filter(row=>!row.accountId||row.accountId===scope.accountId)
}
async function plan(tx,user,scope,id){const row=await tx.get('legacy_plans',id);if(!row||!await visible(tx,user,row,'ownerId')||!(await scopeRows(tx,scope,[row])).length)d.fail('计划不存在',404);return row}
function metadata(data,dates=false){
  const patch={}
  if(data.name!==undefined){if(data.name!==null&&(typeof data.name!=='string'||data.name.length>255))d.fail('计划名称格式不正确');patch.name=data.name}
  if(data.dailyBudget!==undefined){if(data.dailyBudget!==null&&(typeof data.dailyBudget!=='number'||!Number.isFinite(data.dailyBudget)||data.dailyBudget<0))d.fail('日预算须为非负数');patch.dailyBudget=data.dailyBudget===null?null:d.money(d.cash(String(data.dailyBudget)))}
  if(dates){for(const key of ['startDate','endDate'])if(data[key]!==undefined)patch[key]=data[key]===null?null:d.day(data[key]);if(patch.startDate&&patch.endDate&&patch.startDate>patch.endDate)d.fail('结束日期不能早于开始日期')}
  return patch
}
async function queue(tx,scope,row,type){
  const id=type+'-'+row.id,previous=await tx.get('jobs',id)
  if(previous&&['running','uncertain'].includes(previous.status))d.fail('上游结果尚未确定，请先核对同步状态',409)
  await tx.put('jobs',id,{id,type,scope,resourceId:row.id,status:'pending',attempts:0,nextAt:Date.now(),createdAt:d.now()})
}
function keyword(value){const word=d.text(value,'关键词',128);if(/[\s,，、;；]/u.test(word))d.fail('只支持单个关键词');return word}
async function free(tx,word,channelId,except){
  if(await tx.get('keys',d.hash(['keyword',word])))d.fail('关键词已进入新引擎',409)
  if((await tx.find('legacy_plans',{keyword:word,channelId})).some(p=>p.id!==except))d.fail('关键词已被绑定',409)
}
function compositionInput(data){
  const mediaType=composition.normalizeMediaType(data.mediaType),compositionType=Number(data.compositionType),compositionSubType=Number(data.compositionSubType)
  if(!composition.isCompositionCategoryValid(compositionType,compositionSubType))d.fail('作品分类组合不正确')
  if(typeof data.releaseTime!=='string'||!composition.isZonedIsoDateTime(data.releaseTime))d.fail('作品发布时间须为带时区的 ISO 8601')
  return {planId:d.id(data.planId),mediaType,mediaAccount:d.text(data.mediaAccount,'媒体账号',128),compositionType,compositionSubType,promoUrl:d.url(data.promoUrl),releaseTime:composition.normalizeZonedIsoDateTime(data.releaseTime),title:String(data.title||'').slice(0,255)}
}
async function createComposition(c,batch=false){
  d.operate(c.user);const scope=d.scopeOf(c.data),raw=batch?c.data.items:[c.data]
  if(!Array.isArray(raw)||!raw.length||raw.length>20)d.fail('一次提交 1 至 20 个作品',413)
  const items=raw.map(compositionInput)
  return c.store.mutate(c.user,scope,'legacy.composition.create',c.key,{items},async tx=>{
    const result=[]
    for(const input of items){const p=await plan(tx,c.user,scope,input.planId);if(p.status==='ended')d.fail('计划已结束',409);const row=await tx.add('legacy_compositions',{...input,...scope,ownerId:p.ownerId,status:'pending',syncStatus:'local'});await queue(tx,scope,row,'legacy-push-composition');result.push({id:row.id,syncStatus:'local'})}
    return batch?{items:result}:result[0]
  })
}
function aggregate(rows){return rows.reduce((s,r)=>({impressions:s.impressions+BigInt(r.impressions||0),clicks:s.clicks+BigInt(r.clicks||0),conversions:s.conversions+BigInt(r.conversions||0),earning:s.earning+d.cash(String(r.earning||0),true)}),{impressions:0n,clicks:0n,conversions:0n,earning:0n})}
function publicTotals(sum){return {impressions:String(sum.impressions),clicks:String(sum.clicks),conversions:String(sum.conversions),earning:d.money(sum.earning)}}
function register(r){
  r('GET','/modules/zhihu/plans',async c=>{d.operate(c.user);const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);const rows=(await scopeRows(c.store,scope,await list(c.store,c.user,'legacy_plans',c.data,'ownerId'))).filter(p=>p.status!=='ended'&&(!c.data.keyword||p.keyword.includes(c.data.keyword))&&(!c.data.channelId||p.channelId===c.data.channelId)&&(!c.data.taskId||p.zhihuTaskId===c.data.taskId));return d.page(rows,c.data)})
  r('GET','/modules/zhihu/plans/:id',async c=>{d.operate(c.user);const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);return plan(c.store,c.user,scope,c.params.id)})
  r('POST','/modules/zhihu/plans/check-keyword',async c=>{d.operate(c.user);const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);const word=keyword(c.data.keyword),matches=await c.store.find('legacy_plans',{channelId:String(c.data.channelId),keyword:word}),newKey=await c.store.get('keys',d.hash(['keyword',word]));const mine=matches.filter(row=>row.ownerId===c.user.id),row=(await scopeRows(c.store,scope,mine))[0];return {available:!matches.length&&!newKey,occupiedByMe:!!row,planId:row?.id||null}})
  r('POST','/modules/zhihu/plans',async c=>{
    d.operate(c.user);const scope=d.scopeOf(c.data),input={keyword:keyword(c.data.keyword),zhihuTaskId:d.text(String(c.data.taskId||''),'任务 ID'),channelId:d.text(String(c.data.channelId||''),'渠道 ID'),secondChannelId:c.data.secondChannelId||null,landingUrl:d.url(c.data.landingUrl),popularizeType:Number(c.data.popularizeType),ownerId:c.data.ownerId?d.id(c.data.ownerId):c.user.id,name:String(c.data.name||'').slice(0,255)}
    Object.assign(input,metadata(c.data,true))
    if(input.popularizeType!==0)d.fail('当前知乎协议仅支持内容推广（popularizeType=0）')
    return c.store.mutate(c.user,scope,'legacy.plan.create',c.key,input,async tx=>{
      await tx.lock('keyword-space');await require('./routing').assertLegacyRoute(tx,scope.projectId,d.today())
      const owner=await tx.get('users',input.ownerId);if(!owner?.isActive||!await visible(tx,c.user,{ownerId:owner.id},'ownerId')||!await tx.get('members',d.hash([scope.projectId,owner.id])))d.fail('无权分配给此成员',403)
      const channels=await tx.find('channels',{projectId:scope.projectId,zhihuChannelId:input.channelId,isEnabled:true});if(!channels.length)d.fail('渠道不属于当前项目')
      await free(tx,input.keyword,input.channelId)
      const row=await tx.add('legacy_plans',{...scope,...input,createdBy:c.user.id,status:'pending',syncStatus:'local',zhihuPlanId:null});await queue(tx,scope,row,'legacy-push-plan');return {id:row.id,syncStatus:'local'}
    })
  })
  r('PATCH','/modules/zhihu/plans/:id',async c=>{
    d.operate(c.user);const scope=d.scopeOf(c.data),patch={}
    if(c.data.keyword!==undefined)patch.keyword=keyword(c.data.keyword);if(c.data.landingUrl!==undefined)patch.landingUrl=d.url(c.data.landingUrl);Object.assign(patch,metadata(c.data))
    if(!Object.keys(patch).length)d.fail('没有可修改字段')
    return c.store.mutate(c.user,scope,'legacy.plan.update',c.key,{id:c.params.id,patch},async tx=>{
      await tx.lock('keyword-space');const row=await plan(tx,c.user,scope,c.params.id)
      if(await tx.get('keys',d.hash(['keyword',row.keyword])))d.fail('该计划已进入新引擎',409)
      if(patch.keyword){if(row.syncStatus!=='failed'||row.zhihuPlanId||patch.keyword===row.keyword)d.fail('仅未同步成功的失败计划可更换关键词',409);await free(tx,patch.keyword,row.channelId,row.id)}
      const resubmit=patch.keyword!==undefined||patch.landingUrl!==undefined
      if(resubmit&&row.zhihuPlanId)d.fail('知乎当前协议不支持修改已创建计划的关键词或推广链接',409)
      const next={...row,...patch,...(resubmit?{syncStatus:'local',syncError:null}:{}),updatedAt:d.now()};await tx.put('legacy_plans',row.id,next);if(resubmit)await queue(tx,scope,next,'legacy-push-plan');return next
    })
  })
  r('DELETE','/modules/zhihu/plans/:id',async c=>{d.operate(c.user);const scope=d.scopeOf(c.data);return c.store.mutate(c.user,scope,'legacy.plan.end',c.key,{id:c.params.id},async tx=>{const row=await plan(tx,c.user,scope,c.params.id);if(await tx.get('keys',d.hash(['keyword',row.keyword])))d.fail('该计划已进入新引擎',409);const job=await tx.get('jobs','legacy-push-plan-'+row.id);if(job?.status==='running')d.fail('计划正在同步，请稍后操作',409);await tx.put('legacy_plans',row.id,{...row,status:'ended'});if(job&&job.status==='pending')await tx.put('jobs',job.id,{...job,status:'cancelled'});return {id:row.id}})})
  r('POST','/modules/zhihu/plans/:id/retry-sync',async c=>{d.operate(c.user);const scope=d.scopeOf(c.data);return c.store.mutate(c.user,scope,'legacy.plan.retry',c.key,{id:c.params.id},async tx=>{const row=await plan(tx,c.user,scope,c.params.id);if(row.syncStatus!=='failed')d.fail('只有失败计划可重试',409);await queue(tx,scope,row,'legacy-push-plan');await tx.put('legacy_plans',row.id,{...row,syncStatus:'local',syncError:null});return {id:row.id}})})
  r('GET','/modules/zhihu/compositions',async c=>{d.operate(c.user);const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);const plans=new Map((await scopeRows(c.store,scope,await list(c.store,c.user,'legacy_plans',{},'ownerId'))).map(p=>[p.id,p])),result=[];for(const row of await list(c.store,c.user,'legacy_compositions',c.data,'ownerId')){const p=plans.get(row.planId);if(p&&(!row.accountId||row.accountId===scope.accountId)&&(!c.data.planId||row.planId===c.data.planId))result.push({...row,keyword:p.keyword})}return d.page(result,c.data)})
  r('POST','/modules/zhihu/compositions',c=>createComposition(c))
  r('POST','/modules/zhihu/compositions/batch',c=>createComposition(c,true))
  r('PATCH','/modules/zhihu/compositions/:id',async c=>{
    d.operate(c.user);const scope=d.scopeOf(c.data)
    return c.store.mutate(c.user,scope,'legacy.composition.update',c.key,{id:c.params.id,patch:c.data},async tx=>{
      const row=await tx.get('legacy_compositions',c.params.id);if(!row||!await visible(tx,c.user,row,'ownerId'))d.fail('作品不存在',404);await plan(tx,c.user,scope,row.planId)
      const fields=['mediaType','mediaAccount','compositionType','compositionSubType','title','promoUrl','releaseTime'],patch=Object.fromEntries(fields.filter(k=>c.data[k]!==undefined).map(k=>[k,c.data[k]])),input=compositionInput({...row,...patch})
      const next={...row,...input,syncStatus:'local',syncError:null,updatedAt:d.now()};await tx.put('legacy_compositions',row.id,next);await queue(tx,scope,next,'legacy-push-composition');return {id:row.id}
    })
  })
  r('GET','/modules/zhihu/compositions/:id/audit-status',async c=>{d.operate(c.user);const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);const row=await c.store.get('legacy_compositions',c.params.id);if(!row||!await visible(c.store,c.user,row,'ownerId'))d.fail('作品不存在',404);await plan(c.store,c.user,scope,row.planId);return {id:row.id,status:row.status,rejectReason:row.rejectReason||null,syncStatus:row.syncStatus}})
  r('GET','/modules/zhihu/meta/enums',async()=>({mediaType:composition.ZHIHU_MEDIA_TYPES.map(value=>({value,label:value})),compositionType:composition.COMPOSITION_TYPES,compositionSubType:composition.COMPOSITION_SUB_TYPES,popularizeType:[{value:0,label:'内容推广'}],planStatus:['pending','active','paused','rejected','ended'].map(value=>({value,label:{pending:'待同步',active:'投放中',paused:'已暂停',rejected:'已驳回',ended:'已结束'}[value]}))}))
  for(const mode of ['overview','trend','by-keyword','by-member'])r('GET','/modules/zhihu/metrics/'+mode,async c=>{
    d.finance(c.user);if(mode==='by-member'&&c.user.role==='creator')d.fail('无团队数据权限',403)
    const from=c.data.from?d.day(c.data.from):'1970-01-01',to=c.data.to?d.day(c.data.to):'2999-12-31';if(from>to)d.fail('日期范围不正确')
    const rows=(await list(c.store,c.user,'legacy_metrics',{},'ownerId')).filter(row=>row.statDate>=from&&row.statDate<=to)
    if(mode==='overview')return {today:publicTotals(aggregate(rows.filter(row=>row.statDate===d.today()))),total:publicTotals(aggregate(rows))}
    const groups=new Map();for(const row of rows){const key=mode==='trend'?row.statDate:mode==='by-member'?row.ownerId:JSON.stringify([row.channelId,row.keyword]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
    if(mode==='trend'){const dates=[...groups.keys()].sort(),totals=dates.map(date=>publicTotals(aggregate(groups.get(date))));return {dates,series:['impressions','clicks','conversions','earning'].map((key,i)=>({key,name:['曝光','点击','转化','收益'][i],values:totals.map(v=>v[key])}))}}
    const output=[];for(const group of groups.values()){const totals=publicTotals(aggregate(group)),row=group[0];output.push({...totals,...(mode==='by-member'?{ownerId:row.ownerId,displayName:(await c.store.get('users',row.ownerId))?.displayName}:{channelId:row.channelId,keyword:row.keyword})})}
    const sort=['earning','impressions','clicks','conversions'].includes(c.data.sort)?c.data.sort:'earning';output.sort((a,b)=>{const x=sort==='earning'?d.cash(a[sort],true):BigInt(a[sort]),y=sort==='earning'?d.cash(b[sort],true):BigInt(b[sort]);return (x===y?0:x<y?-1:1)*(c.data.order==='asc'?1:-1)})
    return mode==='by-member'?output:d.page(output,c.data)
  })
}
module.exports={register,queue,plan,scopeRows}
