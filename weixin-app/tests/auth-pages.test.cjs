const test = require('node:test')
const assert = require('node:assert/strict')
const { harness } = require('./harness.cjs')

/**
 * 登录/注册/绑定页的前端契约：
 *   - 微信一键登录未绑定账号时跳绑定页
 *   - 注册页本地校验（手机号/密码长度/邀请码）不通过不发请求
 *   - 注册/绑定成功后按 entryPath 落地
 */

const NEW_USER = { id: '100', username: 'u1234567890', displayName: '用户0001', role: 'creator', parentId: '2' }

function setup(handler) {
  const h = harness(call => {
    if (call.path === '/core/auth/me') return NEW_USER
    return handler(call)
  })
  return h
}

test('login page navigates to the bind page when wechat-login needs binding', async () => {
  const h = setup(call => {
    if (call.path === '/core/auth/wechat-login') return { needsBind: true }
    return {}
  })
  const page = h.page('login')
  await page.onLoad()

  await page.wechatLogin()

  assert.ok(h.navigation.includes('/pages/bind/index'), '未绑定微信必须引导到绑定页')
})

test('login page lands on entryPath when wechat-login succeeds', async () => {
  const h = setup(call => {
    if (call.path === '/core/auth/wechat-login') return { token: 'tk-1', user: NEW_USER, mustChangePwd: false }
    return {}
  })
  const page = h.page('login')
  await page.onLoad()

  await page.wechatLogin()

  assert.ok(h.navigation.includes('/pages/home/index'))
})

test('register page validates locally before any request', async () => {
  const h = setup(() => ({ token: 'tk', user: NEW_USER }))
  const page = h.page('register')
  page.setData({ phone: '123', password: 'Passw0rd!', inviteCode: 'TEAM2026' })
  await page.submit()
  assert.equal(page.data.error, '请输入正确的 11 位手机号')
  assert.equal(h.calls.length, 0)

  page.setData({ phone: '13800000001', password: 'short' })
  await page.submit()
  assert.equal(page.data.error, '密码至少 8 位')
  assert.equal(h.calls.length, 0)

  page.setData({ password: 'Passw0rd!', inviteCode: '' })
  await page.submit()
  assert.equal(page.data.error, '请填写邀请码，请向邀请人获取')
  assert.equal(h.calls.length, 0)
})

test('register submits phone, password and invite code then lands on entryPath', async () => {
  const h = setup(call => {
    if (call.path === '/core/auth/register') return { token: 'tk-r', user: NEW_USER, mustChangePwd: false }
    return {}
  })
  const page = h.page('register')
  page.setData({ phone: '13800000001', password: 'Passw0rd!', inviteCode: 'team2026', displayName: '小明', agreed: true })

  await page.submit()

  const call = h.calls.find(c => c.path === '/core/auth/register')
  assert.ok(call, '必须调用注册接口')
  assert.equal(call.data.phone, '13800000001')
  assert.equal(call.data.password, 'Passw0rd!')
  assert.equal(call.data.inviteCode, 'TEAM2026', '邀请码统一大写')
  assert.equal(call.data.displayName, '小明')
  assert.ok(h.navigation.includes('/pages/home/index'))
})

// 协议主动勾选：未勾选点注册 → 弹窗；点「不同意」不提交；点「同意」自动勾选并继续
test('register without agreement shows the confirm dialog and does not submit when declined', async () => {
  const h = setup(() => ({ token: 'tk', user: NEW_USER }))
  h.wx.showModal = options => {
    if (options && options.success) options.success({ confirm: false })
    return Promise.resolve({ confirm: false })
  }
  const page = h.page('register')
  page.setData({ phone: '13800000001', password: 'Passw0rd!', inviteCode: 'TEAM2026' })

  await page.submit()

  assert.equal(h.calls.filter(c => c.path === '/core/auth/register').length, 0, '拒绝后不得提交注册')
  assert.equal(page.data.agreed, false)
})

test('register auto-checks the agreement and proceeds when accepted in the dialog', async () => {
  const h = setup(call => {
    if (call.path === '/core/auth/register') return { token: 'tk-r', user: NEW_USER, mustChangePwd: false }
    return {}
  })
  // harness 默认 showModal confirm:true = 用户点了「同意」
  const page = h.page('register')
  page.setData({ phone: '13800000001', password: 'Passw0rd!', inviteCode: 'TEAM2026' })

  await page.submit()

  assert.equal(page.data.agreed, true, '同意后自动勾选')
  assert.ok(h.calls.some(c => c.path === '/core/auth/register'), '同意后继续注册')
})

test('bind page enforces the same agreement gate', async () => {
  const h = setup(call => {
    if (call.path === '/core/auth/bind') return { token: 'tk-b', user: NEW_USER, mustChangePwd: false }
    return {}
  })
  h.wx.showModal = options => {
    if (options && options.success) options.success({ confirm: false })
    return Promise.resolve({ confirm: false })
  }
  const page = h.page('bind')
  page.setData({ phone: '13800000002', password: 'Passw0rd!', inviteCode: 'TEAM2026' })

  await page.submit()

  assert.equal(h.calls.filter(c => c.path === '/core/auth/bind').length, 0, '未同意协议不得绑定')
})

test('bind page submits to the bind endpoint and lands on entryPath', async () => {
  const h = setup(call => {
    if (call.path === '/core/auth/bind') return { token: 'tk-b', user: NEW_USER, mustChangePwd: false }
    return {}
  })
  const page = h.page('bind')
  page.setData({ phone: '13800000002', password: 'Passw0rd!', inviteCode: 'TEAM2026' })

  await page.submit()

  const call = h.calls.find(c => c.path === '/core/auth/bind')
  assert.ok(call, '必须调用绑定接口')
  assert.equal(call.data.username, '13800000002')
  assert.ok(h.navigation.includes('/pages/home/index'))
})

test('bind page rejects empty website username without a request', async () => {
  const h = setup(() => ({}))
  const page = h.page('bind')
  page.setData({ phone: '', password: 'Passw0rd!' })
  await page.submit()
  assert.equal(page.data.error, '请输入网站登录账号')
  assert.equal(h.calls.length, 0)
})
