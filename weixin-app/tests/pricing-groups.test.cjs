const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, scope } = require('./cloud-fixture.cjs')
const d = require('../cloudfunctions/opc-api/lib/domain')
const { run } = require('../cloudfunctions/opc-api/lib/worker')

/**
 * 角色全局价（定价规则分组）契约：
 *   - 管理员可设「全部团长/全部达人」全局价，团长可设「全部达人」全局价
 *   - 结算价格解析：个人定价优先，缺省回退角色全局价
 *   - leader_creator 全局价发布仍受 agency_leader（含团长全局价）覆盖校验
 * 邀请返利：settings/invite-reward 可配置，注册开户按最新金额记账
 */

async function draftAndPublish(f, token, payload) {
  const draft = await f.call(token, 'POST', '/modules/zhihu/price-agreements', payload)
  assert.equal(draft.code, 0, draft.message)
  const pub = await f.call(token, 'POST', '/modules/zhihu/price-versions/' + draft.data.id + '/publish', { ...scope, requestKey: 'pub-' + payload.requestKey })
  return pub
}

test('admin can set role-level global prices for leaders and creators', async () => {
  const f = await fixture()
  const admin = await f.login('admin')
  const leaderPrice = await draftAndPublish(f, admin, { ...scope, taskId: '20', payeeRole: 'leader', unitPrice: '4', from: '2020-01-01', reason: '团长全局价', requestKey: 'grp-leader-1' })
  assert.equal(leaderPrice.code, 0, leaderPrice.message)
  const creatorPrice = await draftAndPublish(f, admin, { ...scope, taskId: '20', payeeRole: 'creator', unitPrice: '2', from: '2020-01-01', reason: '达人全局价', requestKey: 'grp-creator-1' })
  assert.equal(creatorPrice.code, 0, creatorPrice.message)

  const list = await f.call(admin, 'GET', '/modules/zhihu/price-agreements', { ...scope, page: 1, pageSize: 20 })
  const roles = list.data.list.filter(p => String(p.payeeId).startsWith('role:'))
  assert.equal(roles.length, 2)
  assert.ok(roles.every(p => p.priceStatus === 'published'))
})

test('leader can set a creator group price but not a leader group price; creators cannot price at all', async () => {
  const f = await fixture()
  const admin = await f.login('admin')
  // 先铺团长全局价，leader_creator 发布要有 agency_leader 覆盖
  await draftAndPublish(f, admin, { ...scope, taskId: '20', payeeRole: 'leader', unitPrice: '4', from: '2020-01-01', reason: '覆盖', requestKey: 'grp-leader-2' })

  const leader = await f.login('leader')
  const ok = await draftAndPublish(f, leader, { ...scope, taskId: '20', payeeRole: 'creator', unitPrice: '1.5', from: '2020-01-01', reason: '团队统一价', requestKey: 'grp-lc-1' })
  assert.equal(ok.code, 0, ok.message)
  const denied = await f.call(leader, 'POST', '/modules/zhihu/price-agreements', { ...scope, taskId: '20', payeeRole: 'leader', unitPrice: '1', from: '2020-01-01', reason: 'x', requestKey: 'grp-lc-2' })
  assert.equal(denied.statusCode, 403)
  const creator = await f.login('creator')
  const nope = await f.call(creator, 'POST', '/modules/zhihu/price-agreements', { ...scope, taskId: '20', payeeRole: 'creator', unitPrice: '1', from: '2020-01-01', reason: 'x', requestKey: 'grp-lc-3' })
  assert.equal(nope.statusCode, 403)
})

test('leader_creator group price publish still requires agency coverage', async () => {
  const f = await fixture()
  const leader = await f.login('leader')
  // 没有任何 agency_leader 价格：发布必须被拒绝
  const draft = await f.call(leader, 'POST', '/modules/zhihu/price-agreements', { ...scope, taskId: '20', payeeRole: 'creator', unitPrice: '1.5', from: '2020-01-01', reason: 'x', requestKey: 'grp-lc-9' })
  const pub = await f.call(leader, 'POST', '/modules/zhihu/price-versions/' + draft.data.id + '/publish', { ...scope, requestKey: 'pub-grp-lc-9' })
  assert.equal(pub.statusCode, 409)
})

