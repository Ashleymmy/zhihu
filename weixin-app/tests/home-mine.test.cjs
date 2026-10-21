const test = require('node:test')
const assert = require('node:assert/strict')
const { harness, scoped } = require('./harness.cjs')

/**
 * pages/home 与 pages/mine 是 tabBar 外壳页，此前没有任何测试加载过。
 * session.test.cjs 只断言了 permissions.menus() 的键，页面层的组装
 * （过滤 tab 项、按角色注入「提现记录」、总是追加「修改密码」、图标映射）
 * 没有任何覆盖，而这正是用户实际看到的菜单。
 */
function setup(user, handler) {
  const h = harness(
    handler ||
      (call => {
        if (call.path === '/core/auth/me') return user
        const common = scoped(call)
        if (common !== undefined) return common
        if (call.path === '/core/finance') return { balance: '12.34', canManage: false, total: 0, withdrawals: [] }
        return { id: 'ok' }
      }),
  )
  h.session(user)
  return h
}
const keys = list => Array.from(list, item => item.key)

// 角色 → 我的页菜单。与 README 的角色能力表一一对应；「邀请好友」对全部角色开放。
const MINE_MENUS = [
  ['creator', null, ['join-team', 'withdrawals', 'invite', 'password']],
  ['leader', null, ['team', 'withdrawals', 'invite', 'password']],
  ['admin', 'operations', ['team', 'admin', 'invite', 'password']],
  ['admin', 'finance', ['reports', 'prices', 'withdrawals', 'invite', 'password']],
  ['admin', 'all', ['reports', 'team', 'prices', 'admin', 'withdrawals', 'invite', 'password']],
  ['admin', null, ['reports', 'team', 'prices', 'admin', 'withdrawals', 'invite', 'password']]
]

for (const [role, duty, expected] of MINE_MENUS) {
  test(`mine menu for ${role}${duty ? '/' + duty : ''} is ${expected.join(', ')}`, async () => {
    const h = setup({ id: '4', role, adminDuty: duty })
    const page = h.page('mine')
    await page.onShow()

    assert.equal(page.data.allowed, true)
    assert.deepEqual(keys(page.data.menus), expected)
    for (const item of page.data.menus) {
      assert.ok(item.icon || item.iconImg, item.key + ' 缺少图标')
      assert.match(item.tint, /^#[0-9a-f]{6}$/i, item.key + ' 缺少底色')
      assert.match(item.fg, /^#[0-9a-f]{6}$/i, item.key + ' 缺少前景色')
      assert.match(item.path, /^\/pages\/[a-z-]+\/index$/)
    }
  })
}

test('mine never lists a tabBar page, since the tabBar already covers them', async () => {
  const h = setup({ id: '4', role: 'admin', adminDuty: 'all' })
  const page = h.page('mine')
  await page.onShow()

  for (const path of ['/pages/home/index', '/pages/keywords/index', '/pages/works/index', '/pages/wallet/index'])
    assert.equal(page.data.menus.some(item => item.path === path), false, path + ' 不应出现在我的页菜单')
})

test('mine always offers password change even for the most restricted role', async () => {
  const h = setup({ id: '4', role: 'creator' })
  const page = h.page('mine')
  await page.onShow()

  assert.ok(page.data.menus.some(item => item.key === 'password'))
})

test('logout clears local session and routes to login even when the server call fails', async () => {
  const user = { id: '4', role: 'admin', adminDuty: 'all' }
  const h = setup(user, call => {
    if (call.path === '/core/auth/logout') return { networkError: 'request:fail' }
    if (call.path === '/core/auth/me') return user
    const common = scoped(call)
    return common !== undefined ? common : { id: 'ok' }
  })
  const page = h.page('mine')
  await page.onShow()

  await page.logout()

  assert.equal(h.storage.get('zk_access_token'), undefined, '令牌必须清除')
  assert.equal(h.storage.get('zk_user'), undefined)
  assert.equal(h.storage.get('zk_scope'), undefined)
  assert.equal(h.app.globalData.user, null)
  assert.deepEqual({ ...h.app.globalData.scope }, { projectId: '', accountId: '' })
  assert.ok(h.navigation.includes('/pages/login/index'), '必须回到登录页')
})

test('logout does nothing while another action is in flight', async () => {
  const h = setup({ id: '4', role: 'admin', adminDuty: 'all' })
  const page = h.page('mine')
  await page.onShow()

  page.setData({ busy: true })
  await page.logout()

  assert.equal(h.calls.some(c => c.path === '/core/auth/logout'), false)
  assert.equal(h.navigation.includes('/pages/login/index'), false)
})

test('home lists only the non-tab role entries', async () => {
  const h = setup({ id: '4', role: 'admin', adminDuty: 'all' })
  const page = h.page('home')
  await page.onShow()

  assert.deepEqual(keys(page.data.menus), ['reports', 'team', 'prices', 'admin'])
  for (const item of page.data.menus) assert.ok(item.icon || item.iconImg, item.key + ' 缺少图标')
})

test('member home and mine keep earnings while restoring payment services and omitting pricing', async () => {
  for (const user of [
    { id: '2', role: 'creator', parentId: null },
    { id: '3', role: 'creator', parentId: '4' },
    { id: '4', role: 'leader' },
  ]) {
    const h = setup(user)
    for (const name of ['home', 'mine']) {
      const page = h.page(name)
      await page.onShow()
      assert.equal(page.data.allowed, true)
      assert.equal(page.data.menus.some(item => item.key === 'prices'), false)
    }
    const permissions = h.load('utils/permissions')
    assert.equal(permissions.allowed(user, 'income'), true)
    for (const name of ['wallet', 'withdrawals']) assert.equal(permissions.allowed(user, name), true)
  }
})

test('home switching the account updates the global scope', async () => {
  const user = { id: '3', role: 'creator' }
  const h = setup(user, call => {
    if (call.path === '/core/auth/me') return user
    if (call.path === '/core/projects') return [{ id: '1', name: '项目一', isEnabled: true }]
    if (call.path === '/core/projects/1/integrations')
      return [
        { id: '10', name: '知乎账号甲', moduleId: 'zhihu', status: 'active' },
        { id: '11', name: '知乎账号乙', moduleId: 'zhihu', status: 'active' }
      ]
    if (call.path === '/core/finance') return { balance: '1.00' }
    return { id: 'ok' }
  })
  const page = h.page('home')
  await page.onShow()
  assert.equal(h.app.globalData.scope.accountId, '10')

  page.onAccountChange({ detail: { value: 1 } })

  assert.equal(page.data.accountIndex, 1)
  assert.equal(h.app.globalData.scope.accountId, '11')
  assert.equal(page.data.label, '项目一 · 知乎账号乙')
})
