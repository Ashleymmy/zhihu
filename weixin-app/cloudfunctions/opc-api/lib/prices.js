const d=require('./domain')
const {authorize}=require('./store')
function covers(upper,start,end,price){
  let cursor=start
  for(const p of upper.slice().sort((a,b)=>a.startDay.localeCompare(b.startDay))){const to=p.endDay||'9999-12-31';if(to<=cursor)continue;if(p.startDay>cursor||d.cash(p.price)<price)return false;cursor=to;if(cursor>=(end||'9999-12-31'))return true}
  return false
}
function register(r){
  r('GET','/modules/zhihu/price-agreements',async c=>{
    const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const rows=await c.store.find('prices',scope);return d.page(rows.filter(p=>c.user.role==='admin'||p.payeeId===c.user.id||p.payerId===c.user.id||String(p.payeeId).startsWith('role:')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),c.data)
  })
  r('POST','/modules/zhihu/price-agreements',async c=>{
    d.operate(c.user);if(c.user.role==='creator')d.fail('无定价权限',403)
    const scope=d.scopeOf(c.data)
    // 角色全局价：payeeRole=creator/leader 时 payeeId 记为 role:creator / role:leader，
    // 结算时作为该角色的兜底单价（个人定价优先，见 imports.js quote()）。
    const payeeRole=typeof c.data.payeeRole==='string'?c.data.payeeRole:''
    let payeeId
    if(payeeRole){
      if(!['creator','leader'].includes(payeeRole))d.fail('角色分组不正确')
      payeeId='role:'+payeeRole
    }else payeeId=d.id(c.data.payeeId)
    const input={...scope,taskId:d.id(c.data.taskId),payeeId,...(payeeRole?{payeeRole}:{}),price:d.money(d.cash(c.data.unitPrice)),startDay:d.day(c.data.from),endDay:c.data.to?d.day(c.data.to):null,reason:d.text(c.data.reason,'原因',500)}
    if(input.endDay&&input.endDay<=input.startDay)d.fail('有效期不正确')
    return c.store.mutate(c.user,scope,'price.draft',c.key,input,async tx=>{
      await authorize(tx,c.user,scope);const task=await tx.get('tasks',input.taskId)
      if(task?.projectId!==scope.projectId)d.fail('任务不可用')
      let relationType=''
      if(payeeRole){
        if(c.user.role==='admin')relationType=payeeRole==='leader'?'agency_leader':'agency_creator'
        else if(payeeRole==='creator')relationType='leader_creator'
        if(!relationType)d.fail('不允许设置该角色分组的价格',403)
      }else{
        const payee=await tx.get('users',input.payeeId)
        if(!payee?.isActive||!await tx.get('members',d.hash([scope.projectId,input.payeeId])))d.fail('成员不可用')
        if(c.user.role==='admin')relationType=payee.role==='leader'?'agency_leader':payee.role==='creator'&&!payee.parentId?'agency_creator':''
        else if(payee.role==='creator'&&payee.parentId===c.user.id)relationType='leader_creator'
        if(!relationType)d.fail('不允许向该成员报价',403)
      }
      const id=d.uid(),row={...input,id,versionId:id,relationType,payerKind:c.user.role==='admin'?'agency':'user',payerId:c.user.role==='admin'?'1':c.user.id,priceStatus:'draft',createdAt:d.now(),createdBy:c.user.id}
      await tx.put('prices',id,row);return {id}
    })
  })
  r('POST','/modules/zhihu/price-versions/:id/publish',async c=>{
    d.operate(c.user);const scope=d.scopeOf(c.data)
    return c.store.mutate(c.user,scope,'price.publish',c.key,{id:c.params.id},async tx=>{
      await authorize(tx,c.user,scope);const row=d.belongs(await tx.get('prices',c.params.id),scope)
      if(row.payerKind==='agency'?c.user.role!=='admin':row.payerId!==c.user.id)d.fail('仅付款方可发布',403)
      if(row.priceStatus==='published')return {id:row.id}
      const isRoleRow=String(row.payeeId).startsWith('role:')
      if(!isRoleRow){
        const payee=await tx.get('users',row.payeeId)
        if(!payee?.isActive||!await tx.get('members',d.hash([scope.projectId,row.payeeId]))||row.relationType==='leader_creator'&&payee.parentId!==row.payerId||row.relationType==='agency_creator'&&payee.parentId)d.fail('成员关系已变化',409)
      }
      const all=await tx.find('prices',{...scope,taskId:row.taskId,priceStatus:'published'})
      for(const p of all)if(p.relationType===row.relationType&&p.payerId===row.payerId&&p.payeeId===row.payeeId&&p.startDay<(row.endDay||'9999-12-31')&&(p.endDay||'9999-12-31')>row.startDay){
        if(row.startDay<=d.today()||p.startDay>=row.startDay)d.fail('价格生效区间冲突',409)
        p.endDay=row.startDay;await tx.put('prices',p.id,p)
      }
      all.push({...row,priceStatus:'published'})
      // leader_creator（含角色全局价）必须由 agency_leader 覆盖；团长的兜底价可用「全部团长」全局价覆盖
      for(const p of all.filter(x=>x.relationType==='leader_creator'))if(!covers(all.filter(x=>x.relationType==='agency_leader'&&(x.payeeId===p.payerId||x.payeeId==='role:leader')),p.startDay,p.endDay,d.cash(p.price)))d.fail('团队价格超过平台进价，或有效期未覆盖',409)
      await tx.put('prices',row.id,{...row,priceStatus:'published',publishedAt:d.now()});return {id:row.id}
    })
  })
}
module.exports={register,covers}
