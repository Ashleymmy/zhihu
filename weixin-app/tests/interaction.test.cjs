const test = require('node:test')
const assert = require('node:assert/strict')
const { harness, scoped } = require('./harness.cjs')

/**
 * 全局交互基建（阶段1）的行为契约：
 *   - screen.js：下拉刷新重置页码并收起动画、触底加载合并去重、到底不再请求、失败回滚页码
 *   - works/withdrawals/keywords 三个列表页的合并策略（默认 list / 嵌套 view.withdrawals / 页签过滤）
 *   - 危险操作必须经 confirm 确认；取消则不发请求
 *   - 操作成功后发成功 toast
 */

const ADMIN = { id: '9', role: 'admin', adminDuty: 'all' }

// ---------- works 页：默认 listKeys 合并 ----------

function worksSetup(pages, total) {
  const state = { gets: [], posts: [], toasts: [] }
  const h = harness(call => {
    const common = scoped(call)
    if (common !== undefined) return common
    if (call.path === '/modules/zhihu/workbench/works' && call.method === 'GET') {
      state.gets.push(call.data.page)
      return { list: pages[call.data.page] || [], total }
    }
    if (call.path.indexOf('/modules/zhihu/evidence/') === 0 && call.method === 'POST') {
      state.posts.push(call.data)
      return { ok: true }
    }
    return {}
  })
  h.wx.showToast = options => {
    state.toasts.push((options && options.title) || '')
    if (options && options.complete) options.complete()
  }
  h.session(ADMIN)
  return { h, state }
}

const workItem = id => ({ id, source:'evidence', keyword: 'k' + id, workUrl: 'https://x/' + id, status: 'passed', executorId: '1' })

test('works onReachBottom merges the next page and dedupes by id', async () => {
  const { h, state } = worksSetup(
    { 1: [workItem('a'), workItem('b')], 2: [workItem('b'), workItem('c')] },
    40,
  )
  const page = h.page('works')
  await page.onShow()
  assert.deepEqual(page.data.list.map(i => i.id), ['a', 'b'])
  assert.deepEqual(state.gets, [1])

  await page.onReachBottom()

  assert.deepEqual(state.gets, [1, 2])
  assert.deepEqual(page.data.list.map(i => i.id), ['a', 'b', 'c'], '重复的 b 只能出现一次')
  assert.equal(page.data.total, 40)
  assert.equal(page.data.loadingMore, false)
})

test('works onReachBottom does nothing once all items are loaded', async () => {
  const { h, state } = worksSetup({ 1: [workItem('a'), workItem('b')] }, 2)
  const page = h.page('works')
  await page.onShow()

  await page.onReachBottom()

  assert.deepEqual(state.gets, [1], 'page*pageSize >= total 时不得再发请求')
  assert.equal(page.data.page, 1)
})

test('works more() failure rolls the page back so the next reach retries', async () => {
  let failSecond = true
  const state = { gets: [] }
  const h = harness(call => {
    const common = scoped(call)
    if (common !== undefined) return common
    if (call.path === '/modules/zhihu/workbench/works' && call.method === 'GET') {
      state.gets.push(call.data.page)
      if (call.data.page === 2 && failSecond) {
        failSecond = false
        return { networkError: 'request:fail timeout' }
      }
      return { list: call.data.page === 1 ? [workItem('a')] : [workItem('b')], total: 40 }
    }
    return {}
  })
  h.session(ADMIN)
  const page = h.page('works')
  await page.onShow()
  assert.equal(page.data.list.length, 1)

  await page.onReachBottom()

  assert.equal(page.data.page, 1, '加载失败必须回滚页码')
  assert.equal(page.data.list.length, 1, '失败不得污染已加载列表')
  assert.equal(page.data.loadingMore, false)

  await page.onReachBottom()

  assert.equal(page.data.page, 2, '再次触底可以重试')
  assert.deepEqual(page.data.list.map(i => i.id), ['a', 'b'])
})

