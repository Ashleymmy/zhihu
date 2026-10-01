const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, scope } = require('./cloud-fixture.cjs')
const d = require('../cloudfunctions/opc-api/lib/domain')
const { run } = require('../cloudfunctions/opc-api/lib/worker')

/**
 * 关键词放通（失败自动重试）契约：
 *   - 放通范围内创建者遇瞬时故障（429/503）自动重排，指数退避，不标失败
 *   - 确定性错误（422）立即失败；结果未知（uncertain）绝不自动重放
 *   - 超过最大次数后标失败；配置关闭或角色不在范围内维持原行为
 *   - 设置读写权限：全员可读，仅运营管理员可写
 */

async function seedKeyword(f, createdBy) {
  await f.store.put('keywords', '50', { id: '50', ...scope, keyword: '放通词', mappingId: '40', taskId: '20', createdBy: createdBy, syncStatus: 'local', planStatus: 'pending', lifecycleStatus: 'pending' })
  await f.store.put('jobs', 'plan-50', { id: 'plan-50', type: 'push-plan', keywordId: '50', scope, status: 'pending', nextAt: 0, attempts: 0, payload: {} })
}

const failing = (status) => async () => { const e = new Error('upstream ' + status); e.status = status; throw e }

test('auto-retry reschedules transient 503 failures without marking the keyword failed', async () => {
  const f = await fixture()
  await seedKeyword(f, '3') // 达人创建
  await f.store.put('settings', 'keyword-auto-retry', { id: 'keyword-auto-retry', enabled: true, roles: ['creator', 'leader'], maxAttempts: 5 })

  await run(f.store, { request: failing(503) })

  const job = await f.store.get('jobs', 'plan-50')
  assert.equal(job.status, 'pending', '自动重试保持 pending')
  assert.ok(job.nextAt > Date.now(), '退避后 nextAt 在未来')
  const word = await f.store.get('keywords', '50')
  assert.notEqual(word.syncStatus, 'failed', '不标失败')
  assert.ok(word.syncError.includes('自动重试中'))
})

test('auto-retry gives up after maxAttempts and marks failed', async () => {
  const f = await fixture()
  await seedKeyword(f, '2') // 团长创建
  await f.store.put('settings', 'keyword-auto-retry', { id: 'keyword-auto-retry', enabled: true, roles: ['leader'], maxAttempts: 1 })

  await run(f.store, { request: failing(503) })

  const job = await f.store.get('jobs', 'plan-50')
  assert.equal(job.status, 'failed', '达到最大次数后标失败')
  const word = await f.store.get('keywords', '50')
  assert.equal(word.syncStatus, 'failed')
})

test('deterministic 422 fails immediately even when auto-retry is enabled', async () => {
  const f = await fixture()
  await seedKeyword(f, '3')
  await f.store.put('settings', 'keyword-auto-retry', { id: 'keyword-auto-retry', enabled: true, roles: ['creator', 'leader'], maxAttempts: 5 })

  await run(f.store, { request: failing(422) })

  assert.equal((await f.store.get('jobs', 'plan-50')).status, 'failed')
  assert.equal((await f.store.get('keywords', '50')).syncStatus, 'failed')
})

test('uncertain upstream results are never auto-replayed', async () => {
  const f = await fixture()
  await seedKeyword(f, '3')
  await f.store.put('settings', 'keyword-auto-retry', { id: 'keyword-auto-retry', enabled: true, roles: ['creator', 'leader'], maxAttempts: 5 })

  await run(f.store, { request: async () => { throw new Error('timeout') } })

  assert.equal((await f.store.get('jobs', 'plan-50')).status, 'uncertain', '结果未知绝不自动重放')
})

test('disabled config keeps the original fail-fast behavior', async () => {
  const f = await fixture()
  await seedKeyword(f, '3')

  await run(f.store, { request: failing(503) })

  assert.equal((await f.store.get('jobs', 'plan-50')).status, 'failed')
})

test('settings read is open; write requires operations duty and validates roles', async () => {
  const f = await fixture()
  const creator = await f.login('creator')
  const before = await f.call(creator, 'GET', '/core/settings/keyword-auto-retry')
  assert.equal(before.code, 0)
  assert.equal(before.data.enabled, false)

  const denied = await f.call(creator, 'POST', '/core/settings/keyword-auto-retry', { enabled: true, roles: ['creator'] })
  assert.equal(denied.statusCode, 403)

  const ops = await f.login('operations')
  const bad = await f.call(ops, 'POST', '/core/settings/keyword-auto-retry', { enabled: true, roles: [] })
  assert.equal(bad.statusCode, 422)
  const ok = await f.call(ops, 'POST', '/core/settings/keyword-auto-retry', { enabled: true, roles: ['creator', 'leader'], maxAttempts: 3 })
  assert.equal(ok.code, 0, ok.message)
  const after = await f.call(creator, 'GET', '/core/settings/keyword-auto-retry')
  assert.equal(after.data.enabled, true)
  assert.equal(after.data.maxAttempts, 3)
})
