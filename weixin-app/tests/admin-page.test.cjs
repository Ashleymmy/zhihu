const test = require('node:test')
const assert = require('node:assert/strict')
const { harness, scoped } = require('./harness.cjs')

/**
 * pages/admin 是唯一带「渠道/任务同步 + 上游核对」逻辑的运营页面，
 * 此前没有任何测试加载过它。这些测试跑真实的页面定义。
 */
function setup(role = 'operations') {
  const user = { id: '4', role: 'admin', adminDuty: role }
  const h = harness(call => {
    if (call.path === '/core/auth/me') return user
    const common = scoped(call)
    if (common !== undefined) return common
    if (call.path === '/modules/zhihu/attribution-options')
      return {
        channels: [
          { id: '7', name: '知乎主渠道', zhihuChannelId: 'zh-1' },
          { id: '8', name: '知乎备渠道', zhihuChannelId: 'zh-2' }
        ],
        mappings: []
      }
    if (call.path === '/modules/zhihu/tasks/sync') return { hasMore: false, nextOffset: 0 }
    return { id: 'ok' }
  })
  h.session(user)
  return h
}

async function open(h) {
  const page = h.page('admin')
  await page.onShow()
  return page
}

const posts = h => h.calls.filter(c => c.method === 'POST')

test('admin fetch loads channels and mappings for the resolved scope', async () => {
  const h = setup()
  const page = await open(h)

  assert.equal(page.data.allowed, true)
  assert.equal(page.data.channels.length, 2)
  assert.equal(page.data.scopeLabel, '项目一 · 知乎账号')
  assert.deepEqual({ ...page.data.mappingScope }, { projectId: '1', accountId: '10' })
})

test('syncChannels posts the resolved scope and then reloads', async () => {
  const h = setup()
  const page = await open(h)

  await page.syncChannels()

  const call = posts(h).find(c => c.path === '/modules/zhihu/channels/sync')
  assert.ok(call, '必须发起渠道同步')
  assert.equal(call.data.projectId, '1')
  assert.equal(call.data.accountId, '10')
  assert.ok(call.data.requestKey, '写操作必须带请求键')
  assert.equal(page.data.notice, '渠道同步任务已提交')
})

test('syncTasks refuses to run without a channel selected', async () => {
  const h = setup()
  const page = await open(h)

  page.setData({ channels: [], syncChannelIndex: 0 })
  await page.syncTasks()

  assert.equal(posts(h).some(c => c.path === '/modules/zhihu/tasks/sync'), false)
  assert.match(page.data.error, /请先同步渠道并选择/)
})

test('syncTasks starts a new channel at offset 0', async () => {
  const h = setup()
  const page = await open(h)

  page.setData({ syncChannelIndex: 1, syncOffset: 400 })
  await page.syncTasks()

  const call = posts(h).find(c => c.path === '/modules/zhihu/tasks/sync')
  assert.equal(call.data.channelId, 'zh-2')
  assert.equal(call.data.offset, 0, '换渠道必须从头拉取')
})

test('syncTasks continues from the stored cursor for the same channel', async () => {
  let second = false
  const user = { id: '4', role: 'admin', adminDuty: 'operations' }
  const h = harness(call => {
    if (call.path === '/core/auth/me') return user
    const common = scoped(call)
    if (common !== undefined) return common
    if (call.path === '/modules/zhihu/attribution-options')
      return { channels: [{ id: '7', name: '主渠道', zhihuChannelId: 'zh-1' }], mappings: [] }
    if (call.path === '/modules/zhihu/tasks/sync')
      return second ? { hasMore: false, nextOffset: 0 } : { hasMore: true, nextOffset: 100 }
    return { id: 'ok' }
  })
  h.session(user)
  const page = await open(h)

  page.setData({ syncChannelIndex: 0 })
  await page.syncTasks()
  assert.equal(page.data.hasMoreTasks, true)
  assert.equal(page.data.syncOffset, 100, '第一批必须记住游标')

  second = true
  await page.syncTasks()
  const calls = posts(h).filter(c => c.path === '/modules/zhihu/tasks/sync')
  assert.equal(calls[0].data.offset, 0)
  assert.equal(calls[1].data.offset, 100, '同一渠道必须从游标继续')
  assert.equal(page.data.hasMoreTasks, false)
})

