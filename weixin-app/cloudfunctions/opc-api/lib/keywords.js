const d=require('./domain')
const {authorize}=require('./store')
const own=(u,b)=>{if(u.role!=='admin'&&b.leaderId!==u.id&&b.executorId!==u.id)d.fail('无权操作此绑定',403)}
async function pair(tx,scope,id) {
  const binding=await tx.get('bindings',id);if(!binding)d.fail('绑定不存在',404)
  const word=d.belongs(await tx.get('keywords',binding.keywordId),scope)
  if(binding.releasedAt||word.bindingId!==id)d.fail('绑定已释放',409)
  return {binding,word}
}
async function target(tx,scope,id) {
  const user=await tx.get('users',id)
  if(!user?.isActive||!['leader','creator'].includes(user.role)||!await tx.get('members',d.hash([scope.projectId,id])))d.fail('请选择有效项目成员',403)
  return user
}
async function enriched(tx,word) {const b=word.bindingId?await tx.get('bindings',word.bindingId):null;return {...word,leaderId:b?.leaderId||null,executorId:b?.executorId||null,pathType:b?.pathType||null,verificationStatus:b?.verificationStatus||'pending',releaseStatus:b?.releaseStatus||'none',priorityEnded:word.priorityUntil&&word.priorityUntil<=d.now()?1:0}}
function attributionFor(user) {return {leaderId:user.role==='leader'?user.id:user.parentId||null,executorId:user.role==='leader'?null:user.id}}
function register(r) {
  r('GET','/modules/zhihu/attribution-options',async c=>{
    const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const members=await c.store.find('members',{projectId:scope.projectId});let users=[]
    if(c.user.role!=='creator')users=(await Promise.all(members.map(m=>c.store.get('users',m.userId)))).filter(u=>u?.isActive&&(c.user.role==='admin'||u.parentId===c.user.id||u.id===c.user.id)).map(d.safeUser)
    return {tasks:await c.store.find('tasks',{projectId:scope.projectId}),channels:c.user.role==='admin'?await c.store.find('channels',{projectId:scope.projectId,isEnabled:true}):[],mappings:(await c.store.find('mappings',scope)).filter(m=>!m.canonicalId),users}
  })
  r('POST','/modules/zhihu/channel-mappings',async c=>{
    d.duty(c.user,'operations');const scope=d.scopeOf(c.data),input={...scope,channelId:d.id(c.data.channelId),channelName:d.text(c.data.name,'渠道名',255),from:d.day(c.data.from),to:c.data.to?d.day(c.data.to):null,canonicalId:c.data.canonicalId?d.id(c.data.canonicalId):null}
    if(input.to&&input.to<=input.from)d.fail('有效期不正确')
    return c.store.mutate(c.user,scope,'mapping.create',c.key,input,async tx=>{
      await authorize(tx,c.user,scope);const channel=await tx.get('channels',input.channelId);if(!channel?.isEnabled||channel.projectId!==scope.projectId)d.fail('渠道不属于项目')
      await tx.lock(['mapping',scope.accountId,input.channelName])
      const other=await tx.find('mappings',{accountId:scope.accountId,channelName:input.channelName})
      if(other.some(m=>m.from<(input.to||'9999-12-31')&&(m.to||'9999-12-31')>input.from))d.fail('同名渠道有效期冲突',409)
      if(input.canonicalId){const canonical=d.belongs(await tx.get('mappings',input.canonicalId),scope);if(canonical.canonicalId||canonical.channelId!==input.channelId)d.fail('别名必须指向同渠道的主映射')}
      const row=await tx.add('mappings',{...input,createdBy:c.user.id});return {id:row.id}
    })
  })
  r('GET','/modules/zhihu/keywords',async c=>{
    d.operate(c.user);const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const all=await c.store.find('keywords',scope),list=[]
    for(const row of all){const item=await enriched(c.store,row);if(c.user.role==='admin'||!item.bindingId||item.leaderId===c.user.id||item.executorId===c.user.id)if(item.keyword.includes(String(c.data.search||'')))list.push(item)}
    return d.page(list.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),c.data)
  })
  r('POST','/modules/zhihu/keywords',async c=>{
    d.operate(c.user);const scope=d.scopeOf(c.data),keyword=d.text(c.data.keyword,'关键词')
    if(/[\s,，、;；]/u.test(keyword))d.fail('请填写单个关键词')
    const input={...scope,keyword,taskId:d.id(c.data.taskId),mappingId:d.id(c.data.mappingId),landingUrl:d.url(c.data.landingUrl),popularizeType:Number(c.data.popularizeType)}
    if(input.popularizeType!==0)d.fail('当前知乎协议仅支持内容推广（popularizeType=0）')
    return c.store.mutate(c.user,scope,'keyword.create',c.key,input,async tx=>{
      await authorize(tx,c.user,scope);const task=await tx.get('tasks',input.taskId),mapping=d.belongs(await tx.get('mappings',input.mappingId),scope),channel=await tx.get('channels',mapping.channelId)
      if(task?.projectId!==scope.projectId||!channel?.isEnabled||mapping.canonicalId)d.fail('任务或渠道不可用')
      await tx.lock('keyword-space')
      if((await tx.find('legacy_plans',{keyword})).length)d.fail('历史关键词保留原归属，请使用新词',409)
      let word={...input,id:d.uid(),planId:d.uid(),bindingId:null,usedEverAt:null,lifecycleStatus:'pending',syncStatus:'local',planStatus:'pending',syncError:null,priorityUntil:c.user.role==='admin'?d.now():null,createdAt:d.now(),createdBy:c.user.id}
      await tx.unique('keyword',keyword,word.id);await tx.put('keywords',word.id,word)
      if(c.user.role!=='admin'){
        const {leaderId,executorId}=attributionFor(c.user)
        if(leaderId&&c.user.role==='creator'){const parent=await target(tx,scope,leaderId);if(parent.role!=='leader')d.fail('请先将团长加入项目')}
        const binding=await tx.add('bindings',{keywordId:word.id,leaderId,executorId,pathType:!executorId?'reserved':leaderId?'team_creator':'direct_creator',verificationStatus:'pending',releaseStatus:'none',usedAt:null,releasedAt:null,stopNewUseAt:null,relationSnapshot:{leaderId,executorId}})
        word={...word,bindingId:binding.id,lifecycleStatus:executorId?'assigned':'reserved'};await tx.put('keywords',word.id,word)
      }
      await tx.put('jobs','plan-'+word.id,{id:'plan-'+word.id,type:'push-plan',keywordId:word.id,scope,status:'pending',attempts:0,nextAt:Date.now(),payload:{task_id:task.zhihuTaskId,channel_id:channel.zhihuChannelId,content_url:input.landingUrl,keyword,popularize_type:input.popularizeType},createdAt:d.now()})
      return {id:word.id,planId:word.planId}
    })
  })
  for(const action of ['claim','distribute'])r('POST','/modules/zhihu/keywords/:id/'+action,async c=>{
    d.operate(c.user);const scope=d.scopeOf(c.data),targetId=action==='claim'?c.user.id:d.id(c.data.targetId)
    if(action==='distribute')d.duty(c.user,'operations')
    return c.store.mutate(c.user,scope,'keyword.'+action,c.key,{id:c.params.id,targetId},async tx=>{
      await authorize(tx,c.user,scope);const word=d.belongs(await tx.get('keywords',c.params.id),scope)
      if(word.bindingId||word.lifecycleStatus!=='available'||word.syncStatus!=='synced'||word.planStatus!=='active')d.fail('关键词不可领取或已被占用',409)
      const user=await target(tx,scope,targetId)
      if(action==='claim'&&user.role==='creator'&&(user.parentId||!word.priorityUntil||word.priorityUntil>d.now()))d.fail('仅优先期结束后的直属达人可领取',403)
      const {leaderId,executorId}=attributionFor(user)
      if(leaderId&&user.role==='creator'){const parent=await target(tx,scope,leaderId);if(parent.role!=='leader')d.fail('请先将团长加入项目')}
      const binding=await tx.add('bindings',{keywordId:word.id,leaderId,executorId,pathType:!executorId?'reserved':leaderId?'team_creator':'direct_creator',verificationStatus:'pending',releaseStatus:'none',usedAt:null,releasedAt:null,stopNewUseAt:null,relationSnapshot:{leaderId,executorId}})
      await tx.put('keywords',word.id,{...word,bindingId:binding.id,lifecycleStatus:executorId?'assigned':'reserved'});return {id:binding.id}
    })
  })
  for(const action of ['assign','activate','request-release','release','stop'])r('POST','/modules/zhihu/bindings/:id/'+action,async c=>{
    d.operate(c.user);const scope=d.scopeOf(c.data)
    return c.store.mutate(c.user,scope,'binding.'+action,c.key,{id:c.params.id,...c.data},async tx=>{
      await authorize(tx,c.user,scope);const {binding:b,word}=await pair(tx,scope,c.params.id);own(c.user,b)
      if(action==='assign'){
        if(b.usedAt||b.stopNewUseAt||!b.leaderId||c.user.role!=='admin'&&(c.user.role!=='leader'||b.leaderId!==c.user.id))d.fail('不可重新分配',403)
        const user=await target(tx,scope,d.id(c.data.executorId)),self=user.id===b.leaderId
        if(self?user.role!=='leader':user.role!=='creator'||user.parentId!==b.leaderId)d.fail('只能分配给所属团长或团队达人')
        await tx.put('bindings',b.id,{...b,executorId:user.id,pathType:self?'leader_self':'team_creator',assignedAt:d.now()});await tx.put('keywords',word.id,{...word,lifecycleStatus:'assigned'})
      } else if(action==='activate'){
        if(b.executorId!==c.user.id)d.fail('仅执行人可以声明使用',403)
        if(b.usedAt)return {id:b.id}
        if(b.stopNewUseAt||b.releaseStatus==='requested')d.fail('已停止使用或正在释放',409)
        if(b.pathType==='team_creator'&&c.user.parentId!==b.leaderId||b.pathType==='direct_creator'&&c.user.parentId)d.fail('团队关系已变化',409)
        await tx.put('bindings',b.id,{...b,usedAt:d.now(),activatedOn:d.today()});await tx.put('keywords',word.id,{...word,usedEverAt:d.now(),lifecycleStatus:'active'})
      } else if(action==='stop'){
        await tx.put('bindings',b.id,{...b,stopNewUseAt:d.now()});await tx.put('keywords',word.id,{...word,lifecycleStatus:'retired'})
      } else {
        const reason=d.text(c.data.reason,'未使用依据',500)
        if(word.usedEverAt||b.usedAt||(await tx.find('facts',{keywordId:word.id})).length)d.fail('已有使用记录，不能释放',409)
        if(action==='release'){d.duty(c.user,'operations');if(b.releaseStatus!=='requested')d.fail('尚未申请释放');await tx.put('bindings',b.id,{...b,releasedAt:d.now(),releaseStatus:'approved',releaseReason:reason});await tx.put('keywords',word.id,{...word,bindingId:null,lifecycleStatus:'available'})}
        else await tx.put('bindings',b.id,{...b,releaseStatus:'requested',releaseReason:reason})
      }
      return {id:b.id}
    })
  })
  r('POST','/modules/zhihu/keywords/:id/retry-upstream',async c=>{
    d.duty(c.user,'operations');const scope=d.scopeOf(c.data)
    return c.store.mutate(c.user,scope,'keyword.retry',c.key,{id:c.params.id},async tx=>{
      await authorize(tx,c.user,scope);const word=d.belongs(await tx.get('keywords',c.params.id),scope),job=await tx.get('jobs','plan-'+word.id)
      if(word.usedEverAt||word.syncStatus!=='failed'||!job||job.status==='uncertain')d.fail('需先核对上游状态后重试',409)
      await tx.put('jobs',job.id,{...job,status:'pending',nextAt:Date.now()});await tx.put('keywords',word.id,{...word,syncStatus:'local',syncError:null});return {id:word.id}
    })
  })
  // 编辑并重试同步异常的关键词：可改关键词文本/落地链接/渠道映射，改完重置同步状态并重新排队推送。
  // 仅从未使用的词可改（已使用的词身份已锁定）；管理员或该词所属团长可操作。
  r('POST','/modules/zhihu/keywords/:id/edit',async c=>{
    d.operate(c.user);if(c.user.role==='creator')d.fail('无编辑关键词权限',403);const scope=d.scopeOf(c.data)
    const input={keyword:d.text(c.data.keyword,'关键词'),landingUrl:d.url(c.data.landingUrl),mappingId:d.id(c.data.mappingId)}
    if(/[\s,，、;；]/u.test(input.keyword))d.fail('请填写单个关键词')
    return c.store.mutate(c.user,scope,'keyword.edit',c.key,{id:c.params.id,...input},async tx=>{
      await authorize(tx,c.user,scope)
      const word=d.belongs(await tx.get('keywords',c.params.id),scope)
      if(word.usedEverAt)d.fail('已使用的关键词不能编辑',409)
      if(word.syncStatus!=='failed')d.fail('仅同步异常的关键词可编辑重试',409)
      if(c.user.role!=='admin'){
        const b=word.bindingId?await tx.get('bindings',word.bindingId):null
        if(!b||b.leaderId!==c.user.id)d.fail('仅所属团长或管理员可编辑',403)
      }
      const mapping=d.belongs(await tx.get('mappings',input.mappingId),scope)
      const channel=await tx.get('channels',mapping.channelId)
      if(!channel?.isEnabled||mapping.canonicalId)d.fail('渠道映射不可用')
      // 关键词文本变化时迁移唯一索引（旧名释放、新名占用）
      if(input.keyword!==word.keyword){
        await tx.remove('keys',d.hash(['keyword',word.keyword]))
        await tx.unique('keyword',input.keyword,word.id)
      }
      await tx.put('keywords',word.id,{...word,keyword:input.keyword,landingUrl:input.landingUrl,mappingId:input.mappingId,syncStatus:'local',syncError:null})
      const jobId='plan-'+word.id,old=await tx.get('jobs',jobId)
      const task=await tx.get('tasks',word.taskId)
      const payload={task_id:task?.zhihuTaskId||'',channel_id:channel.zhihuChannelId,content_url:input.landingUrl,keyword:input.keyword,popularize_type:0}
      await tx.put('jobs',jobId,{id:jobId,type:'push-plan',keywordId:word.id,scope,status:'pending',attempts:0,nextAt:Date.now(),payload,createdAt:old?.createdAt||d.now()})
      return {id:word.id}
    })
  })
  // 删除失败的关键词：仅从未使用且未成功同步到上游的词可删（已同步的走释放流程，避免上游孤儿计划）。
  // 连带删除归属记录、关键词唯一索引与推送任务。
  r('DELETE','/modules/zhihu/keywords/:id',async c=>{
    d.operate(c.user);if(c.user.role==='creator')d.fail('无删除关键词权限',403);const scope=d.scopeOf(c.data)
    return c.store.mutate(c.user,scope,'keyword.delete',c.key,{id:c.params.id},async tx=>{
      await authorize(tx,c.user,scope)
      const word=d.belongs(await tx.get('keywords',c.params.id),scope)
      if(word.usedEverAt)d.fail('已使用的关键词不能删除',409)
      if(word.syncStatus==='synced'&&word.planStatus==='active')d.fail('已同步上游的关键词请走释放流程',409)
      if(c.user.role!=='admin'){
        const b=word.bindingId?await tx.get('bindings',word.bindingId):null
        if(!b||b.leaderId!==c.user.id)d.fail('仅所属团长或管理员可删除',403)
      }
      if(word.bindingId)await tx.remove('bindings',word.bindingId)
      await tx.remove('keywords',word.id)
      await tx.remove('keys',d.hash(['keyword',word.keyword]))
      await tx.remove('jobs','plan-'+word.id)
      return {id:word.id}
    })
  })
  r('GET','/modules/zhihu/evidence',async c=>{
    d.operate(c.user);const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const rows=await c.store.find('evidence',scope),list=[]
    for(const e of rows){const b=await c.store.get('bindings',e.bindingId);if(b&&(c.user.role==='admin'||b.leaderId===c.user.id||b.executorId===c.user.id))list.push({...e,executorId:b.executorId,verificationStatus:b.verificationStatus})}
    return d.page(list.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),c.data)
  })
  r('POST','/modules/zhihu/evidence',async c=>{
    d.operate(c.user);const scope=d.scopeOf(c.data)
    const str=(v,n)=>v?String(v).slice(0,n):''
    const input={...scope,bindingId:d.id(c.data.bindingId),workUrl:d.url(c.data.url),description:d.text(c.data.description,'说明',1000),platform:str(c.data.platform,100),publishDate:str(c.data.publishDate,20),workType:str(c.data.workType,20),contentType:str(c.data.contentType,50)}
    return c.store.mutate(c.user,scope,'evidence.submit',c.key,input,async tx=>{
      await authorize(tx,c.user,scope);const {binding,word}=await pair(tx,scope,input.bindingId)
      const admin=c.user.role==='admin'
      if(!admin&&(binding.executorId!==c.user.id||!binding.usedAt))d.fail('仅已声明使用的执行人可提交作品',403)
      const row=await tx.add('evidence',{...input,keyword:word.keyword,status:'pending',submittedBy:c.user.id,reason:null})
      return {id:row.id}
    })
  })
  r('POST','/modules/zhihu/xlsx/parse',async c=>{
    d.operate(c.user)
    const XLSX=require('xlsx')
    const buf=Buffer.from(c.data.file,'base64')
    const wb=XLSX.read(buf,{type:'buffer'})
    const ws=wb.Sheets[wb.SheetNames[0]]
    const rows=XLSX.utils.sheet_to_json(ws,{defval:''})
    return {rows:rows.map(row=>({keyword:String(row['关键词']||'').trim(),url:String(row['视频链接']||'').trim(),platform:String(row['平台']||'').trim()})).filter(row=>row.keyword||row.url)}
  })
  r('POST','/modules/zhihu/evidence/:id/review',async c=>{
    d.operate(c.user);const scope=d.scopeOf(c.data),reason=d.text(c.data.reason,'审核说明',500);if(typeof c.data.accept!=='boolean')d.fail('审核结果不正确')
    return c.store.mutate(c.user,scope,'evidence.review',c.key,{id:c.params.id,accept:c.data.accept,reason},async tx=>{
      await authorize(tx,c.user,scope);const e=d.belongs(await tx.get('evidence',c.params.id),scope),{binding:b}=await pair(tx,scope,e.bindingId)
      if(c.user.role!=='admin'&&(c.user.role!=='leader'||b.leaderId!==c.user.id||b.executorId===c.user.id))d.fail('不能审核此作品',403)
      if(e.status!=='pending')d.fail('作品已审核',409)
      await tx.put('evidence',e.id,{...e,status:c.data.accept?'passed':'rejected',reason,reviewedBy:c.user.id,reviewedAt:d.now()})
      if(c.data.accept&&b.verificationStatus!=='disputed')await tx.put('bindings',b.id,{...b,verificationStatus:'passed'})
      return {id:e.id}
    })
  })
  // 关键词放通（失败自动重试）：配置存 settings/keyword-auto-retry。
  // 放通范围内成员创建的关键词，推送知乎遇瞬时故障（限流 429/上游不可用 503）时
  // 由 worker 按指数退避自动重试；确定性错误(422)与结果未知(uncertain)仍走人工。
  const AUTO_RETRY_DEFAULT = { enabled: false, roles: ['creator', 'leader'], maxAttempts: 5 }
  r('GET', '/core/settings/keyword-auto-retry', async c => {
    const s = await c.store.get('settings', 'keyword-auto-retry')
    return s && typeof s.enabled === 'boolean'
      ? { enabled: s.enabled, roles: s.roles || [], maxAttempts: s.maxAttempts || 5 }
      : AUTO_RETRY_DEFAULT
  })
  r('POST', '/core/settings/keyword-auto-retry', async c => {
    d.duty(c.user, 'operations')
    const input = {
      enabled: !!c.data.enabled,
      roles: (Array.isArray(c.data.roles) ? c.data.roles : []).filter(r => ['creator', 'leader'].includes(r)),
      maxAttempts: Number(c.data.maxAttempts) || 5,
    }
    if (input.enabled && !input.roles.length) d.fail('请至少选择一个放通角色')
    if (input.maxAttempts < 1 || input.maxAttempts > 10) d.fail('自动重试次数须为 1-10 次')
    return c.store.transaction(async tx => {
      await tx.put('settings', 'keyword-auto-retry', { id: 'keyword-auto-retry', ...input, updatedBy: c.user.id, updatedAt: d.now() })
      await tx.audit(c.user, 'settings.keyword-auto-retry', 'keyword-auto-retry', input)
      return input
    })
  })
}
module.exports={register,pair,own}