test('works load() resets an infinite page back to page 1', async () => {
  const { h, state } = worksSetup(
    { 1: [workItem('a')], 2: [workItem('b')] },
    40,
  )
  const page = h.page('works')
  await page.onShow()
  await page.onReachBottom()
  assert.deepEqual(state.gets, [1, 2])
  assert.equal(page.data.page, 2)

  await page.load()

  assert.equal(state.gets.at(-1), 1, '整体重载必须重新拉第 1 页')
  assert.equal(page.data.page, 1)
  assert.deepEqual(page.data.list.map(i => i.id), ['a'])
})

test('works onPullDownRefresh reloads page 1 and always stops the refresh animation', async () => {
  const { h, state } = worksSetup({ 1: [workItem('a')], 2: [workItem('b')] }, 40)
  let stopped = 0
  h.wx.stopPullDownRefresh = () => { stopped += 1 }
  const page = h.page('works')
  await page.onShow()
  await page.onReachBottom()
  assert.equal(page.data.page, 2)

  await page.onPullDownRefresh()

  assert.equal(stopped, 1)
  assert.equal(page.data.page, 1)
  assert.equal(state.gets.at(-1), 1)
})

// ---------- withdrawals 页：嵌套 view.withdrawals 合并 + 危险确认 ----------

function withdrawalsSetup(pages, total, user) {
  const state = { gets: [], posts: [] }
  const h = harness(call => {
    const common = scoped(call)
    if (common !== undefined) return common
    if (call.path === '/core/finance' && call.method === 'GET') {
      state.gets.push(call.data.page)
      return {
        balance: { available: '100.00', held: '0', processing: '0', paid: '0', offset: '0' },
        withdrawals: (pages[call.data.page] || []).map(w => Object.assign({}, w)),
        total,
        canManage: false,
      }
    }
    if (call.path.indexOf('/core/finance/withdrawals/') === 0 && call.method === 'POST') {
      state.posts.push(call.data)
      return { ok: true }
    }
    return {}
  })
  h.session(user)
  return { h, state }
}

const CREATOR = { id: '3', role: 'creator' }
const wd = (id, status) => ({ id, amount: '10.00', status, userId: '3', displayName: '达人', receiverName: '张某', bankName: '招行', createdAt: '2026-09-01' })

test('withdrawals onReachBottom merges nested view.withdrawals', async () => {
  const { h, state } = withdrawalsSetup(
    { 1: [wd('w1', 'paid')], 2: [wd('w2', 'paid')] },
    50,
    CREATOR,
  )
  const page = h.page('withdrawals')
  await page.onShow()
  assert.equal(page.data.view.withdrawals.length, 1)

  await page.onReachBottom()

  assert.deepEqual(state.gets, [1, 2])
  assert.deepEqual(page.data.view.withdrawals.map(i => i.id), ['w1', 'w2'])
  assert.equal(page.data.total, 50)
})

test('withdrawals cancel does not post when the confirm sheet is cancelled', async () => {
  const { h, state } = withdrawalsSetup({ 1: [wd('w1', 'pending')] }, 25, CREATOR)
  h.wx.showModal = () => Promise.resolve({ confirm: false })
  const page = h.page('withdrawals')
  await page.onShow()
  page.choose({ currentTarget: { dataset: { index: 0, action: 'cancel' } } })

  await page.review()

  assert.equal(state.posts.length, 0, '取消确认后不得发出撤回请求')
})

test('withdrawals cancel posts after confirmation', async () => {
  const { h, state } = withdrawalsSetup({ 1: [wd('w1', 'pending')] }, 25, CREATOR)
  const page = h.page('withdrawals')
  await page.onShow()
  page.choose({ currentTarget: { dataset: { index: 0, action: 'cancel' } } })

  await page.review()

  assert.equal(state.posts.length, 1)
  assert.equal(state.posts[0].action, 'cancel')
  assert.ok(state.posts[0].requestKey, '写操作必须带请求键')
})

// ---------- works 审核：退回必须二次确认 ----------

