const d=require('./domain'),crypto=require('node:crypto'),bcrypt=require('bcryptjs')
const {isolatedStore,cleanup}=require('./acceptance-store'),{createAPI}=require('./api')
const scope={projectId:'1',accountId:'10'}
const stages=['seed','roles','operations','finance','cleanup']
function ensure(value,message){if(!value){const error=Error('Acceptance check failed');error.acceptanceCheck=message;throw error}}
async function run(base,db,cloud){
  const key='business-acceptance',lease=crypto.randomBytes(16).toString('hex')
  let state=await base.transaction(async tx=>{
    const old=await tx.get('settings',key)
    if(old?.status==='passed'||old?.status==='failed')return old
    if(old?.leaseUntil>Date.now())d.fail('业务验收正在执行，请稍后重试',409)
    const next={...(old||{runId:crypto.randomBytes(12).toString('hex'),stage:'seed',checks:{},startedAt:d.now()}),status:'running',lease,leaseUntil:Date.now()+90000}
    await tx.put('settings',key,next);return next
  })
  if(state.status==='passed'||state.status==='failed')return publicState(state)
  const store=isolatedStore(db,state.runId),identity={openid:'acceptance-'+state.runId,appid:'wx22b91776ccf37354'}
  // API uses an upstream stub that fails any attempt; no real Zhihu business is called.
  const api=createAPI(store,{},'acceptance',{upstream:{request:async()=>{throw Error('Acceptance must not contact upstream')}}})
  const invoke=(token,method,path,data={})=>api.handle({token,method,path,data},identity)
  const ok=async(token,method,path,data)=>{const response=await invoke(token,method,path,data);if(response.code!==0){const error=Error('Acceptance API '+path+' '+response.code);error.acceptanceCheck=path+' '+response.code;if(response.diagnostic)error.apiDiagnostic=response.diagnostic;throw error}return response.data}
  const checkpoint=async(name,build)=>{const old=await store.get('settings',name);if(old)return old.value;const value=await build();await store.put('settings',name,{value});return value}
  const login=async name=>{
    const password=crypto.createHash('sha256').update('acceptance-password:'+state.runId).digest('hex')
    return (await ok(null,'POST','/core/auth/login',{username:name,password})).token
  }
  try{
    if(state.stage==='seed'){
      const passwordHash=await bcrypt.hash(crypto.createHash('sha256').update('acceptance-password:'+state.runId).digest('hex'),4)
      const roles=[['1','admin','admin','all'],['2','leader','leader'],['3','creator','creator'],['4','finance','admin','finance'],['5','operations','admin','operations']]
      await store.transaction(async tx=>{
        for(const [id,username,role,adminDuty]of roles){await tx.put('users',id,{id,username,displayName:username,role,adminDuty:adminDuty||'all',parentId:id==='3'?'2':null,passwordHash,isActive:true,sessionVersion:0,mustChangePwd:false});await tx.put('keys',d.hash(['username',username]),{owner:id})}
        await tx.put('projects','1',{id:'1',name:'Acceptance project',isEnabled:true})
        await tx.put('accounts','10',{id:'10',moduleId:'zhihu',status:'active'})
        await tx.put('links',d.hash(scope),scope)
        for(const id of ['2','3'])await tx.put('members',d.hash(['1',id]),{projectId:'1',userId:id})
        await tx.put('routes',d.hash(scope),{id:d.hash(scope),...scope,exclusiveFrom:'2020-01-01',mode:'enabled'})
        await tx.put('tasks','20',{id:'20',projectId:'1',zhihuTaskId:'200'})
        await tx.put('mappings','40',{id:'40',...scope,channelId:'30',channelName:'acceptance',from:'2020-01-01'})
      });state.checks.seed=true
    }else if(state.stage==='roles'){
      const sessions={};for(const name of ['admin','leader','creator','finance','operations']){sessions[name]=await login(name);ensure((await ok(sessions[name],'GET','/core/auth/me')).username===name,'role login')}
      ensure((await invoke(sessions.creator,'GET','/core/staff')).code===40300,'creator staff isolation')
      ensure((await invoke(sessions.finance,'GET','/modules/zhihu/keywords',scope)).code===40300,'finance operations isolation')
      ensure((await invoke(sessions.operations,'GET','/core/finance',{...scope,moduleId:'zhihu'})).code===40300,'operations finance isolation')
      ensure((await invoke(sessions.creator,'GET','/modules/zhihu/keywords',{projectId:'999',accountId:'10'})).code===40300,'project isolation')
      await ok(sessions.admin,'POST','/core/auth/logout');ensure((await invoke(sessions.admin,'GET','/core/auth/me')).code===40100,'logout')
      state.checks.roles=true
    }else if(state.stage==='operations'){
      const leader=await login('leader'),creator=await login('creator')
      if(!await store.get('keywords','50'))await store.put('keywords','50',{id:'50',...scope,taskId:'20',mappingId:'40',keyword:'acceptance-word',lifecycleStatus:'available',syncStatus:'synced',planStatus:'active'})
      const claimed=await ok(leader,'POST','/modules/zhihu/keywords/50/claim',{...scope,requestKey:'acceptance-claim-001'})
      await ok(leader,'POST','/modules/zhihu/bindings/'+claimed.id+'/assign',{...scope,executorId:'3',requestKey:'acceptance-assign-001'})
      await ok(creator,'POST','/modules/zhihu/bindings/'+claimed.id+'/activate',{...scope,requestKey:'acceptance-activate-001'})
      const data={...scope,bindingId:claimed.id,url:'https://example.com/acceptance',description:'Synthetic acceptance record',requestKey:'acceptance-evidence-001'}
      const evidence=await ok(creator,'POST','/modules/zhihu/evidence',data)
      ensure((await ok(creator,'POST','/modules/zhihu/evidence',data)).id===evidence.id,'evidence replay')
      await ok(leader,'POST','/modules/zhihu/evidence/'+evidence.id+'/review',{...scope,accept:true,reason:'Synthetic check',requestKey:'acceptance-review-001'})
      ensure((await store.get('bindings',claimed.id)).verificationStatus==='passed','review projection')
      await store.put('settings','business-fixture',{bindingId:claimed.id});state.checks.operations=true
    }else if(state.stage==='finance'){
      const finance=await login('finance'),creator=await login('creator'),fixture=await store.get('settings','business-fixture')
      if(!await store.get('facts','acceptance-fact'))await store.put('facts','acceptance-fact',{id:'acceptance-fact',...scope,date:'2026-09-01',keyword:'acceptance-word',orders:'1',bindingId:fixture.bindingId,version:'v1',allocations:[{userId:'3',amount:'10.0000'}]})
      const confirm=await checkpoint('confirm-payload',async()=>{const period={...scope,from:'2026-09-01',to:'2026-09-30',factIds:['acceptance-fact']},report=await ok(finance,'GET','/modules/zhihu/workbench',period);return {...period,reviewHash:report.reviewHash,acknowledged:true,requestKey:'acceptance-confirm-001'}})
      await ok(finance,'POST','/modules/zhihu/workbench/confirm',confirm)
      const funding=await checkpoint('fund-payload',async()=>{const incomeIds=[d.hash(['acceptance-fact','3'])],fund=await ok(finance,'GET','/core/finance/funding-preview',{...scope,incomeIds});return {...scope,incomeIds,hash:fund.hash,reference:'synthetic-no-transfer',requestKey:'acceptance-funding-001'}})
      await ok(finance,'POST','/core/finance/funding',funding);await ok(finance,'POST','/core/finance/funding',funding)
      const withdrawal=await ok(creator,'POST','/core/finance/withdrawals',{...scope,amount:'8',receiverName:'Test',bankName:'Test',bankAccount:'Synthetic',requestKey:'acceptance-withdrawal-001'})
      await ok(finance,'POST','/core/finance/withdrawals/'+withdrawal.id+'/review',{...scope,action:'approve'})
      const wallet=await ok(creator,'GET','/core/finance',{...scope,moduleId:'zhihu'})
      ensure(wallet.balance.available==='2.0000'&&wallet.balance.processing==='8.0000','wallet conservation')
      state.checks.finance=true
    }else if(state.stage==='cleanup'){
      await cleanup(store);state.checks.cleanup=true;state.status='passed';state.finishedAt=d.now()
    }
    if(state.status==='running')state.stage=stages[stages.indexOf(state.stage)+1]
  }catch(error){
    state.failure=require('./migration-diagnostic').diagnostic(error,'business.'+state.stage);state.failedStage=state.stage
    if(error.acceptanceCheck)state.failure.check=error.acceptanceCheck
    if(error.apiDiagnostic)state.failure.apiDiagnostic=error.apiDiagnostic
    // Do not emit user data, tokens or raw error messages. Cleanup is resumable.
    state.status='cleaning';state.stage='cleanup';state.checks.failed=true
  }
  if(state.checks.failed&&state.checks.cleanup)state.status='failed'
  delete state.lease;state.leaseUntil=0;state.checkedAt=d.now()
  await base.transaction(async tx=>{const current=await tx.get('settings',key);if(current?.lease!==lease)d.fail('验收租约已变化',409);await tx.put('settings',key,state)})
  return publicState(state)
}
function publicState(state){return {status:state.status,stage:state.stage,checks:state.checks,failedStage:state.failedStage||null,diagnostic:state.failure||null,checkedAt:state.checkedAt||null,nextAction:['passed','failed'].includes(state.status)?null:'check-business',businessEnabled:false}}
module.exports={run,publicState}
