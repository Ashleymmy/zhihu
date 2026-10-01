const d=require('./domain')
const {authorize}=require('./store')
const accounting=require('./accounting')
const {assertNewRoute}=require('./routing')
function inputPeriod(data){const from=d.day(data.from),to=d.day(data.to);if(from>to)d.fail('开始日期不能晚于结束日期');return {from,to}}
function selected(value,limit,label){
  if(value===undefined)return null
  if(!Array.isArray(value)||!value.length||value.length>limit||value.some(id=>typeof id!=='string'||!id||id.length>128)||new Set(value).size!==value.length)d.fail(label+'请选择 1 至 '+limit+' 条不同记录',422)
  return value.slice().sort()
}
async function view(store,user,scope,period,factIds=null){
  const all=factIds?await Promise.all(factIds.map(async id=>{const row=d.belongs(await store.get('facts',id),scope);if(row.date<period.from||row.date>period.to)d.fail('来源不属于当前日期范围',409);return row})):await store.find('facts',{...scope,date:store.db.command.gte(period.from).and(store.db.command.lte(period.to))})
  const entries=[],tokens=[];let orders=0n,records=0,issues=0
  const users=new Map()
  const getUser=async id=>{if(!users.has(id))users.set(id,await store.get('users',id));return users.get(id)}
  for(const fact of all){
    const binding=fact.bindingId?await store.get('bindings',fact.bindingId):null
    if(user.role!=='admin'&&(!binding||binding.leaderId!==user.id&&binding.executorId!==user.id))continue
    records++;orders+=BigInt(fact.orders||'0')
    const blocked=fact.pendingRevision?'待财务核对报表更正':fact.error || (!binding||binding.verificationStatus!=='passed'?'待审核作品':'')
    if(blocked)issues++
    tokens.push([fact.id,fact.version,binding?.verificationStatus||'',fact.pendingRevision||null,fact.allocations,fact.error||null])
    for(const allocation of fact.allocations||[]){
      if(user.role==='creator'&&allocation.userId!==user.id)continue
      const payee=await getUser(allocation.userId),income=await store.get('income',d.hash([fact.id,allocation.userId]))
      const confirmed=income&&income.version===fact.version&&!blocked
      const before=income?income.amount:'0'
      entries.push({id:fact.id+'-'+allocation.userId,factId:fact.id,keyword:fact.keyword,date:fact.date,orders:fact.orders,payeeId:allocation.userId,payeeName:payee?.displayName||'成员',parentId:payee?.parentId||null,payerName:'平台',role:payee?.role||'',amount:allocation.amount,confirmedAmount:d.money(d.cash(before,true)),pendingAmount:d.money(d.cash(allocation.amount,true)-d.cash(before,true)),status:confirmed?'confirmed':'draft',ownReceivable:allocation.userId===user.id,ownPayable:user.role==='admin',blocked,ready:user.role==='admin'&&!blocked&&!confirmed})
    }
  }
  const sum=(filter,field='amount')=>d.money(entries.filter(filter).reduce((n,e)=>n+d.cash(e[field],true),0n))
  const grouping=new Map()
  for(const e of entries){const id=user.role==='admin'&&e.role==='creator'&&e.parentId?e.parentId:e.payeeId;const list=grouping.get(id)||[];list.push(e);grouping.set(id,list)}
  const groups=[]
  for(const [id,list] of grouping){const u=await getUser(id);groups.push({payeeId:id,name:u?.displayName||'成员',confirmed:d.money(list.reduce((n,e)=>n+d.cash(e.confirmedAmount,true),0n)),pending:d.money(list.reduce((n,e)=>n+d.cash(e.pendingAmount,true),0n)),total:d.money(list.reduce((n,e)=>n+d.cash(e.amount,true),0n)),blockers:[...new Set(list.map(e=>e.blocked).filter(Boolean))],ready:list.filter(e=>e.ready).length})}
  return {period,entries,groups,reviewHash:d.hash([scope,period,tokens]),needsReview:false,summary:{records,orders:String(orders),issues,receivable:sum(e=>e.ownReceivable),confirmedReceivable:sum(e=>e.ownReceivable,'confirmedAmount'),pendingReceivable:sum(e=>e.ownReceivable,'pendingAmount'),payable:sum(()=>true),confirmedPayable:sum(()=>true,'confirmedAmount'),pendingPayable:sum(()=>true,'pendingAmount'),retained:sum(e=>e.ownReceivable)},withdrawal:{enabled:true,message:'已确认并开放后可申请提现'}}
}
async function balance(tx,userId,scope){
  const rows=await tx.find('income',{...scope,userId}),withdrawals=await tx.find('withdrawals',{...scope,userId})
  let confirmed=0n,held=0n,available=0n,paid=0n,processing=0n
  for(const row of rows){
    confirmed+=d.cash(row.amount,true)
    const valid=await accounting.eligible(tx,row)
    // A block can freeze positive proceeds, but never erase an available debit.
    for(const entry of await accounting.movements(tx,row)){
      const value=d.cash(entry.amount,true)
      if(entry.bucket==='available'&&(valid||value<0n))available+=value;else held+=value
    }
  }
  for(const w of withdrawals){if(w.status==='paid')paid+=d.cash(w.amount);if(['pending','approved'].includes(w.status))processing+=d.cash(w.amount)}
  available-=paid+processing
  return {confirmed:d.money(confirmed),held:d.money(held),available:d.money(available>0n?available:0n),offset:d.money(available<0n?-available:0n),paid:d.money(paid),processing:d.money(processing)}
}
async function funding(tx,scope,incomeIds=null){
  const result=[]
  const rows=incomeIds?await Promise.all(incomeIds.map(async id=>d.belongs(await tx.get('income',id),scope))):await tx.find('income',{...scope,availability:'held'})
  for(const row of rows){
    const totals=await accounting.totals(tx,row)
    if(row.availability==='held'&&totals.held>0n&&await accounting.eligible(tx,row))result.push({...row,releaseAmount:d.money(totals.held)})
    else if(incomeIds)d.fail('选中款项已变化或暂不可开放，请重新核对',409)
  }
  return {rows:result,amount:d.money(result.reduce((n,r)=>n+d.cash(r.releaseAmount),0n)),hash:d.hash(result.map(r=>[r.id,r.releaseAmount,r.version]))}
}
function register(r){
  r('GET','/modules/zhihu/workbench',async c=>{d.finance(c.user);const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);return view(c.store,c.user,scope,inputPeriod(c.data),selected(c.data.factIds,1,'财务确认'))})
  r('POST','/modules/zhihu/workbench/confirm',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data),period=inputPeriod(c.data),factIds=selected(c.data.factIds,1,'财务确认')
    if(c.data.acknowledged!==true)d.fail('请确认已核对账单')
    return c.store.mutate(c.user,scope,'finance.confirm',c.key,{period,reviewHash:c.data.reviewHash,...(factIds?{factIds}:{})},async tx=>{
      await authorize(tx,c.user,scope);const report=await view(tx,c.user,scope,period,factIds)
      if(report.reviewHash!==c.data.reviewHash)d.fail('数据已变化，请重新核对',409)
      const ready=[...new Set(report.entries.filter(e=>e.ready).map(e=>e.factId))]
      if(ready.length>20)d.fail('一次最多确认 20 条来源记录，请缩小日期范围',413)
      for(const id of ready){
        const fact=await tx.get('facts',id)
        await assertNewRoute(tx,scope,fact.date,true)
        await require('./statements').central(tx,c.user,scope,fact)
        await accounting.confirm(tx,scope,fact,c.user.id)
      }
      return {confirmed:ready.length,waiting:new Set(report.entries.filter(e=>e.status==='draft'&&!e.ready).map(e=>e.factId)).size}
    })
  })
  r('GET','/core/finance',async c=>{
    d.finance(c.user);const scope=d.scopeOf(c.data);if(c.data.moduleId!=='zhihu')d.fail('业务模块不正确');await authorize(c.store,c.user,scope)
    const rows=await c.store.find('withdrawals',{...scope,...(c.user.role==='admin'?{}:{userId:c.user.id})}),result=d.page(rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),{page:c.data.page,pageSize:25}),fund=c.user.role==='admin'?await funding(c.store,scope):{amount:'0.0000',hash:d.hash([])}
    return {balance:c.user.role==='admin'?null:await balance(c.store,c.user.id,scope),withdrawals:result.list,total:result.total,page:result.page,funding:{amount:fund.amount,hash:fund.hash},canManage:c.user.role==='admin'}
  })
  r('POST','/core/finance/funding',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data),reference=d.text(c.data.reference,'到账核对说明',255),incomeIds=selected(c.data.incomeIds,3,'资金开放')
    const execute=async tx=>{
      await tx.lock(['scope',scope]);await authorize(tx,c.user,scope);const fund=await funding(tx,scope,incomeIds)
      if(fund.hash!==c.data.hash)d.fail('金额已变化，请刷新核对',409)
      if(!fund.rows.length)d.fail('没有待开放款项')
      if(fund.rows.length>50)d.fail('待开放款项超过单事务范围，请按批次处理',413)
      for(const row of fund.rows){const fact=await tx.get('facts',row.factId);await assertNewRoute(tx,scope,fact.date,true);const {releaseAmount,...income}=row;await accounting.release(tx,income,c.user.id,reference)}
      await tx.audit(c.user,'finance.release',scope.projectId,{amount:fund.amount,reference});return {amount:fund.amount}
    }
    return incomeIds?c.store.mutate(c.user,scope,'finance.funding',c.key,{incomeIds,hash:c.data.hash,reference},execute):c.store.transaction(execute)
  })
  r('GET','/core/finance/funding-preview',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const incomeIds=selected(c.data.incomeIds,3,'资金开放')
    if(incomeIds){const fund=await funding(c.store,scope,incomeIds);return {...fund,rows:fund.rows.map(row=>({id:row.id,userId:row.userId,factId:row.factId,releaseAmount:row.releaseAmount})),nextCursor:null}}
    const page=await c.store.scan('income',{...scope,availability:'held'},{after:c.data.cursor,limit:20}),rows=[]
    for(const row of page.rows){const totals=await accounting.totals(c.store,row);if(totals.held>0n&&await accounting.eligible(c.store,row))rows.push({id:row.id,userId:row.userId,factId:row.factId,releaseAmount:d.money(totals.held)})}
    return {rows,nextCursor:page.cursor,selectionRequired:true,maxSelection:3}
  })
  r('POST','/core/finance/withdrawals',async c=>{
    if(!['leader','creator'].includes(c.user.role))d.fail('仅团长或达人可提现',403)
    const scope=d.scopeOf(c.data),amount=String(c.data.amount)
    if(!/^\d{1,16}(\.\d{1,2})?$/.test(amount)||d.cash(amount)<=0n)d.fail('金额须大于零，最多两位小数')
    const input={...scope,moduleId:'zhihu',amount:d.money(d.cash(amount)),receiverName:d.text(c.data.receiverName,'收款人'),bankName:d.text(c.data.bankName,'收款银行'),bankAccount:d.text(c.data.bankAccount,'收款账号')}
    return c.store.mutate(c.user,scope,'withdrawal.apply',c.key,input,async tx=>{
      await authorize(tx,c.user,scope);const funds=await balance(tx,c.user.id,scope);if(d.cash(input.amount)>d.cash(funds.available))d.fail('可提现余额不足')
      const row=await tx.add('withdrawals',{...input,userId:c.user.id,displayName:c.user.displayName,status:'pending',remark:null});return {id:row.id}
    })
  })
  r('POST','/core/finance/withdrawals/:id/review',async c=>{
    const scope=d.scopeOf(c.data),action=c.data.action,reason=String(c.data.reason||'').trim().slice(0,500)
    if(!['approve','reject','cancel'].includes(action))d.fail('操作不正确')
    if(action!=='cancel')d.duty(c.user,'finance');if(action==='reject'&&!reason)d.fail('请填写退回原因')
    return c.store.transaction(async tx=>{
      await tx.lock(['scope',scope]);await authorize(tx,c.user,scope);const w=d.belongs(await tx.get('withdrawals',c.params.id),scope),status={approve:'approved',reject:'rejected',cancel:'cancelled'}[action]
      if(action==='cancel'&&w.userId!==c.user.id)d.fail('只能撤回本人的申请',403)
      if(w.status===status)return {id:w.id};if(w.status!=='pending')d.fail('提现状态已变化',409)
      if(action==='approve'&&d.cash((await balance(tx,w.userId,scope)).offset)>0n)d.fail('收入已变化，请重新核对',409)
      await tx.put('withdrawals',w.id,{...w,status,remark:reason,reviewedAt:d.now(),reviewedBy:c.user.id});await tx.audit(c.user,'withdrawal.'+action,w.id,{reason});return {id:w.id}
    })
  })
}
module.exports={register,view,balance,funding}
