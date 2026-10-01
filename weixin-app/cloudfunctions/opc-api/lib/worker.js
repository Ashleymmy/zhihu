const d=require('./domain')
const {processRow}=require('./imports')
async function run(store,upstream=require('./upstream').client(store),cloud={},options={}){
  const candidates=await require('./job-queue').candidates(store),deadline=Date.now()+(options.budgetMs||45000)
  const results=[]
  for(const job of candidates){
    if(Date.now()>=deadline-5000)break
    const externalWrite=['push-plan','legacy-push-plan','legacy-push-composition','alliance-write'].includes(job.type)
    const lease=d.uid()
    const claimed=await store.transaction(async tx=>{
      const current=await tx.get('jobs',job.id)
      if(!current||current.nextAt>Date.now()||current.status==='running'&&current.leaseUntil>Date.now()||!['pending','running'].includes(current.status))return false
      if(current.status==='running'&&externalWrite){
        await tx.put('jobs',current.id,{...current,status:'uncertain',error:'执行超时，须核对知乎是否已创建'})
        if(current.type!=='alliance-write'){const collection=current.type==='push-plan'?'keywords':current.type==='legacy-push-plan'?'legacy_plans':'legacy_compositions',word=await tx.get(collection,current.keywordId||current.resourceId);if(word)await tx.put(collection,word.id,{...word,syncStatus:'failed',syncError:'上游结果未知，请核对后处理'})}return false
      }
      await tx.put('jobs',current.id,{...current,status:'running',lease,leaseUntil:Date.now()+90000,attempts:(current.attempts||0)+1});return {...current,attempts:(current.attempts||0)+1}
    })
    if(!claimed)continue
    Object.assign(job,claimed)
    try{
      if(job.type==='push-plan'){
        const response=await upstream.request('POST','/popularize_plan',job.payload),value=response.data||response,planId=value.plan_id||value.planId||value.id
        if(!planId)throw new Error('知乎未返回计划编号')
        await store.transaction(async tx=>{
          const current=await tx.get('jobs',job.id);if(current.lease!==lease)d.fail('任务租约已变化',409)
          const word=await tx.get('keywords',job.keywordId)
          // 知乎创建计划的响应是确定性的：拿到 plan_id 即代表审核通过；失败会在
          // catch 分支里直接带上知乎的失败原因，不存在中间“待人工核实”态。
          await tx.put('keywords',word.id,{...word,zhihuPlanId:String(planId),syncStatus:'synced',planStatus:'active',syncError:null,lifecycleStatus:word.bindingId?word.lifecycleStatus:'available',priorityUntil:word.priorityUntil||new Date(Date.now()+86400000).toISOString()})
          await tx.put('jobs',job.id,{...current,status:'completed',completedAt:d.now()})
        })
      }else if(job.type==='import'){
        // Commit each row and its cursor together. A later row failure cannot
        // roll back earlier progress or exceed the transaction operation budget.
        for(let step=0;step<10&&Date.now()<deadline-5000;step++){
          const done=await store.transaction(async tx=>{
          const current=await tx.get('jobs',job.id);if(current.lease!==lease)d.fail('任务租约已变化',409)
          const batch=await tx.get('imports',job.batchId);await tx.lock(['scope',job.scope])
          const end=Math.min(batch.cursor+1,batch.rowCount)
          for(let index=batch.cursor;index<end;index++){const key=batch.id+'-'+String(index).padStart(6,'0'),row=await tx.get('import_rows',key);if(!row)throw new Error('报表行缺失');const result=await processRow(tx,job.scope,row,batch.id);await tx.put('import_rows',key,{...row,result})}
          const done=end===batch.rowCount
          await tx.put('imports',batch.id,{...batch,cursor:end,status:done?'completed':'processing'})
          await tx.put('jobs',job.id,{...current,status:done?'completed':'running',nextAt:Date.now(),lease:done?null:lease,consecutiveFailures:0,error:null})
          return done
          })
          if(done)break
        }
        await store.transaction(async tx=>{const current=await tx.get('jobs',job.id);if(current?.lease===lease)await tx.put('jobs',job.id,{...current,status:'pending',lease:null,nextAt:Date.now()})})
      }else if(job.type==='alliance-write')await require('./alliance').execute(store,upstream,cloud,job,lease)
      else if(job.type.startsWith('legacy-'))await require('./legacy-jobs').run(store,upstream,job,lease)
      else throw new Error('不支持的任务类型')
      results.push({id:job.id,status:'processed'})
    }catch(error){
      let autoRetried=false
      await store.transaction(async tx=>{
        const current=await tx.get('jobs',job.id);if(!current||current.lease!==lease)return
        // An uncertain external write must never be automatically replayed.
        const consecutiveFailures=(current.consecutiveFailures||0)+1
        const message=error instanceof d.Fault?error.message:'任务失败，请查看云函数日志'
        // 关键词放通（失败自动重试）：推送知乎遇瞬时故障（429 限流 / 503 上游不可用）且
        // 创建者在放通范围内时，不标失败，按指数退避自动重排。确定性错误（422，关键词
        // 被驳回/重复）与结果未知（uncertain，可能上游已建）仍走人工，绝不自动重放。
        if(job.type==='push-plan'){
          const word=await tx.get('keywords',job.keywordId)
          const cfg=await tx.get('settings','keyword-auto-retry')
          const creator=word&&word.createdBy?await tx.get('users',word.createdBy):null
          const role=creator?creator.role:''
          const eligible=cfg&&cfg.enabled&&(role==='admin'||(cfg.roles||[]).includes(role))
          const attempts=current.attempts||1
          const maxAttempts=cfg&&cfg.maxAttempts||5
          if(eligible&&[429,503].includes(error.status)&&attempts<maxAttempts){
            const delay=Math.min(60000*Math.pow(2,attempts-1),1800000)
            await tx.put('jobs',job.id,{...current,status:'pending',nextAt:Date.now()+delay,error:message,consecutiveFailures,lease:null})
            if(word)await tx.put('keywords',word.id,{...word,syncError:'同步失败，自动重试中（第 '+attempts+'/'+maxAttempts+' 次）'})
            autoRetried=true
            return
          }
        }
        const status=externalWrite?([422,429,503].includes(error.status)?'failed':'uncertain'):consecutiveFailures>=5?'failed':'pending'
        await tx.put('jobs',job.id,{...current,status,nextAt:Date.now()+60000,error:message,consecutiveFailures,lease:null})
        if(job.type==='push-plan'){const word=await tx.get('keywords',job.keywordId);await tx.put('keywords',word.id,{...word,syncStatus:'failed',syncError:message})}
        if(job.type==='legacy-push-plan'||job.type==='legacy-push-composition'){const collection=job.type==='legacy-push-plan'?'legacy_plans':'legacy_compositions',row=await tx.get(collection,job.resourceId);if(row)await tx.put(collection,row.id,{...row,syncStatus:'failed',syncError:message})}
        if(job.type==='import'&&status==='failed'){const batch=await tx.get('imports',job.batchId);if(batch)await tx.put('imports',batch.id,{...batch,status:'failed',error:message})}
      })
      results.push({id:job.id,status:autoRetried?'auto-retry':'failed'})
    }
  }
  return results
}
module.exports={run}
