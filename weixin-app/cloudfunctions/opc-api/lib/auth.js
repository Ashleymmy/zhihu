const crypto = require('node:crypto')
const bcrypt = require('bcryptjs')
const { fail, text, hash, now, safeUser } = require('./domain')
const invite = require('./invite')
const ttl = 8 * 3600000
const dummyHash = bcrypt.hashSync('cloud-auth-invalid-account',12)
const PHONE = /^1\d{10}$/

// 每 15 分钟 10 次的限流（登录/注册/绑定共用）
async function throttle(store, key) {
  const time = Date.now()
  const allowed = await store.transaction(async tx => {
    const limit = await tx.get('limits',key)
    const current = limit && limit.until > time ? limit : {attempts:0,until:time+900000}
    if (current.attempts >= 10) return false
    current.attempts++;await tx.put('limits',key,current);return true
  })
  if (!allowed) fail('尝试次数过多，请 15 分钟后重试',429)
  return { key, time }
}
async function clearThrottle(store, key) {
  await store.transaction(async tx => { await tx.remove('limits',key) })
}

// 发会话；密码登录成功且当前微信尚未绑定任何账号时顺带绑定 openid，
// 下次即可微信一键登录（已绑定其它账号时不抢占）。
async function issueToken(store, user, openid, via, throttleKey) {
  const token = crypto.randomBytes(32).toString('base64url'), time = Date.now()
  await store.transaction(async tx => {
    const current = await tx.get('users',user.id)
    if (!current?.isActive) fail('账号状态已变化，请重新登录',401)
    await tx.put('sessions',hash(token),{id:hash(token),userId:current.id,openid,version:current.sessionVersion || 0,expiresAt:time+ttl,createdAt:now()})
    if (throttleKey) await tx.remove('limits',throttleKey)
    if (openid && !await tx.get('keys',hash(['openid',openid])))
      await tx.put('keys',hash(['openid',openid]),{kind:'openid',owner:current.id,value:openid})
    await tx.audit(current,'auth.login',current.id,via?{via}:{})
  })
  return {token,user:safeUser(user),mustChangePwd:!!user.mustChangePwd}
}

async function login(store,data,identity) {
  const account = text(data.username,'账号',64)
  text(data.password,'密码',128); const password = data.password
  const { key: limitKey } = await throttle(store, hash(['login',identity.openid,account.toLowerCase()]))
  // 账号优先按用户名查；符合手机号格式时兜底按手机号查（注册用户的登录方式）
  let key = await store.get('keys',hash(['username',account.toLowerCase()]))
  if (!key && PHONE.test(account)) key = await store.get('keys',hash(['phone',account]))
  const user = key ? await store.get('users',key.owner) : null
  const match = await bcrypt.compare(password,user?.passwordHash || dummyHash)
  if (!match || !user || !user.isActive || !['admin','leader','creator'].includes(user.role)) fail('账号或密码错误',401)
  const current = await store.get('users',user.id)
  if (current?.passwordHash !== user.passwordHash) fail('账号状态已变化，请重新登录',401)
  return issueToken(store, user, identity.openid, '', limitKey)
}

// 微信身份免密登录：openid 已绑定账号则直接发 session；未绑定返回 needsBind，
// 由小程序引导到绑定页（手机号 + 邀请码）完成开户，不再在登录接口里直接开户
async function wechatLogin(store,data,identity) {
  const boundKey = await store.get('keys',hash(['openid',identity.openid]))
  const user = boundKey ? await store.get('users',boundKey.owner) : null
  if (!user || !user.isActive) return { needsBind: true }
  return issueToken(store, user, identity.openid, 'wechat')
}

function registrationInput(data) {
  const phone = text(data.phone,'手机号',20)
  if (!PHONE.test(phone)) fail('手机号格式不正确')
  const password = text(data.password,'密码',128)
  if (password.length < 8) fail('密码至少 8 位')
  const code = typeof data.inviteCode === 'string' ? data.inviteCode.trim().toUpperCase() : ''
  if (!code) fail('请填写邀请码，请向邀请人获取')
  const displayName = typeof data.displayName === 'string' && data.displayName.trim()
    ? text(data.displayName,'昵称',32) : ''
  return { phone, password, code, displayName }
}

