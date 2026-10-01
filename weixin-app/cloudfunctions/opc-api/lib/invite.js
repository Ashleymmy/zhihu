const d = require('./domain')
const { authorize } = require('./store')

const REWARD_AMOUNT = '5.00'

// 邀请返利金额可在「定价规则」页由运营管理员配置（settings/invite-reward），默认 ¥5.00
async function rewardAmount(store) {
  try {
    const setting = await store.get('settings', 'invite-reward')
    if (setting?.amount && d.cash(setting.amount) > 0n) return setting.amount
  } catch (_) { /* 配置缺失或损坏时用默认值 */ }
  return REWARD_AMOUNT
}

// 新环境里 opc_invite_rewards / opc_invite_codes 集合可能尚未创建：
// CloudBase 对不存在的集合查询直接抛错，读路径按「无记录」处理。
function isCollectionMissing(error) {
  const message = String((error && (error.errMsg || error.message)) || '')
  return /collection/i.test(message) && /not exist|not found|does not exist/i.test(message)
}
async function findRewards(store, where) {
  try {
    return await store.find('invite_rewards', where)
  } catch (error) {
    if (isCollectionMissing(error)) return []
    throw error
  }
}

// CloudBase 不允许写不存在的集合，而写路径无法用「按空处理」兜底：
// 在首次写 invite_codes / invite_rewards 前主动建集合（已存在则忽略报错）。
// 内存适配器（测试）没有 createCollection，同样吞掉继续。
async function ensureCollections(store) {
  if (!store.db || typeof store.db.createCollection !== 'function') return
  for (const name of ['invite_codes', 'invite_rewards']) {
    try { await store.db.createCollection('opc_' + name) } catch (_) { /* 已存在 */ }
  }
}

function codeKey(userId, scope) {
  return d.hash([userId, scope.projectId, scope.accountId])
}

async function ensureCode(tx, user, scope) {
  const id = codeKey(user.id, scope)
  const existing = await tx.get('invite_codes', id)
  if (existing) return existing
  const row = { id, userId: user.id, ...scope, code: d.uid().slice(0, 8).toUpperCase(), usageCount: 0, createdAt: d.now() }
  await tx.put('invite_codes', id, row)
  return row
}

// 新用户开户的唯一入口：邀请码同时决定归属（parentId）与项目权限（members），
// 否则新账号会因为没有项目权限而无法使用。注册（手机号+密码）与微信绑定
// （openid）都走这里；与 /invite/use（已登录用户事后领奖）是独立路径。
// options: { code, openid?, phone?, passwordHash, displayName?, via }
async function createUserWithInvite(store, options) {
  const inviteCode = String(options.code || '').trim().toUpperCase()
  if (!inviteCode || inviteCode.length > 20) d.fail('邀请码不正确')
  const openid = options.openid || ''
  const phone = options.phone || ''
  const amount = await rewardAmount(store)
  await ensureCollections(store)
  return store.transaction(async tx => {
    if (openid) {
      await tx.lock(['invite_use_wx', openid])
      if (await tx.get('keys', d.hash(['openid', openid]))) d.fail('当前微信已绑定账号，请直接登录', 409)
    }
    if (phone && await tx.get('keys', d.hash(['phone', phone]))) d.fail('该手机号已注册，请直接登录', 409)
    const allCodes = await tx.find('invite_codes', { code: inviteCode })
    if (!allCodes.length) d.fail('邀请码无效', 404)
    const codeDoc = allCodes[0]
    const inviter = await tx.get('users', codeDoc.userId)
    if (!inviter?.isActive) d.fail('邀请码已失效', 404)
    const parentId = inviter.role === 'leader' ? inviter.id : (inviter.parentId || null)
    const user = {
      id: d.uid(),
      // 账号 id 由系统分配，用户只需记住手机号（或微信一键登录）
      username: 'u' + d.uid().slice(0, 10),
      displayName: options.displayName || (phone ? '用户' + phone.slice(-4) : '新用户'),
      role: 'creator',
      parentId,
      phone,
      passwordHash: options.passwordHash,
      isActive: true, mustChangePwd: false, sessionVersion: 0,
      adminDuty: 'all', createdAt: d.now(),
    }
    await tx.unique('username', user.username.toLowerCase(), user.id)
    if (phone) await tx.unique('phone', phone, user.id)
    if (openid) await tx.unique('openid', openid, user.id)
    await tx.put('users', user.id, user)
    await tx.put('members', d.hash([codeDoc.projectId, user.id]), { projectId: codeDoc.projectId, userId: user.id, memberRole: 'member', joinedAt: d.now() })
    await tx.add('invite_rewards', {
      projectId: codeDoc.projectId, accountId: codeDoc.accountId,
      inviterId: codeDoc.userId, inviteeId: user.id,
      amount, status: 'settled', settledAt: d.now(),
    })
    await tx.put('invite_codes', codeDoc.id, { ...codeDoc, usageCount: (codeDoc.usageCount || 0) + 1 })
    await tx.audit(user, 'user.create', user.id, { role: 'creator', via: options.via || 'invite' })
    return user
  })
}

