const test = require('node:test')
const assert = require('node:assert/strict')
const { harness, scoped } = require('./harness.cjs')

/**
 * 收益页（pages/income）重做后的行为契约：
 *   - 只展示真实数据：workbench 的 ownReceivable 记录 + 邀请奖励，没有写死的假分类
 *   - 期间筛选：快捷 本月/上月、自定义起止；from > to 被拒绝且不发请求
 *   - 邀请奖励按本期口径前端筛选并重算合计
 */

const CREATOR = { id: '3', role: 'creator' }
const SUMMARY = {
  records: 3,
  orders: '9',
  issues: 0,
  receivable: '35.00',
  confirmedReceivable: '20.00',
  pendingReceivable: '15.00',
  payable: '0',
  confirmedPayable: '0',
  pendingPayable: '0',
  retained: '35.00',
}

function monthRange(offset) {
  const shifted = new Date(Date.now() + 8 * 3600000)
  const month0 = shifted.getUTCMonth() + offset
  const first = new Date(Date.UTC(shifted.getUTCFullYear(), month0, 1))
  const last = new Date(Date.UTC(shifted.getUTCFullYear(), month0 + 1, 0))
  const fmt = d => d.toISOString().slice(0, 10)
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const range = { from: fmt(first), to: fmt(last) }
  if (range.to > today) range.to = today
  return range
}

function setup(options = {}) {
  const state = { workbench: [], toasts: [] }
  const thisMonth = monthRange(0)
  const lastMonth = monthRange(-1)
  const entries = options.entries || [
    { id: 'f1-3', factId: 'f1', keyword: '关键词一', date: thisMonth.from, payeeId: '3', payeeName: '达人甲', amount: '20.00', confirmedAmount: '20.00', pendingAmount: '0', status: 'confirmed', ownReceivable: true, blocked: '' },
    { id: 'f2-3', factId: 'f2', keyword: '关键词二', date: thisMonth.from, payeeId: '3', payeeName: '达人甲', amount: '15.00', confirmedAmount: '0', pendingAmount: '15.00', status: 'draft', ownReceivable: true, blocked: '待审核作品' },
    { id: 'f3-5', factId: 'f3', keyword: '别人的词', date: thisMonth.from, payeeId: '5', payeeName: '团长乙', amount: '99.00', confirmedAmount: '0', pendingAmount: '99.00', status: 'draft', ownReceivable: false, blocked: '' },
  ]
  const invite = options.invite || {
    total: '30.00',
    records: [
      { key: 'r1', title: '邀请好友 · 新人甲', time: thisMonth.from + 'T10:00:00.000Z', amount: '10.00' },
      { key: 'r2', title: '邀请好友 · 新人乙', time: lastMonth.from + 'T10:00:00.000Z', amount: '20.00' },
    ],
  }
  const h = harness(call => {
    const common = scoped(call)
    if (common !== undefined) return common
    if (call.path === '/modules/zhihu/workbench') {
      state.workbench.push(call.data)
      return { entries, groups: [], reviewHash: 'h', summary: SUMMARY, needsReview: false }
    }
    if (call.path === '/modules/zhihu/invite/rewards') return invite
    return {}
  })
  h.wx.showToast = options => {
    state.toasts.push((options && options.title) || '')
    if (options && options.complete) options.complete()
  }
  h.session(CREATOR)
  return { h, state }
}

async function open(options) {
  const built = setup(options)
  const page = built.h.page('income')
  await page.onShow()
  return Object.assign(built, { page })
}

test('income shows the real summary and only my own receivable records', async () => {
  const { page } = await open()
  assert.equal(page.data.summary.receivable, '35.00')
  assert.deepEqual(page.data.records.map(r => r.keyword), ['关键词一', '关键词二'],
    'ownReceivable=false 的记录不得出现在我的收益里')
  assert.equal(page.data.records[0].statusText, '已确认')
  assert.equal(page.data.records[1].statusText, '待确认')
  assert.equal(page.data.records[1].blocked, '待审核作品')
})

