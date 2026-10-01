const d=require('./domain')
const {collections,authorize}=require('./store')
const {mutate}=require('./legacy-finance')
function register(r){
  r('DELETE','/core/team/members/:id',async c=>{
    d.operate(c.user);if(c.user.role==='creator')d.fail('无成员管理权限',403)
    return mutate(c,'user.delete',{id:c.params.id},async tx=>{
      await tx.lock('users');const row=await tx.get('users',c.params.id)
      if(!row||row.role==='admin'||row.id===c.user.id||c.user.role==='leader'&&row.parentId!==c.user.id)d.fail('无权删除此成员',403)
      const checks=[['users','parentId'],['mcn','ownerUserId'],['members','userId'],['legacy_plans','ownerId'],['legacy_compositions','ownerId'],['legacy_metrics','ownerId'],['legacy_earnings','userId'],['legacy_withdrawals','userId'],['legacy_appeals','userId'],['bindings','leaderId'],['bindings','executorId'],['income','userId'],['withdrawals','userId'],['prices','payerId'],['prices','payeeId'],['story','ownerId']]
      for(const [name,field]of checks)if((await tx.find(name,{[field]:row.id})).length)d.fail('该成员有关联业务记录，请使用停用账号',409)
      for(const a of await tx.find('applications'))if(a.creatorId===row.id||a.leaderId===row.id)await tx.remove('applications',a.id)
      await tx.remove('users',row.id);await tx.remove('keys',d.hash(['username',row.username.toLowerCase()]));return {id:row.id}
    })
  })
  r('GET','/core/modules',async()=>[{id:'zhihu',name:'知乎',version:'1.0.0',contractVersion:1,roles:['admin','leader','creator'],entryPath:'/modules/zhihu',accountCreation:'managed'}])
  r('POST','/core/integrations',async c=>{d.duty(c.user,'all');d.fail('知乎接入账号由部署流程配置，不支持前端创建',422)})
  r('GET','/core/modules/:moduleId/summary',async c=>{
    if(c.params.moduleId!=='zhihu')d.fail('模块不可用',404);const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const from=d.day(c.data.from),to=d.day(c.data.to);if(from>to)d.fail('日期范围不正确')
    const report=await require('./finance').view(c.store,c.user,scope,{from,to})
    return {...scope,from,to,moduleId:'zhihu',status:'ready',updatedAt:d.now(),metrics:[{key:'orders',label:'订单',value:report.summary.orders},{key:'receivable',label:'应收',value:report.summary.receivable,unit:'元'}]}
  })
  r('GET','/core/finance/payment-sheet',async c=>{
    d.duty(c.user,'finance');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const rows=await c.store.find('withdrawals',{...scope,status:'approved'})
    return {rows,amount:d.money(rows.reduce((n,w)=>n+d.cash(w.amount),0n)),amountUnit:'yuan',generatedAt:d.now()}
  })
  r('GET','/core/announcements/active',c=>c.store.find('announcements',{published:true}))
  // 首页工作台摘要：今日预估（本人口径；管理员为应付口径）、进行中关键词、待审核作品数。
  // 全部角色只统计自己有归属的记录，与关键词/作品列表页的可见范围一致。
  r('GET','/modules/zhihu/home-summary',async c=>{
    const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const today=d.today()
    const [words,evidence,bindings]=await Promise.all([c.store.find('keywords',scope),c.store.find('evidence',scope),c.store.find('bindings',scope)])
    const bmap=new Map(bindings.map(b=>[b.id,b]))
    const admin=c.user.role==='admin'
    const owns=word=>{if(admin)return true;const b=word.bindingId?bmap.get(word.bindingId):null;return !!b&&(b.leaderId===c.user.id||b.executorId===c.user.id)}
    const visible=e=>{if(admin)return true;const b=bmap.get(e.bindingId);if(!b)return false;if(c.user.role==='leader')return b.leaderId===c.user.id&&b.executorId!==c.user.id;return e.submittedBy===c.user.id}
    const activeKeywords=words.filter(w=>owns(w)&&['assigned','reserved','active'].includes(w.lifecycleStatus)).length
    const pendingReviews=evidence.filter(e=>e.status==='pending'&&visible(e)).length
    const report=await require('./finance').view(c.store,c.user,scope,{from:today,to:today})
    return {today,activeKeywords,pendingReviews,todayReceivable:report.summary.receivable,todayPayable:report.summary.payable,todayOrders:report.summary.orders}
  })
  r('POST','/core/announcements',async c=>{
    d.duty(c.user,'operations');const input={title:d.text(c.data.title,'标题',128),content:d.text(c.data.content,'正文',2000)}
    return mutate(c,'announcement.create',input,async tx=>tx.add('announcements',{...input,published:true,status:'published',createdBy:c.user.id}))
  })
  r('POST','/core/announcements/:id/status',async c=>{
    d.duty(c.user,'operations');if(!['published','offline'].includes(c.data.status))d.fail('公告状态不正确')
    return mutate(c,'announcement.status',{id:c.params.id,status:c.data.status},async tx=>{const row=await tx.get('announcements',c.params.id);if(!row)d.fail('公告不存在',404);await tx.put('announcements',row.id,{...row,status:c.data.status,published:c.data.status==='published',updatedAt:d.now()});return {id:row.id}})
  })
  r('GET','/core/admin-tools/monitor',async c=>{
    d.duty(c.user,'all');const users=await c.store.find('users'),audit=await c.store.find('audit')
    return users.map(u=>{const rows=audit.filter(a=>a.userId===u.id&&Date.parse(a.createdAt)>Date.now()-7*86400000).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return {...d.safeUser(u),actionCount7d:rows.length,lastAction:rows[0]?.action||null,lastActionAt:rows[0]?.createdAt||null,lastLoginAt:rows.find(a=>a.action==='auth.login')?.createdAt||null}})
  })
  r('GET','/core/admin-tools/db-stats',async c=>{
    d.duty(c.user,'all');const result=[];for(const name of collections){const count=await c.store.col(name).count();result.push({tableName:'opc_'+name,tableRows:count.total,dataMb:null})}return result
  })
  r('POST','/core/admin-tools/audit-cleanup',async c=>{
    d.duty(c.user,'all');const days=Number(c.data.days);if(!Number.isInteger(days)||days<7||days>365)d.fail('保留天数须为 7 至 365 天')
    const cutoff=new Date(Date.now()-days*86400000).toISOString(),cursor=c.data.cursor||null
    if(cursor!==null&&(typeof cursor!=='string'||cursor.length>128))d.fail('清理游标不正确')
    const page=await c.store.scan('audit',{createdAt:c.store.db.command.lt(cutoff)},{after:cursor,limit:25})
    return mutate(c,'audit.cleanup',{days,cursor},async tx=>{
      let deleted=0
      for(const candidate of page.rows){const row=await tx.get('audit',candidate.id);if(row&&row.createdAt<cutoff&&!/finance|withdraw|payment|appeal|engine|migration|statement|income|earning|fund|relay|settle|legacy|invoice|proof|price|bill/i.test(row.action)){await tx.remove('audit',row.id);deleted++}}
      return {deleted,batchLimit:25,financialAuditRetained:true,nextCursor:page.cursor}
    })
  })
  const info=async c=>{d.duty(c.user,'operations');return {name:'OPC',runtime:'wechat-cloud',node:process.version,uptimeSec:Math.floor(process.uptime()),environment:c.environment}}
  r('GET','/core/admin-tools/site-info',info);r('GET','/modules/zhihu/admin-tools/site-info',info)
  r('GET','/core/mcn-accounts',async c=>{d.duty(c.user,'operations');return c.store.find('mcn')})
  r('POST','/core/mcn-accounts',async c=>{
    d.duty(c.user,'operations');const accountKey=d.text(c.data.accountKey,'账户标识',64),accountName=d.text(c.data.accountName,'账户名称',128),ownerUserId=c.data.ownerUserId?d.id(c.data.ownerUserId):c.user.id
    if(!/^[A-Za-z0-9_-]+$/.test(accountKey))d.fail('账户标识格式不正确')
    return mutate(c,'mcn.create',{accountKey,accountName,ownerUserId},async tx=>{const owner=await tx.get('users',ownerUserId);if(!owner?.isActive)d.fail('负责人不可用');const id=d.uid();await tx.unique('mcn-account',accountKey,id);const row={id,accountKey,accountName,ownerUserId,status:'active',createdAt:d.now()};await tx.put('mcn',id,row);return row})
  })
  r('GET','/modules/zhihu/tasks/:id',async c=>{const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);const row=await c.store.get('tasks',c.params.id);if(!row||row.projectId!==scope.projectId||row.accountId&&row.accountId!==scope.accountId)d.fail('任务不存在',404);return row})
  r('PATCH','/modules/zhihu/channels/:id/owner',async c=>{
    d.duty(c.user,'operations');const scope=d.scopeOf(c.data),ownerId=c.data.ownerId===null?null:d.id(c.data.ownerId)
    return c.store.mutate(c.user,scope,'channel.owner',c.key,{id:c.params.id,ownerId},async tx=>{
      const row=await tx.get('channels',c.params.id);if(!row||row.projectId!==scope.projectId||row.accountId&&row.accountId!==scope.accountId)d.fail('渠道不存在',404)
      if(ownerId){const user=await tx.get('users',ownerId);if(!user?.isActive||!await tx.get('members',d.hash([scope.projectId,ownerId])))d.fail('负责人不是有效项目成员')}
      await tx.put('channels',row.id,{...row,ownerId});return {id:row.id}
    })
  })
}
module.exports={register}
