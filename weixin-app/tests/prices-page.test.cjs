const test = require('node:test')
const assert = require('node:assert/strict')
const { harness, scoped } = require('./harness.cjs')

/**
 * 定价规则页（pages/prices）分组交互契约：
 *   - 收款对象先列角色全局价（全部达人/全部团长），再列成员（带角色后缀）
 *   - 选角色分组提交时带 payeeRole；选成员带 payeeId
 *   - 列表分「角色全局价」与「个人定价」两段
 *   - 邀请返利卡仅管理员可见，保存走 settings 接口
 */

const ADMIN = { id: '1', role: 'admin', adminDuty: 'all' }
const LEADER = { id: '2', role: 'leader' }

function setup(user, prices) {
  const state = { posts: [] }
  const h = harness(call => {
    const common = scoped(call)
    if (common !== undefined) return common
    if (call.path === '/modules/zhihu/attribution-options')
      return {
        tasks: [{ id: '20', name: '小说推文' }],
        mappings: [],
        users: [
          { id: '2', displayName: '团长乙', role: 'leader', parentId: null },
          { id: '3', displayName: '达人甲', role: 'creator', parentId: null },
          { id: '4', displayName: '达人丙', role: 'creator', parentId: '2' },
        ],
      }
    if (call.path === '/modules/zhihu/price-agreements' && call.method === 'GET')
      return { list: prices || [], total: (prices || []).length, page: 1, pageSize: 20 }
    if (call.path === '/modules/zhihu/price-agreements' && call.method === 'POST') {
      state.posts.push(call.data)
      return { id: 'new-price' }
    }
    if (call.path === '/core/settings/invite-reward') return { amount: '5.0000' }
    return {}
  })
  h.session(user)
  return { h, state }
}

const ROLE_ROW = { versionId: 'v1', taskId: '20', payeeId: 'role:creator', payeeRole: 'creator', price: '2.0000', priceStatus: 'published', startDay: '2026-01-01', endDay: null, payerKind: 'agency', payerId: '1', relationType: 'agency_creator' }
const MEMBER_ROW = { versionId: 'v2', taskId: '20', payeeId: '3', price: '3.0000', priceStatus: 'draft', startDay: '2026-01-01', endDay: null, payerKind: 'agency', payerId: '1', relationType: 'agency_creator' }

test('admin uses canonical individual payees with role suffix', async () => {
  const { h } = setup(ADMIN)
  const page = h.page('prices')
  await page.onShow()

  assert.equal(page.data.payees.some(p=>p.payeeRole),false)
  assert.equal(page.data.payees[0].displayName, '团长乙（团长）')
  assert.ok(page.data.payees.some(p => p.displayName === '达人甲（达人）'))
  assert.equal(h.calls.some(c=>c.path.includes('invite-reward')),false)
})

test('leader can price only individual members of their team', async () => {
  const { h } = setup(LEADER)
  const page = h.page('prices')
  await page.onShow()

  const groupRoles = page.data.payees.filter(p => p.payeeRole).map(p => p.payeeRole)
  // VM 沙箱里产生的数组原型与测试域不同，deepEqual 会误报，按值比较
  assert.equal(groupRoles.join(','), '')
  assert.ok(page.data.payees.some(p => p.displayName === '达人丙（达人）'), '团长只看到自己的达人')
  assert.ok(!page.data.payees.some(p => p.displayName === '达人甲（达人）'), '看不到别的达人')
})

test('individual pricing submits the canonical payee ID', async () => {
  const { h, state } = setup(ADMIN)
  const page = h.page('prices')
  await page.onShow()
  page.setData({
    taskIndex: 0,
    payeeIndex: 1, // 全部达人（全局统一价）
    form: { unitPrice: '2', from: '2026-10-01', to: '', reason: '全局调价' },
  })

  await page.create()

  assert.equal(state.posts.length, 1)
  assert.equal(state.posts[0].payeeRole, undefined)
  assert.equal(state.posts[0].payeeId, '3')
  assert.ok(state.posts[0].requestKey)
})

test('list is split into role-level and member-level sections', async () => {
  const { h } = setup(ADMIN, [ROLE_ROW, MEMBER_ROW])
  const page = h.page('prices')
  await page.onShow()

  assert.equal(page.data.roleList.length, 1)
  assert.equal(page.data.roleList[0].payeeName, '全部达人（全局）')
  assert.equal(page.data.memberList.length, 1)
  assert.equal(page.data.memberList[0].payeeName, '达人甲')
})