test('income has no hardcoded fake category like the old 内容分成', async () => {
  const { page } = await open()
  assert.equal(page.data.categories, undefined, '旧的写死分类结构必须移除')
})

test('income defaults to the current month clamped to today', async () => {
  const { page, state } = await open()
  const range = monthRange(0)
  assert.equal(page.data.from, range.from)
  assert.equal(page.data.to, range.to)
  assert.equal(page.data.quick, 'this')
  assert.equal(state.workbench[0].from, range.from)
  assert.equal(state.workbench[0].to, range.to)
})

test('quickRange prev switches to last month and reloads', async () => {
  const { page, state } = await open()
  await page.quickRange({ currentTarget: { dataset: { q: 'prev' } } })
  const range = monthRange(-1)

  assert.equal(page.data.from, range.from)
  assert.equal(page.data.to, range.to)
  assert.equal(page.data.quick, 'prev')
  assert.equal(state.workbench.at(-1).from, range.from, '必须用上月区间重新请求')
  assert.equal(state.workbench.at(-1).to, range.to)
})

test('quickRange this month clamps the end date to today', async () => {
  const { page, state } = await open()
  await page.quickRange({ currentTarget: { dataset: { q: 'prev' } } })
  await page.quickRange({ currentTarget: { dataset: { q: 'this' } } })
  const range = monthRange(0)

  assert.equal(state.workbench.at(-1).from, range.from)
  assert.equal(state.workbench.at(-1).to, range.to)
  assert.ok(range.to <= new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
    '当月的结束日期不能超过今天')
})

test('dateChange rejects from > to without issuing a request', async () => {
  const { page, state } = await open()
  const before = state.workbench.length
  page.dateChange({ currentTarget: { dataset: { name: 'from' } }, detail: { value: '2999-12-31' } })

  assert.equal(state.workbench.length, before, 'from > to 不得发起请求')
  assert.ok(state.toasts.includes('开始日期不能晚于结束日期'))
  assert.equal(page.data.from, monthRange(0).from, '非法输入不得改动当前区间')
})

test('dateChange with a valid custom range clears the quick flag and reloads', async () => {
  const { page, state } = await open()
  const before = state.workbench.length
  page.dateChange({ currentTarget: { dataset: { name: 'from' } }, detail: { value: '2026-08-01' } })
  await new Promise(resolve => setTimeout(resolve, 20))

  assert.equal(page.data.from, '2026-08-01')
  assert.equal(page.data.quick, '')
  assert.ok(state.workbench.length > before)
  assert.equal(state.workbench.at(-1).from, '2026-08-01')
})

test('income never requests or adds invitation rewards', async () => {
  const h=harness(c=>scoped(c)??{entries:[],summary:{receivable:'0',confirmedReceivable:'0',pendingReceivable:'0'}});
  h.session({id:'3',role:'creator'});const page=h.page('income');await page.onShow();
  assert.equal(h.calls.some(c=>c.path.includes('/invite/')),false);
  assert.equal(page.data.inviteTotal,undefined);
  assert.equal(page.data.summary.receivable,'0.00');
});

test('operations admin sees a guidance state instead of a 403 error', async () => {
  const ops = { id: '5', role: 'admin', adminDuty: 'operations' }
  const h = harness(call => {
    const common = scoped(call)
    if (common !== undefined) return common
    if (call.path === '/modules/zhihu/workbench')
      return { http: 403, body: { code: 40300, message: '当前账号无此操作权限' } }
    if (call.path === '/modules/zhihu/invite/rewards') return { total: '0', records: [] }
    return {}
  })
  h.session(ops)
  const page = h.page('income')
  await page.onShow()

  assert.equal(page.data.restricted, true, 'workbench 403 时必须降级为引导态')
  assert.equal(page.data.error, '', '不得把权限问题显示为页面错误')
  assert.equal(page.data.summary, null)
})