// 注册：手机号 + 密码 + 邀请码（强制）。系统分配账号 id，邀请码决定归属与项目权限。
async function registerAccount(store,data,identity) {
  const { phone, password, code, displayName } = registrationInput(data)
  const { key: limitKey } = await throttle(store, hash(['register',identity.openid,phone]))
  const passwordHash = await bcrypt.hash(password, 12)
  const user = await invite.createUserWithInvite(store, {
    code, openid: identity.openid, phone, passwordHash, displayName, via: 'register',
  })
  return issueToken(store, user, identity.openid, 'register', limitKey)
}

// 微信登录后的绑定页：手机号 + 邀请码。
// 手机号未注册 → 等同注册（邀请码强制）；已注册 → 验证原密码后绑定当前微信。
async function bindWechat(store,data,identity) {
  if (await store.get('keys',hash(['openid',identity.openid])))
    fail('当前微信已绑定账号，请直接登录',409)
  const phone = text(data.phone,'手机号',20)
  if (!PHONE.test(phone)) fail('手机号格式不正确')
  const { key: limitKey } = await throttle(store, hash(['bind',identity.openid,phone]))
  const phoneKey = await store.get('keys',hash(['phone',phone]))
  if (phoneKey) {
    const user = await store.get('users',phoneKey.owner)
    text(data.password,'密码',128)
    const match = await bcrypt.compare(data.password, user?.passwordHash || dummyHash)
    if (!match || !user || !user.isActive) fail('手机号或密码错误',401)
    await store.transaction(async tx => {
      await tx.lock(['invite_use_wx', identity.openid])
      if (await tx.get('keys',hash(['openid',identity.openid]))) fail('当前微信已绑定账号，请直接登录',409)
      await tx.unique('openid', identity.openid, user.id)
      await tx.remove('limits',limitKey)
      await tx.audit(user,'auth.bind-wechat',user.id)
    })
    return issueToken(store, user, identity.openid, 'wechat-bind')
  }
  const { password, code, displayName } = registrationInput(data)
  const passwordHash = await bcrypt.hash(password, 12)
  const user = await invite.createUserWithInvite(store, {
    code, openid: identity.openid, phone, passwordHash, displayName, via: 'wechat-bind',
  })
  return issueToken(store, user, identity.openid, 'wechat-bind', limitKey)
}

async function authenticate(store,token,identity) {
  if (typeof token !== 'string' || token.length > 256) fail('请先登录',401)
  const session=await store.get('sessions',hash(token))
  if (!session || session.expiresAt <= Date.now() || session.openid !== identity.openid) fail('登录已过期，请重新登录',401)
  const user=await store.get('users',session.userId)
  if (!user?.isActive || (user.sessionVersion || 0) !== session.version || !['admin','leader','creator'].includes(user.role)) fail('登录已失效，请重新登录',401)
  return user
}
async function changePassword(store,user,data) {
  text(data.oldPassword,'原密码',128);text(data.newPassword,'新密码',128)
  const oldPassword=data.oldPassword,newPassword=data.newPassword
  if(newPassword.length<8 || newPassword === oldPassword)fail('新密码至少 8 位，且不能与原密码相同')
  if(!await bcrypt.compare(oldPassword,user.passwordHash))fail('原密码不正确')
  const passwordHash=await bcrypt.hash(newPassword,12)
  await store.transaction(async tx=>{
    const current=await tx.get('users',user.id)
    if(current.passwordHash!==user.passwordHash)fail('密码已变化，请重新登录',401)
    await tx.put('users',user.id,{...current,passwordHash,mustChangePwd:false,sessionVersion:(current.sessionVersion||0)+1})
    await tx.audit(user,'auth.password',user.id)
  });return null
}
async function updateProfile(store,user,data) {
  const updates={}
  if(typeof data.displayName==='string')updates.displayName=text(data.displayName,'昵称',32)
  if(typeof data.contact==='string')updates.contact=data.contact.trim().slice(0,128)||null
  if(!Object.keys(updates).length)fail('没有可更新的字段')
  await store.transaction(async tx=>{
    const current=await tx.get('users',user.id)
    await tx.put('users',user.id,{...current,...updates})
    await tx.audit(user,'auth.profile',user.id)
  })
  return safeUser({...user,...updates})
}
module.exports={login,wechatLogin,registerAccount,bindWechat,authenticate,changePassword,updateProfile}
