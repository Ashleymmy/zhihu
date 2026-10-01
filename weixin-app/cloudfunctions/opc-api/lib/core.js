const crypto = require('node:crypto')
const bcrypt = require('bcryptjs')
const d = require('./domain')
const {authorize} = require('./store')
const memberKey=(projectId,userId)=>d.hash([projectId,userId])
async function projectAccess(tx,u,id) {
  const project=await tx.get('projects',id);if(!project) d.fail('项目不存在',404)
  if(u.role!=='admin'&&!await tx.get('members',memberKey(id,u.id)))d.fail('无项目权限',403)
  return project
}
async function createUser(store,u,data,staff=false) {
  if(staff)d.duty(u,'all');else {d.operate(u);if(u.role==='creator')d.fail('无成员管理权限',403)}
  const username=d.text(data.username,'账号',64),displayName=d.text(data.displayName,'姓名',64)
  const role=staff?'admin':u.role==='leader'?'creator':data.role || 'creator'
  if(!['creator','leader','admin'].includes(role)||!staff&&role==='admin')d.fail('角色不正确')
  const password=crypto.randomBytes(12).toString('base64url'),passwordHash=await bcrypt.hash(password,12)
  return store.transaction(async tx=>{
    await tx.lock('users')
    let parentId=u.role==='leader'?u.id:role==='creator'&&data.parentId?d.id(data.parentId):null
    if(parentId){const parent=await tx.get('users',parentId);if(!parent?.isActive||parent.role!=='leader')d.fail('团长不可用')}
    const user={id:d.uid(),username,displayName,role,parentId,phone:String(data.phone||''),passwordHash,isActive:true,mustChangePwd:true,sessionVersion:0,adminDuty:staff?data.duty:'all',createdAt:d.now()}
    if(staff&&!['operations','finance'].includes(user.adminDuty))d.fail('员工职责不正确')
    await tx.unique('username',username.toLowerCase(),user.id);await tx.put('users',user.id,user)
    await tx.audit(u,'user.create',user.id,{role})
    return {id:user.id,username,temporaryPassword:password,mustChangePwd:true}
  })
}
function register(r) {
  r('GET','/core/projects',async c=>{
    const all=await c.store.find('projects');if(c.user.role==='admin')return all
    const members=await c.store.find('members',{userId:c.user.id});return all.filter(p=>members.some(m=>m.projectId===p.id))
  })
  r('POST','/core/projects',async c=>{
    d.duty(c.user,'operations');const name=d.text(c.data.name,'项目名'),slug=d.text(c.data.slug,'项目标识',64)
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))d.fail('项目标识不正确')
    return c.store.transaction(async tx=>{const row={id:d.uid(),name,slug,isEnabled:true,createdAt:d.now()};await tx.unique('project-slug',slug,row.id);await tx.put('projects',row.id,row);await tx.audit(c.user,'project.create',row.id);return row})
  })
  r('GET','/core/projects/:id/members',async c=>{await projectAccess(c.store,c.user,c.params.id);const rows=await c.store.find('members',{projectId:c.params.id});return Promise.all(rows.map(async m=>{const u=await c.store.get('users',m.userId);return {...m,displayName:u?.displayName,username:u?.username}}))})
  r('POST','/core/projects/:id/members',async c=>{
    d.duty(c.user,'operations');const userId=d.id(c.data.userId),memberRole=c.data.memberRole||'member'
    if(!['owner','admin','member','viewer'].includes(memberRole))d.fail('项目角色不正确')
    return c.store.transaction(async tx=>{await projectAccess(tx,c.user,c.params.id);const user=await tx.get('users',userId);if(!user?.isActive)d.fail('用户不可用');const key=memberKey(c.params.id,userId);if(await tx.get('members',key))d.fail('用户已加入项目',409);const row={projectId:c.params.id,userId,memberRole,joinedAt:d.now()};await tx.put('members',key,row);await tx.audit(c.user,'project.member.add',c.params.id,{userId});return row})
  })
  r('DELETE','/core/projects/:id/members/:userId',async c=>{d.duty(c.user,'operations');return c.store.transaction(async tx=>{await projectAccess(tx,c.user,c.params.id);await tx.remove('members',memberKey(c.params.id,c.params.userId));await tx.audit(c.user,'project.member.remove',c.params.id,{userId:c.params.userId});return null})})
  r('GET','/core/integrations',async c=>{
    const accounts=await c.store.find('accounts')
    if(c.user.role==='admin')return accounts
    const members=await c.store.find('members',{userId:c.user.id}),ids=new Set()
    for(const m of members)for(const link of await c.store.find('links',{projectId:m.projectId}))ids.add(link.accountId)
    return accounts.filter(a=>ids.has(a.id))
  })
  r('GET','/core/projects/:id/integrations',async c=>{await projectAccess(c.store,c.user,c.params.id);const links=await c.store.find('links',{projectId:c.params.id});return (await Promise.all(links.map(l=>c.store.get('accounts',l.accountId)))).filter(Boolean)})
  r('POST','/core/projects/:id/integrations',async c=>{
    d.duty(c.user,'operations');return c.store.transaction(async tx=>{await projectAccess(tx,c.user,c.params.id);const accountId=d.id(c.data.accountId),account=await tx.get('accounts',accountId);if(!account||account.status!=='active')d.fail('账号不可用');const scope={projectId:c.params.id,accountId};await tx.put('links',d.hash(scope),scope);await tx.audit(c.user,'project.integration.link',c.params.id,{accountId});return null})
  })
  r('GET','/core/team/members',async c=>{d.operate(c.user);if(c.user.role==='creator')d.fail('无团队管理权限',403);const users=c.user.role==='admin'?await c.store.find('users'):await c.store.find('users',{parentId:c.user.id});if(c.user.role==='leader')users.unshift(c.user);return users.map(d.safeUser)})
  r('POST','/core/team/members',c=>createUser(c.store,c.user,c.data))
  r('GET','/core/staff',async c=>{d.duty(c.user,'all');return (await c.store.find('users',{role:'admin'})).map(d.safeUser)})
  r('POST','/core/staff',c=>createUser(c.store,c.user,c.data,true))
  r('POST','/core/team/members/:id/reset-password',async c=>{
    d.operate(c.user);if(c.user.role==='creator')d.fail('无权限',403)
    const password=c.data.password?d.text(c.data.password,'密码',128):crypto.randomBytes(12).toString('base64url');if(password.length<8)d.fail('密码至少 8 位')
    const passwordHash=await bcrypt.hash(password,12)
    return c.store.transaction(async tx=>{const user=await tx.get('users',c.params.id);if(!user||c.user.role==='leader'&&user.parentId!==c.user.id||user.role==='admin'&&(c.user.adminDuty||'all')!=='all')d.fail('无权操作此账号',403);await tx.put('users',user.id,{...user,passwordHash,mustChangePwd:!c.data.password,sessionVersion:(user.sessionVersion||0)+1});await tx.audit(c.user,'user.reset-password',user.id);return {temporaryPassword:c.data.password?null:password,mustChangePwd:!c.data.password}})
  })
  r('GET','/core/team/applications',async c=>{d.operate(c.user);if(c.user.role==='creator')d.fail('无权限',403);const list=await c.store.find('applications',c.user.role==='admin'?{}:{leaderId:c.user.id});return Promise.all(list.map(async a=>{const creator=await c.store.get('users',a.creatorId),leader=await c.store.get('users',a.leaderId);return {...a,creatorName:creator?.displayName,creatorUsername:creator?.username,leaderName:leader?.displayName}}))})
  r('GET','/core/team/leaders',async c=>{if(c.user.role!=='creator')d.fail('仅达人可申请入团',403);return (await c.store.find('users',{role:'leader',isActive:true})).map(d.safeUser)})
  r('GET','/core/team/my',async c=>{return c.user.parentId?d.safeUser(await c.store.get('users',c.user.parentId)):null})
  r('GET','/core/team/applications/mine',c=>c.store.find('applications',{creatorId:c.user.id}))
  r('POST','/core/team/applications',async c=>{
    if(c.user.role!=='creator')d.fail('仅达人可申请入团',403)
    return c.store.transaction(async tx=>{await tx.lock(['team',c.user.id]);const user=await tx.get('users',c.user.id);if(user.parentId)d.fail('当前已加入团队');const key=await tx.get('keys',d.hash(['username',d.text(c.data.leaderUsername,'团长账号',64).toLowerCase()])),leader=key&&await tx.get('users',key.owner);if(!leader?.isActive||leader.role!=='leader')d.fail('团长不存在');if((await tx.find('applications',{creatorId:user.id,status:'pending'})).length)d.fail('已有待审核申请',409);return tx.add('applications',{creatorId:user.id,leaderId:leader.id,message:String(c.data.message||'').slice(0,500),status:'pending'})})
  })
  r('POST','/core/team/applications/:id/review',async c=>{
    d.operate(c.user);if(!['approve','reject'].includes(c.data.action))d.fail('操作不正确')
    return c.store.transaction(async tx=>{const a=await tx.get('applications',c.params.id);if(!a||c.user.role!=='admin'&&a.leaderId!==c.user.id||c.user.role==='creator')d.fail('无权审核',403);await tx.lock(['team',a.creatorId]);if(a.status!=='pending')d.fail('申请已处理',409);const user=await tx.get('users',a.creatorId);if(c.data.action==='approve'){if(user.parentId||!user.isActive)d.fail('成员关系已变化',409);await tx.put('users',user.id,{...user,parentId:a.leaderId,sessionVersion:(user.sessionVersion||0)+1})}await tx.put('applications',a.id,{...a,status:c.data.action==='approve'?'approved':'rejected',handledAt:d.now(),handledBy:c.user.id});await tx.audit(c.user,'team.review',a.id);return null})
  })
  r('GET','/core/announcements',async c=>await c.store.find('announcements',c.user.role==='admin'&&['all','operations'].includes(c.user.adminDuty||'all')?{}:{published:true}))
  r('GET','/core/audit-logs',async c=>{d.duty(c.user,'all');return d.page(await c.store.find('audit'),c.data)})
}
module.exports={register,projectAccess,createUser}