function register(r) {
  r('GET', '/modules/zhihu/invite/me', async c => {
    const scope = d.scopeOf(c.data)
    await ensureCollections(c.store)
    const amount = await rewardAmount(c.store)
    return c.store.transaction(async tx => {
      await authorize(tx, c.user, scope)
      const codeDoc = await ensureCode(tx, c.user, scope)
      const rewards = await tx.find('invite_rewards', { inviterId: c.user.id, projectId: scope.projectId, accountId: scope.accountId })
      const total = d.money(rewards.reduce((n, row) => n + d.cash(row.amount, true), 0n))
      return { code: codeDoc.code, total, usageCount: codeDoc.usageCount, rewardAmount: amount }
    })
  })

  // 邀请返利金额：全员可读（邀请页展示），仅运营管理员可改
  r('GET', '/core/settings/invite-reward', async c => ({ amount: await rewardAmount(c.store) }))
  r('POST', '/core/settings/invite-reward', async c => {
    d.duty(c.user, 'operations')
    const amount = d.money(d.cash(String((c.data || {}).amount ?? '')))
    if (d.cash(amount) <= 0n) d.fail('返利金额须大于零')
    return c.store.transaction(async tx => {
      await tx.put('settings', 'invite-reward', { id: 'invite-reward', amount, updatedBy: c.user.id, updatedAt: d.now() })
      await tx.audit(c.user, 'settings.invite-reward', 'invite-reward', { amount })
      return { amount }
    })
  })

  // No scope required — any authenticated user can redeem a code once
  r('POST', '/modules/zhihu/invite/use', async c => {
    const code = String(c.data.code || '').trim().toUpperCase()
    if (!code || code.length > 20) d.fail('邀请码不正确')
    await ensureCollections(c.store)
    const amount = await rewardAmount(c.store)
    return c.store.transaction(async tx => {
      await tx.lock(['invite_use', c.user.id])
      const existing = await tx.find('invite_rewards', { inviteeId: c.user.id })
      if (existing.length) d.fail('您已使用过邀请码', 409)
      const allCodes = await tx.find('invite_codes', { code })
      if (!allCodes.length) d.fail('邀请码无效', 404)
      const inviteCode = allCodes[0]
      if (inviteCode.userId === c.user.id) d.fail('不能使用自己的邀请码')
      await tx.add('invite_rewards', {
        projectId: inviteCode.projectId, accountId: inviteCode.accountId,
        inviterId: inviteCode.userId, inviteeId: c.user.id,
        amount, status: 'settled', settledAt: d.now(),
      })
      await tx.put('invite_codes', inviteCode.id, { ...inviteCode, usageCount: (inviteCode.usageCount || 0) + 1 })
      return { rewarded: true, amount: REWARD_AMOUNT }
    })
  })

  r('GET', '/modules/zhihu/invite/status', async c => {
    const rewards = await findRewards(c.store, { inviteeId: c.user.id })
    return { used: rewards.length > 0 }
  })

  r('GET', '/modules/zhihu/invite/rewards', async c => {
    const scope = d.scopeOf(c.data)
    await authorize(c.store, c.user, scope)
    const rewards = await findRewards(c.store, { inviterId: c.user.id, projectId: scope.projectId, accountId: scope.accountId })
    const users = new Map()
    const getUser = async id => {
      if (!users.has(id)) users.set(id, await c.store.get('users', id))
      return users.get(id)
    }
    const records = await Promise.all(rewards.map(async row => {
      const invitee = await getUser(row.inviteeId)
      return { key: row.id, title: '邀请好友 · ' + (invitee?.displayName || '新用户'), time: row.settledAt || row.createdAt, amount: row.amount }
    }))
    const total = d.money(rewards.reduce((n, row) => n + d.cash(row.amount, true), 0n))
    return { total, records }
  })
}

module.exports = { register, createUserWithInvite }