// 复用 cloud-batching 的导入归因链路，把成员价换成角色全局价
async function reportWithPrice(f, priceRow) {
  await f.store.put('prices', priceRow.id, { ...scope, taskId: '20', startDay: '2020-01-01', endDay: null, priceStatus: 'published', ...priceRow })
  const word = 'grp-word', id = '100', bindingId = '300'
  await f.store.put('keywords', id, { id, ...scope, keyword: word, mappingId: '40', taskId: '20' })
  await f.store.put('keys', d.hash(['keyword', word]), { owner: id })
  await f.store.put('bindings', bindingId, { id: bindingId, keywordId: id, executorId: '3', usedAt: d.now(), activatedOn: '2020-01-01', verificationStatus: 'passed' })
  const key = 'grp-report-000000'
  await f.store.put('import_rows', key, { id: key, batchId: 'grp-report', value: { date: '2026-09-01', channel: 'test-channel', keyword: word, orders: '2', search: '2', revenue: '4.0000' } })
  await f.store.put('imports', 'grp-report', { id: 'grp-report', ...scope, cursor: 0, rowCount: 1, status: 'queued' })
  await f.store.put('jobs', 'grp-job', { id: 'grp-job', type: 'import', scope, batchId: 'grp-report', status: 'pending', nextAt: 0, attempts: 0 })
}

test('attribution falls back to the creator role price when no member price exists', async () => {
  const f = await fixture()
  await reportWithPrice(f, { id: 'p-role', relationType: 'agency_creator', payerId: '1', payeeId: 'role:creator', payeeRole: 'creator', price: '2.0000' })
  await run(f.store)
  const facts = f.dump('facts')
  assert.equal(facts.length, 1)
  assert.equal(facts[0].allocations[0].amount, '4.0000', '2 单 × 全局价 2 元')
})

test('a member price overrides the role default', async () => {
  const f = await fixture()
  await reportWithPrice(f, { id: 'p-role', relationType: 'agency_creator', payerId: '1', payeeId: 'role:creator', payeeRole: 'creator', price: '2.0000' })
  await f.store.put('prices', 'p-member', { id: 'p-member', ...scope, taskId: '20', relationType: 'agency_creator', payerId: '1', payeeId: '3', startDay: '2020-01-01', endDay: null, price: '3.0000', priceStatus: 'published' })
  await run(f.store)
  const facts = f.dump('facts')
  assert.equal(facts[0].allocations[0].amount, '6.0000', '2 单 × 个人价 3 元（个人优先）')
})

test('invite reward amount is configurable and used when registering', async () => {
  const f = await fixture()
  const ops = await f.login('operations')
  await f.store.put('invite_codes', 'code-leader', { id: 'code-leader', userId: '2', projectId: '1', accountId: '10', code: 'TEAM2026', usageCount: 0, createdAt: d.now() })

  // 默认值
  const before = await f.call(ops, 'GET', '/core/settings/invite-reward')
  assert.equal(before.data.amount, '5.00')

  // 运营改价
  const set = await f.call(ops, 'POST', '/core/settings/invite-reward', { amount: '8.50' })
  assert.equal(set.code, 0, set.message)
  const after = await f.call(ops, 'GET', '/core/settings/invite-reward')
  assert.equal(after.data.amount, '8.5000')

  // 新注册账号按新金额记账
  const reg = await f.call(null, 'POST', '/core/auth/register', { phone: '13811112222', password: 'Passw0rd!', inviteCode: 'TEAM2026' }, { openid: 'openid-rw', appid: 'wx22b91776ccf37354' })
  assert.equal(reg.code, 0, reg.message)
  const rewards = await f.store.find('invite_rewards', { inviteeId: reg.data.user.id })
  assert.equal(rewards[0].amount, '8.5000')

  // 达人无权改价
  const creator = await f.login('creator')
  const denied = await f.call(creator, 'POST', '/core/settings/invite-reward', { amount: '1' })
  assert.equal(denied.statusCode, 403)
})
