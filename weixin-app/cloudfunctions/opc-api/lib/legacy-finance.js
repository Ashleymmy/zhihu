const d=require('./domain')
const {assertLegacyRoute}=require('./routing')
const keyPattern=/^[\w.-]{8,128}$/
async function mutate(c,action,payload,work){
  if(!keyPattern.test(String(c.key||'')))d.fail('缺少有效请求键')
  const id=d.hash([c.user.id,'legacy',action,c.key]),digest=d.hash(payload)
  return c.store.transaction(async tx=>{
    await tx.lock('legacy-finance');await tx.lock('engine-gate')
    const live=await tx.get('users',c.user.id)
    if(!live?.isActive||live.role!==c.user.role||live.adminDuty!==c.user.adminDuty||(live.sessionVersion||0)!==(c.user.sessionVersion||0))d.fail('账号权限已变化',401)
    const old=await tx.get('requests',id)
    if(old){if(old.hash!==digest)d.fail('同一请求键不能用于不同内容',409);return old.result}
    const result=await work(tx)
    await tx.put('requests',id,{id,hash:digest,result:result??null,action,userId:c.user.id,createdAt:d.now()})
    await tx.audit(c.user,action,c.params.id||c.user.id);return result
  })
}
async function visible(tx,user,row,field='userId'){
  if(user.role==='admin'||row[field]===user.id)return true
  return user.role==='leader'&&(await tx.get('users',row[field]))?.parentId===user.id
}
async function list(tx,user,name,data={},field='userId'){
  const result=[]
  for(const row of await tx.find(name))if((!data.status||row.status===data.status)&&await visible(tx,user,row,field))result.push(row)
  return result.sort((a,b)=>String(b.createdAt||b.settleDate||'').localeCompare(String(a.createdAt||a.settleDate||'')))
}
const toYuan=v=>{const n=d.cash(String(v),true);if(n%100n)d.fail('历史分金额精度异常',409);return d.money(n/100n)}
async function balance(tx,userId){
  const earnings=await tx.find('legacy_earnings',{userId}),withdrawals=await tx.find('legacy_withdrawals',{userId})
  const confirmed=earnings.filter(e=>e.status==='confirmed').reduce((n,e)=>n+d.cash(String(e.amount),true),0n)
  const reserved=withdrawals.filter(w=>['pending','leader_approved','approved'].includes(w.status)).reduce((n,w)=>n+d.cash(String(w.amount)),0n)
  return {confirmed,reserved,available:confirmed-reserved}
}
function paymentInput(data){
  const amount=String(data.amount)
  if(!/^\d+(\.\d{1,2})?$/.test(amount)||d.cash(amount)<=0n)d.fail('金额必须大于零，最多两位小数（单位分）')
  const settleType=data.settleType||'personal',payMethod=data.payMethod
  if(!['personal','corporate'].includes(settleType)||!['alipay','wechat','bank_transfer'].includes(payMethod))d.fail('收款方式不正确')
  const input={amount:d.money(d.cash(amount)),amountYuan:toYuan(amount),amountUnit:'cent',settleType,payMethod,payAccount:d.text(data.payAccount,'收款账号',128)}
  for(const field of ['companyName','bankName','bankAccount','taxId'])input[field]=settleType==='corporate'?d.text(data[field],field,128):String(data[field]||'').slice(0,128)
  return input
}
async function review(c,type,action){
  d.finance(c.user)
  const table=type==='withdrawal'?'legacy_withdrawals':'legacy_appeals',decision=c.data.action,remark=String(c.data.remark||'').trim().slice(0,512)
  if(action!=='cancel'&&!['approve','reject'].includes(decision))d.fail('审核操作不正确')
  if(action==='review'&&c.user.role!=='leader')d.fail('仅团长可初审',403)
  if(action==='decide')d.duty(c.user,'finance')
  const adjustment=c.data.adjustAmount==null?null:String(c.data.adjustAmount)
  if(adjustment!==null&&(!/^-?\d+$/.test(adjustment)||BigInt(adjustment)<-100000000n||BigInt(adjustment)>100000000n))d.fail('调账金额须为范围内整数分')
  return mutate(c,type+'.'+action,{id:c.params.id,decision,remark,adjustment},async tx=>{
    const row=await tx.get(table,c.params.id);if(!row)d.fail('记录不存在',404)
    if(action==='cancel'){
      if(row.userId!==c.user.id)d.fail('只能撤销自己的申请',403)
      if(row.status!=='pending')d.fail('只有待初审申请可以撤销',409)
      await tx.put(table,row.id,{...row,status:'cancelled'});return {id:row.id}
    }
    if(action==='review'){
      if((await tx.get('users',row.userId))?.parentId!==c.user.id)d.fail('只能初审本团队成员',403)
      if(row.status!=='pending')d.fail('该申请不在待初审状态',409)
      await tx.put(table,row.id,{...row,status:decision==='approve'?'leader_approved':'rejected',leaderId:c.user.id,leaderRemark:remark,leaderHandledAt:d.now()});return {id:row.id}
    }
    if(row.status!=='leader_approved')d.fail('只有初审通过的申请可以终审',409)
    if(type==='withdrawal'&&decision==='approve'&&(await balance(tx,row.userId)).available<0n)d.fail('余额已变化，请先核对收入',409)
    if(type==='appeal'&&decision==='approve'&&adjustment&&BigInt(adjustment)!==0n){
      await assertLegacyRoute(tx,null,null)
      const project=(await tx.find('projects',{slug:'zhihu'}))[0];if(!project)d.fail('缺少知乎项目',409)
      const sourceRef='appeal:'+row.id
      await tx.unique('legacy-earning',[row.userId,sourceRef],row.id)
      await tx.add('legacy_earnings',{userId:row.userId,projectId:project.id,planId:null,settleDate:d.today(),amount:d.money(d.cash(adjustment,true)),amountYuan:toYuan(adjustment),amountUnit:'cent',status:'confirmed',sourceRef})
    }
    await tx.put(table,row.id,{...row,status:decision==='approve'?'approved':'rejected',remark,handledBy:c.user.id,handledAt:d.now(),...(type==='appeal'?{adjustAmount:adjustment}:{})});return {id:row.id}
  })
}
function register(r){
  r('GET','/modules/zhihu/earnings',async c=>{d.finance(c.user);return {...d.page(await list(c.store,c.user,'legacy_earnings',c.data),c.data),amountUnit:'cent',engine:'legacy'}})
  r('GET','/modules/zhihu/earnings/summary',async c=>{
    d.finance(c.user);const rows=await list(c.store,c.user,'legacy_earnings'),withdrawals=await list(c.store,c.user,'legacy_withdrawals'),sum=status=>d.money(rows.filter(e=>e.status===status).reduce((n,e)=>n+d.cash(String(e.amount),true),0n))
    return {pending:sum('pending'),confirmed:sum('confirmed'),paid:sum('paid'),withdrawn:d.money(withdrawals.filter(w=>w.status==='approved').reduce((n,w)=>n+d.cash(String(w.amount)),0n)),amountUnit:'cent',engine:'legacy'}
  })
  r('GET','/modules/zhihu/withdrawals',async c=>{d.finance(c.user);return {...d.page(await list(c.store,c.user,'legacy_withdrawals',c.data),c.data),amountUnit:'cent'}})
  r('POST','/modules/zhihu/withdrawals',async c=>{
    if(!['creator','leader'].includes(c.user.role))d.fail('仅达人或团长可申请提现',403)
    const input=paymentInput(c.data)
    return mutate(c,'legacy.withdrawal.apply',input,async tx=>{
      if(d.cash(input.amount)>(await balance(tx,c.user.id)).available)d.fail('可提现余额不足')
      const previous=await tx.find('legacy_withdrawals',{userId:c.user.id}),riskFlags=[]
      if(previous.filter(w=>Date.parse(w.createdAt)>Date.now()-86400000).length>=2)riskFlags.push('high_freq')
      if(Date.now()-Date.parse(c.user.createdAt)<30*86400000&&d.cash(input.amount)>=1000000000n)riskFlags.push('new_account_large')
      const row=await tx.add('legacy_withdrawals',{...input,userId:c.user.id,status:c.user.role==='leader'?'leader_approved':'pending',leaderId:c.user.role==='leader'?c.user.id:null,riskFlags})
      return {id:row.id,status:row.status,amount:row.amount,amountUnit:'cent'}
    })
  })
  for(const type of ['withdrawal','appeal'])for(const action of ['cancel','review','decide'])r('POST','/modules/zhihu/'+(type==='withdrawal'?'withdrawals':'appeals')+'/:id/'+action,c=>review(c,type,action))
  r('GET','/modules/zhihu/withdrawals/:id/statement',async c=>{
    d.finance(c.user);const row=await c.store.get('legacy_withdrawals',c.params.id)
    if(!row||!await visible(c.store,c.user,row))d.fail('无权查看结算单',403)
    const u=await c.store.get('users',row.userId);return {withdrawal:row,applicant:{id:u.id,displayName:u.displayName,username:u.username},amountUnit:'cent'}
  })
  r('GET','/modules/zhihu/appeals',async c=>{d.finance(c.user);return d.page(await list(c.store,c.user,'legacy_appeals',c.data),c.data)})
  r('POST','/modules/zhihu/appeals',async c=>{
    if(!['leader','creator'].includes(c.user.role))d.fail('仅团长或达人可申诉',403)
    if(!['补款','扣款','结算异议','其他'].includes(c.data.kind))d.fail('申诉类型不正确')
    const input={kind:c.data.kind,title:d.text(c.data.title,'标题',128),content:d.text(c.data.content,'内容',2000),evidence:String(c.data.evidence||'').slice(0,2000)}
    return mutate(c,'legacy.appeal.submit',input,async tx=>{const row=await tx.add('legacy_appeals',{...input,userId:c.user.id,status:'pending'});return {id:row.id}})
  })
}
module.exports={register,mutate,visible,list,balance,toYuan}
