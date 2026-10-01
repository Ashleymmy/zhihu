const test = require('node:test')
const assert = require('node:assert/strict')
const { harness, scoped } = require('./harness.cjs')

/**
 * 关键词放通卡（admin 页）：WXML 不支持 indexOf 等函数调用，
 * 角色选中态必须由 data 里的派生布尔值（autoRetryCreator/autoRetryLeader）渲染。
 */

const OPS = { id: '5', role: 'admin', adminDuty: 'operations' }

function setup(cfg) {
  const h = harness(call => {
    const common = scoped(call)
    if (common !== undefined) return common
    if (call.path === '/modules/zhihu/attribution-options') return { tasks: [], channels: [], mappings: [], users: [] }
    if (call.path === '/core/settings/keyword-auto-retry') return cfg
    return {}
  })
  h.session(OPS)
  return h
}

test('auto-retry card renders role selection from derived flags', async () => {
  const h = setup({ enabled: true, roles: ['creator', 'leader'], maxAttempts: 5 })
  const page = h.page('admin')
  await page.onShow()

  assert.equal(page.data.autoRetryCreator, true)
  assert.equal(page.data.autoRetryLeader, true)

  page.toggleAutoRetryRole({ currentTarget: { dataset: { role: 'creator' } } })
  assert.equal(page.data.autoRetryCreator, false)
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.autoRetry.roles)), ['leader'])

  page.toggleAutoRetryRole({ currentTarget: { dataset: { role: 'creator' } } })
  assert.equal(page.data.autoRetryCreator, true)
})

test('missing config falls back to defaults without breaking the card', async () => {
  const h = setup(null)
  const page = h.page('admin')
  await page.onShow()
  assert.equal(page.data.autoRetry.enabled, false)
})
