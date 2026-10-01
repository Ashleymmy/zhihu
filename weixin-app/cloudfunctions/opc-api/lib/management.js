const d=require('./domain')
const {projectAccess}=require('./core')
async function managed(tx,u,id){
  const user=await tx.get('users',id)
  if(!user||u.role==='creator'||u.role==='leader'&&user.parentId!==u.id||user.role==='admin'&&(u.role!=='admin'||(u.adminDuty||'all')!=='all'))d.fail('无权操作此成员',403)
  return user
}
function register(r){
  r('PATCH','/core/projects/:id',async c=>{
    d.duty(c.user,'operations')
    return c.store.transaction(async tx=>{
      const project=await projectAccess(tx,c.user,c.params.id),patch={}
      if(c.data.name!==undefined)patch.name=d.text(c.data.name,'项目名称')
      if(c.data.isEnabled!==undefined){if(typeof c.data.isEnabled!=='boolean')d.fail('启用状态不正确');patch.isEnabled=c.data.isEnabled}
      if(!Object.keys(patch).length)d.fail('没有可更新字段')
      await tx.put('projects',project.id,{...project,...patch});await tx.audit(c.user,'project.update',project.id,patch);return {...project,...patch}
    })
  })
  r('DELETE','/core/projects/:id',async c=>{
    d.duty(c.user,'operations')
    return c.store.transaction(async tx=>{const project=await projectAccess(tx,c.user,c.params.id);await tx.put('projects',project.id,{...project,isEnabled:false});await tx.audit(c.user,'project.disable',project.id);return null})
  })
  r('DELETE','/core/projects/:id/integrations/:accountId',async c=>{
    d.duty(c.user,'operations');return c.store.transaction(async tx=>{await projectAccess(tx,c.user,c.params.id);await tx.remove('links',d.hash({projectId:c.params.id,accountId:c.params.accountId}));await tx.audit(c.user,'project.integration.remove',c.params.id);return null})
  })
  r('PATCH','/core/integrations/:id',async c=>{
    d.duty(c.user,'all');if(!['active','disabled'].includes(c.data.status))d.fail('账号状态不正确')
    return c.store.transaction(async tx=>{const row=await tx.get('accounts',c.params.id);if(!row)d.fail('账号不存在',404);await tx.put('accounts',row.id,{...row,status:c.data.status});await tx.audit(c.user,'integration.status',row.id);return null})
  })
  r('PATCH','/core/team/members/:id',async c=>{
    d.operate(c.user);const patch={}
    if(c.data.displayName!==undefined)patch.displayName=d.text(c.data.displayName,'姓名',64)
    if(c.data.phone!==undefined)patch.phone=String(c.data.phone||'').slice(0,20)
    return c.store.transaction(async tx=>{const row=await managed(tx,c.user,c.params.id);await tx.put('users',row.id,{...row,...patch});await tx.audit(c.user,'user.update',row.id,patch);return null})
  })
  r('POST','/core/team/members/:id/disable',async c=>{
    d.operate(c.user);return c.store.transaction(async tx=>{
      await tx.lock('users');const row=await managed(tx,c.user,c.params.id)
      if(row.id===c.user.id)d.fail('不能停用当前登录账号')
      if(row.role==='admin'&&(row.adminDuty||'all')==='all'&&(await tx.find('users',{role:'admin',isActive:true})).filter(u=>(u.adminDuty||'all')==='all').length<=1)d.fail('至少保留一位全量管理员',409)
      await tx.put('users',row.id,{...row,isActive:false,sessionVersion:(row.sessionVersion||0)+1});await tx.audit(c.user,'user.disable',row.id);return null
    })
  })
  r('PATCH','/core/staff/:id',async c=>{
    d.duty(c.user,'all');if(!['all','operations','finance'].includes(c.data.duty))d.fail('职责不正确')
    return c.store.transaction(async tx=>{
      await tx.lock('users');const row=await tx.get('users',c.params.id)
      if(!row||row.role!=='admin')d.fail('员工不存在',404)
      if((row.adminDuty||'all')==='all'&&c.data.duty!=='all'&&(await tx.find('users',{role:'admin',isActive:true})).filter(u=>(u.adminDuty||'all')==='all').length<=1)d.fail('至少保留一位全量管理员',409)
      await tx.put('users',row.id,{...row,adminDuty:c.data.duty,sessionVersion:(row.sessionVersion||0)+1});await tx.audit(c.user,'staff.duty',row.id,{duty:c.data.duty});return null
    })
  })
  r('POST','/core/team/applications/:id/cancel',async c=>{
    if(c.user.role!=='creator')d.fail('仅达人可取消申请',403)
    return c.store.transaction(async tx=>{const a=await tx.get('applications',c.params.id);if(!a||a.creatorId!==c.user.id)d.fail('无权操作',403);if(a.status!=='pending')d.fail('申请已处理',409);await tx.put('applications',a.id,{...a,status:'cancelled',handledAt:d.now()});return null})
  })
  r('GET','/core/admin-tools/announcements',async c=>{d.duty(c.user,'operations');return c.store.find('announcements')})
  r('POST','/core/admin-tools/announcements',async c=>{d.duty(c.user,'operations');return c.store.transaction(async tx=>{const row=await tx.add('announcements',{title:d.text(c.data.title,'公告标题'),content:d.text(c.data.content,'公告内容',2000),published:true,createdBy:c.user.id});await tx.audit(c.user,'announcement.create',row.id);return {id:row.id}})})
  r('GET','/core/audit-logs/actions',async c=>{d.duty(c.user,'all');return [...new Set((await c.store.find('audit')).map(a=>a.action))].map(action=>({action}))})
  const types=['salt_pick','comment_watch','risk_report','media','tag','product','asset']
  r('GET','/modules/zhihu/story-items',async c=>{
    d.operate(c.user);if(!types.includes(c.data.type))d.fail('内容类型不正确')
    const rows=await c.store.find('story',{type:c.data.type}),children=c.user.role==='leader'?await c.store.find('users',{parentId:c.user.id}):[]
    return rows.filter(row=>(c.data.includeArchived==='true'||row.status==='active')&&(c.user.role==='admin'||row.ownerId===c.user.id||children.some(u=>u.id===row.ownerId)))
  })
  r('POST','/modules/zhihu/story-items',async c=>{
    d.operate(c.user);if(!types.includes(c.data.type))d.fail('内容类型不正确')
    const item=await c.store.add('story',{type:c.data.type,title:d.text(c.data.title,'标题',255),url:c.data.url?d.url(c.data.url):null,note:String(c.data.note||'').slice(0,500),ownerId:c.user.id,ownerName:c.user.displayName,status:'active'});return {id:item.id}
  })
  for(const method of ['PATCH','DELETE'])r(method,'/modules/zhihu/story-items/:id',async c=>{
    d.operate(c.user);return c.store.transaction(async tx=>{
      const row=await tx.get('story',c.params.id)
      if(!row||c.user.role!=='admin'&&row.ownerId!==c.user.id)d.fail('无权修改此内容',403)
      const patch={}
      if(method==='DELETE')patch.status='archived'
      else{
        if(c.data.title!==undefined)patch.title=d.text(c.data.title,'标题',255)
        if(c.data.url!==undefined)patch.url=c.data.url?d.url(c.data.url):null
        if(c.data.note!==undefined)patch.note=String(c.data.note||'').slice(0,500)
        if(c.data.status!==undefined){if(!['active','archived'].includes(c.data.status))d.fail('状态不正确');patch.status=c.data.status}
      }
      await tx.put('story',row.id,{...row,...patch});await tx.audit(c.user,'story.update',row.id);return null
    })
  })
}
module.exports={register}
