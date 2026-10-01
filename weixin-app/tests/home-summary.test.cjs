const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, scope } = require('./cloud-fixture.cjs')

/**
 * 首页工作台摘要（GET /modules/zhihu/home-summary）契约：
 *   - 进行中关键词 = 归属当前用户且 assigned/reserved/active
 *   - 待审核：管理员=全部 pending；团长=团队内他人提交；达人=自己提交
 *   - 今日预估走 finance.view 的本日口径（达人 receivable / 管理员 payable）
 */
const d = require('../cloudfunctions/opc-api/lib/domain')

async function seed(f) {
  // 关键词：w1 分配给达人3（active），w2 团长2 自己（assigned），w3 已完成（retired）
  await f.store.put('bindings', 'b1', { id: 'b1', ...scope, keywordId: 'w1', leaderId: '2', executorId: '3', verificationStatus: 'pending', releaseStatus: 'none' })
  await f.store.put('bindings', 'b2', { id: 'b2', ...scope, keywordId: 'w2', leaderId: '2', executorId: '2', verificationStatus: 'passed', releaseStatus: 'none' })
  await f.store.put('bindings', 'b3', { id: 'b3', ...scope, keywordId: 'w3', leaderId: '2', executorId: '3', verificationStatus: 'passed', releaseStatus: 'none' })
  await f.store.put('keywords', 'w1', { id: 'w1', ...scope, keyword: '词一', bindingId: 'b1', lifecycleStatus: 'active', createdAt: d.now() })
  await f.store.put('keywords', 'w2', { id: 'w2', ...scope, keyword: '词二', bindingId: 'b2', lifecycleStatus: 'assigned', createdAt: d.now() })
  await f.store.put('keywords', 'w3', { id: 'w3', ...scope, keyword: '词三', bindingId: 'b3', lifecycleStatus: 'retired', createdAt: d.now() })
  // 作品：e1 达人提交待审核，e2 团长自己的作品待审核（团长不能审自己）
  await f.store.put('evidence', 'e1', { id: 'e1', ...scope, bindingId: 'b1', keyword: '词一', status: 'pending', submittedBy: '3', createdAt: d.now() })
  await f.store.put('evidence', 'e2', { id: 'e2', ...scope, bindingId: 'b2', keyword: '词二', status: 'pending', submittedBy: '2', createdAt: d.now() })
}

test('home-summary counts active keywords and pending reviews for a creator', async () => {
  const f = await fixture()
  await seed(f)
  const token = await f.login('creator')
  const res = await f.call(token, 'GET', '/modules/zhihu/home-summary', scope)
  assert.equal(res.code, 0, res.message)
  assert.equal(res.data.activeKeywords, 1, '达人只看到自己名下的进行中关键词（retired 不算）')
  assert.equal(res.data.pendingReviews, 1, '达人看到自己提交的待审核作品')
})

test('home-summary for a leader counts team reviews but not their own submissions', async () => {
  const f = await fixture()
  await seed(f)
  const token = await f.login('leader')
  const res = await f.call(token, 'GET', '/modules/zhihu/home-summary', scope)
  assert.equal(res.data.activeKeywords, 2, '团长看到团队名下进行中的 w1+w2')
  assert.equal(res.data.pendingReviews, 1, '团长待审只含达人提交的 e1，不含自己提交的 e2')
})

test('home-summary for an admin counts everything and exposes todayPayable', async () => {
  const f = await fixture()
  await seed(f)
  const token = await f.login('admin')
  const res = await f.call(token, 'GET', '/modules/zhihu/home-summary', scope)
  assert.equal(res.data.activeKeywords, 2, 'w3 已完成（retired）不计入进行中')
  assert.equal(res.data.pendingReviews, 2)
  assert.ok(Object.prototype.hasOwnProperty.call(res.data, 'todayPayable'))
  assert.ok(Object.prototype.hasOwnProperty.call(res.data, 'todayReceivable'))
  assert.equal(res.data.today, d.today())
})

test('home-summary requires a valid scope', async () => {
  const f = await fixture()
  const token = await f.login('creator')
  const res = await f.call(token, 'GET', '/modules/zhihu/home-summary', {})
  assert.notEqual(res.code, 0)
})
