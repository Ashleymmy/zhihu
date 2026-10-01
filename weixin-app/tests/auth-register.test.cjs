const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, identity } = require('./cloud-fixture.cjs')
const d = require('../cloudfunctions/opc-api/lib/domain')

/**
 * 注册 / 微信绑定 / 手机号登录的契约：
 *   - 注册：手机号+密码+邀请码（强制）→ 系统分配账号 id、按邀请码定归属与项目权限
 *   - 微信登录：openid 未绑定返回 needsBind；绑定页（手机号+邀请码）完成开户
 *   - 手机号已注册时绑定页验证原密码后绑定微信
 *   - 密码登录可按手机号登录，且成功后顺带绑定当前微信
 */

const fresh = openid => ({ openid, appid: identity.appid })

async function seeded() {
  const f = await fixture()
  // 团长 2 的邀请码（归属：parentId=2）；达人 3（parentId=2）的邀请码（归属沿用其上家）
  await f.store.put('invite_codes', 'code-leader', { id: 'code-leader', userId: '2', projectId: '1', accountId: '10', code: 'TEAM2026', usageCount: 0, createdAt: d.now() })
  await f.store.put('invite_codes', 'code-creator', { id: 'code-creator', userId: '3', projectId: '1', accountId: '10', code: 'CREA2026', usageCount: 0, createdAt: d.now() })
  return f
}

test('wechat-login returns needsBind for an unbound openid', async () => {
  const f = await seeded()
  const res = await f.call(null, 'POST', '/core/auth/wechat-login', {}, fresh('openid-x1'))
  assert.equal(res.code, 0)
  assert.equal(res.data.needsBind, true)
  assert.equal(res.data.token, undefined, '未绑定不得发会话')
})

test('register creates an account with assigned id, invite-based parent and membership', async () => {
  const f = await seeded()
  const me = fresh('openid-r1')
  const res = await f.call(null, 'POST', '/core/auth/register', {
    phone: '13800000001', password: 'Passw0rd!', inviteCode: 'team2026', displayName: '小明',
  }, me)
  assert.equal(res.code, 0, res.message)
  assert.ok(res.data.token)
  const user = res.data.user
  assert.equal(user.role, 'creator')
  assert.equal(user.parentId, '2', '团长邀请码：归属团长本人')
  assert.match(user.username, /^u\d+/, '账号 id 由系统分配')
  assert.equal(user.displayName, '小明')

  // 项目权限与邀请奖励
  const member = await f.store.get('members', d.hash(['1', user.id]))
  assert.ok(member, '邀请码必须同时授予项目权限')
  const rewards = await f.store.find('invite_rewards', { inviteeId: user.id })
  assert.equal(rewards.length, 1)
  assert.equal(rewards[0].inviterId, '2')
  const code = await f.store.get('invite_codes', 'code-leader')
  assert.equal(code.usageCount, 1)

  // 密码登录：按手机号即可登录
  const login = await f.call(null, 'POST', '/core/auth/login', { username: '13800000001', password: 'Passw0rd!' }, fresh('openid-r2'))
  assert.equal(login.code, 0, '注册后可按手机号+密码登录')

  // 注册时已绑定微信：wechat-login 直接成功，不再 needsBind
  const wx = await f.call(null, 'POST', '/core/auth/wechat-login', {}, me)
  assert.equal(wx.data.needsBind, undefined)
  assert.ok(wx.data.token)
})

test('register validates phone, password and invite code', async () => {
  const f = await seeded()
  const me = fresh('openid-v1')
  const badPhone = await f.call(null, 'POST', '/core/auth/register', { phone: '123', password: 'Passw0rd!', inviteCode: 'TEAM2026' }, me)
  assert.equal(badPhone.statusCode, 422)
  const shortPw = await f.call(null, 'POST', '/core/auth/register', { phone: '13800000002', password: 'short', inviteCode: 'TEAM2026' }, me)
  assert.equal(shortPw.statusCode, 422)
  const noCode = await f.call(null, 'POST', '/core/auth/register', { phone: '13800000002', password: 'Passw0rd!' }, me)
  assert.equal(noCode.statusCode, 422)
  const badCode = await f.call(null, 'POST', '/core/auth/register', { phone: '13800000002', password: 'Passw0rd!', inviteCode: 'NOPE' }, me)
  assert.equal(badCode.statusCode, 404)
})

test('register rejects a duplicate phone and an already-bound wechat', async () => {
  const f = await seeded()
  const me = fresh('openid-d1')
  const first = await f.call(null, 'POST', '/core/auth/register', { phone: '13800000003', password: 'Passw0rd!', inviteCode: 'TEAM2026' }, me)
  assert.equal(first.code, 0)
  const dupPhone = await f.call(null, 'POST', '/core/auth/register', { phone: '13800000003', password: 'Passw0rd!', inviteCode: 'TEAM2026' }, fresh('openid-d2'))
  assert.equal(dupPhone.statusCode, 409)
  const dupWx = await f.call(null, 'POST', '/core/auth/register', { phone: '13800000004', password: 'Passw0rd!', inviteCode: 'TEAM2026' }, me)
  assert.equal(dupWx.statusCode, 409, '同一微信不能重复开户')
})

test('creator invite code keeps the inviter parent as the parent', async () => {
  const f = await seeded()
  const res = await f.call(null, 'POST', '/core/auth/register', { phone: '13800000005', password: 'Passw0rd!', inviteCode: 'CREA2026' }, fresh('openid-p1'))
  assert.equal(res.code, 0)
  assert.equal(res.data.user.parentId, '2', '达人邀请码：归属沿用邀请人的上家')
})

test('bind with a new phone creates the account; bind with an existing phone verifies the password', async () => {
  const f = await seeded()
  // 新手机号：绑定即注册（邀请码必填）
  const noCode = await f.call(null, 'POST', '/core/auth/bind', { phone: '13800000006', password: 'Passw0rd!' }, fresh('openid-b1'))
  assert.equal(noCode.statusCode, 422, '新手机号绑定必须带邀请码')
  const created = await f.call(null, 'POST', '/core/auth/bind', { phone: '13800000006', password: 'Passw0rd!', inviteCode: 'TEAM2026' }, fresh('openid-b1'))
  assert.equal(created.code, 0, created.message)
  const userId = created.data.user.id

  // 同一手机号 + 另一个微信：验证原密码后绑定
  const wrong = await f.call(null, 'POST', '/core/auth/bind', { phone: '13800000006', password: 'WrongPass1' }, fresh('openid-b2'))
  assert.equal(wrong.statusCode, 401)
  const bound = await f.call(null, 'POST', '/core/auth/bind', { phone: '13800000006', password: 'Passw0rd!' }, fresh('openid-b2'))
  assert.equal(bound.code, 0, bound.message)
  assert.equal(bound.data.user.id, userId, '必须绑定到同一个账号')
  const wx = await f.call(null, 'POST', '/core/auth/wechat-login', {}, fresh('openid-b2'))
  assert.ok(wx.data.token, '绑定后微信一键登录可用')
})

test('password login binds the current wechat when it is unbound', async () => {
  const f = await seeded()
  const me = fresh('openid-l1')
  const login = await f.call(null, 'POST', '/core/auth/login', { username: 'admin', password: 'Test-password-123' }, me)
  assert.equal(login.code, 0, login.message)
  const wx = await f.call(null, 'POST', '/core/auth/wechat-login', {}, me)
  assert.ok(wx.data.token, '密码登录后微信已被绑定，一键登录直接成功')
  assert.equal(wx.data.user.username, 'admin')
})