test('createMapping requires a channel, a name and a start date', async () => {
  const h = setup()
  const page = await open(h)

  page.setData({ channelIndex: 0, form: { name: '', from: '2026-01-01', to: '' } })
  await page.createMapping()
  assert.match(page.data.error, /请选择渠道，填写映射名称和有效日期区间/)

  page.setData({ form: { name: '报表渠道', from: '', to: '' } })
  await page.createMapping()
  assert.match(page.data.error, /请选择渠道，填写映射名称和有效日期区间/)

  assert.equal(posts(h).some(c => c.path === '/modules/zhihu/channel-mappings'), false)
})

test('createMapping rejects an end date that is not after the start date', async () => {
  const h = setup()
  const page = await open(h)

  page.setData({ channelIndex: 0, form: { name: '渠道', from: '2026-05-01', to: '2026-05-01' } })
  await page.createMapping()

  assert.equal(posts(h).some(c => c.path === '/modules/zhihu/channel-mappings'), false)
  assert.match(page.data.error, /有效日期区间/)
})

test('createMapping posts the exact channel id and date range', async () => {
  const h = setup()
  const page = await open(h)

  page.setData({ channelIndex: 1, form: { name: '  知乎备渠道  ', from: '2026-05-01', to: '2026-06-01' } })
  await page.createMapping()

  const call = posts(h).find(c => c.path === '/modules/zhihu/channel-mappings')
  assert.ok(call)
  assert.equal(call.data.channelId, '8', '必须使用下拉选中的渠道')
  assert.equal(call.data.name, '知乎备渠道', '名称两端空白必须裁掉')
  assert.equal(call.data.from, '2026-05-01')
  assert.equal(call.data.to, '2026-06-01')
  assert.equal(page.data.formOpen, false)
})

test('createMapping omits an empty end date instead of sending a blank string', async () => {
  const h = setup()
  const page = await open(h)

  page.setData({ channelIndex: 0, form: { name: '长期渠道', from: '2026-05-01', to: '' } })
  await page.createMapping()

  const call = posts(h).find(c => c.path === '/modules/zhihu/channel-mappings')
  assert.equal(call.data.to, undefined)
})

test('createMapping stops when the selected scope no longer matches the active scope', async () => {
  const h = setup()
  const page = await open(h)

  page.setData({ mappingScope: { projectId: '9', accountId: '99' } })
  page.setData({ channelIndex: 0, form: { name: '渠道', from: '2026-05-01', to: '' } })
  await page.createMapping()

  assert.equal(posts(h).some(c => c.path === '/modules/zhihu/channel-mappings'), false)
  assert.match(page.data.error, /请返回工作台重新选择项目/)
})

test('confirmUpstream requires a numeric keyword id, a plan id, a reason and acknowledgement', async () => {
  const h = setup()
  const page = await open(h)

  page.setData({ upstream: { keywordId: 'abc', zhihuPlanId: 'p-1', reason: '已核对', acknowledged: true } })
  await page.confirmUpstream()
  assert.match(page.data.error, /请完整填写并核对上游计划信息/)

  page.setData({ upstream: { keywordId: '5', zhihuPlanId: '', reason: '已核对', acknowledged: true } })
  await page.confirmUpstream()
  assert.match(page.data.error, /请完整填写并核对上游计划信息/)

  page.setData({ upstream: { keywordId: '5', zhihuPlanId: 'p-1', reason: '已核对', acknowledged: false } })
  await page.confirmUpstream()
  assert.match(page.data.error, /请完整填写并核对上游计划信息/)

  assert.equal(posts(h).some(c => c.path.includes('/confirm-upstream')), false)
})

test('confirmUpstream posts to the keyword path with the exact scope and then clears the form', async () => {
  const h = setup()
  const page = await open(h)

  page.setData({ upstream: { keywordId: ' 5 ', zhihuPlanId: ' p-1 ', reason: ' 已核对 ', acknowledged: true } })
  await page.confirmUpstream()

  const call = posts(h).find(c => c.path.includes('/confirm-upstream'))
  assert.equal(call.path, '/modules/zhihu/keywords/5/confirm-upstream')
  assert.equal(call.data.zhihuPlanId, 'p-1')
  assert.equal(call.data.reason, '已核对')
  assert.equal(call.data.acknowledged, true)
  assert.equal(call.data.projectId, '1')
  assert.equal(call.data.accountId, '10')
  assert.deepEqual({ ...page.data.upstream }, { keywordId: '', zhihuPlanId: '', reason: '', acknowledged: false })
})

test('a non-operations duty sees the denied state without calling any business endpoint', async () => {
  const h = setup('finance')
  const page = await open(h)

  assert.equal(page.data.allowed, false)
  assert.equal(page.data.denied, true)
  assert.equal(h.calls.some(c => c.path === '/modules/zhihu/attribution-options'), false)
})