test('works reject requires confirmation and skips the request when cancelled', async () => {
  const item = Object.assign(workItem('x1'), { status: 'pending', executorId: '1' })
  const { h, state } = worksSetup({ 1: [item] }, 1)
  h.wx.showModal = () => Promise.resolve({ confirm: false })
  const page = h.page('works')
  await page.onShow()
  page.choose({ currentTarget: { dataset: { index: 0 } } })
  page.setData({ reason: '链接打不开' })

  await page.review({ currentTarget: { dataset: { accept: 'false' } } })

  assert.equal(state.posts.length, 0, '确认弹层取消后不得发出退回请求')
})

test('works reject without a reason never reaches the confirm sheet', async () => {
  const item = Object.assign(workItem('x2'), { status: 'pending', executorId: '1' })
  const { h, state } = worksSetup({ 1: [item] }, 1)
  let modalCalls = 0
  h.wx.showModal = () => { modalCalls += 1; return Promise.resolve({ confirm: true }) }
  const page = h.page('works')
  await page.onShow()
  page.choose({ currentTarget: { dataset: { index: 0 } } })

  await page.review({ currentTarget: { dataset: { accept: 'false' } } })

  assert.equal(modalCalls, 0)
  assert.equal(state.posts.length, 0)
  assert.equal(page.data.error, '请填写退回原因')
})

test('works approve succeeds with a success toast and no confirm sheet', async () => {
  const item = Object.assign(workItem('x3'), { status: 'pending', executorId: '1' })
  const { h, state } = worksSetup({ 1: [item] }, 1)
  let modalCalls = 0
  h.wx.showModal = () => { modalCalls += 1; return Promise.resolve({ confirm: true }) }
  const page = h.page('works')
  await page.onShow()
  page.choose({ currentTarget: { dataset: { index: 0 } } })

  await page.review({ currentTarget: { dataset: { accept: 'true' } } })

  assert.equal(modalCalls, 0, '通过审核不弹危险确认')
  assert.equal(state.posts.length, 1)
  assert.ok(state.toasts.includes('作品已通过审核'), '成功后要有 toast 反馈')
})

// ---------- keywords 页：合并后按当前页签重新过滤 ----------

function keywordsSetup(pages, total) {
  const h = harness(call => {
    const common = scoped(call)
    if (common !== undefined) return common
    if (call.path === '/modules/zhihu/attribution-options')
      return { tasks: [], mappings: [], users: [] }
    if (call.path === '/modules/zhihu/keywords')
      return { list: pages[call.data.page] || [], total }
    return {}
  })
  h.session(ADMIN)
  return { h }
}

const kw = (id, lifecycleStatus) => ({
  id,
  keyword: 'kw-' + id,
  lifecycleStatus,
  syncStatus: 'synced',
  planStatus: 'active',
  taskId: 't1',
})

test('keywords tabs request server-filtered pages and merge matching records', async () => {
  const { h } = keywordsSetup(
    { 1: [kw('b', 'active')], 2: [kw('c', 'active')] },
    60,
  )
  const page = h.page('keywords')
  await page.onShow()
  // 切到「进行中」页签（active,assigned,reserved）
  await page.switchTab({ currentTarget: { dataset: { index: 2 } } })
  assert.equal(h.calls.filter(c=>c.path.endsWith('/keywords')).at(-1).data.view,'ongoing')
  assert.deepEqual(page.data.filteredList.map(i => i.id), ['b'])

  await page.onReachBottom()

  assert.deepEqual(page.data.list.map(i => i.id), ['b', 'c'])
  assert.deepEqual(
    page.data.filteredList.map(i => i.id),
    ['b', 'c'],
    '触底合并后必须按当前页签重新过滤',
  )
})

// ---------- feedback.confirm 的双风格 showModal 兼容 ----------

test('feedback confirm fallback resolves from callback-style showModal', async () => {
  const h = harness()
  h.wx.showModal = options => {
    if (options && options.success) options.success({ confirm: true })
  }
  const mod = h.load('utils/feedback')
  const ok = await mod.confirm({}, { title: 't' })
  assert.equal(ok, true)
})

test('feedback confirm fallback resolves false when showModal reports cancel', async () => {
  const h = harness()
  h.wx.showModal = () => Promise.resolve({ confirm: false })
  const mod = h.load('utils/feedback')
  const ok = await mod.confirm({}, { title: 't' })
  assert.equal(ok, false)
})
