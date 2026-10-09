const test = require('node:test')
const assert = require('node:assert/strict')
const { harness, scoped } = require('./harness.cjs')

/**
 * 原收益页同步平台收益接口后的行为契约：
 *   - 收益及分页合计来自服务端；拉新/拉活分开，不掺入邀请奖励
 *   - 期间筛选：快捷 本月/上月、自定义起止；from > to 被拒绝且不发请求
 *   - 详情展示本人计算过程、确认历史，岗位和过期请求不会泄露数据
 */

const CREATOR = { id: '3', role: 'creator' }
const SUMMARY = {
  amount:'35.00',confirmedAmount:'20.00',pendingAmount:'15.00',internalAmount:'0',pendingCalculations:0,
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
    if (call.path === '/core/earnings/mine') {
      state.workbench.push(call.data)
      return {list:entries.filter(e=>e.ownReceivable).map((e,i)=>({id:String(i+1),taskName:e.keyword,businessDate:e.date,amount:e.amount,
        confirmedAmount:e.confirmedAmount,pendingAmount:e.pendingAmount,isReady:e.blocked?'0':'1',isInternal:'0',
        confirmedAt:e.status==='confirmed'?'2026-10-09':null,reason:e.blocked,metricType:i?'activation':'new_user',metricLabel:i?'拉活':'拉新',
        quantityUnit:i?'个':'单',quantity:'5',unitPrice:'1.2000',calculationAmount:'6.0000',earningGroup:'self',nextAction:e.nextAction||(e.status==='confirmed'&&e.pendingAmount==='0'?'金额已确认，可查看提现状态':'财务：核对并确认金额')})),
        groups:[{projectId:'1',metricType:'new_user',metricLabel:'拉新',quantity:'5',quantityUnit:'单',amount:'20'}],total:41,summary:SUMMARY}
    }
    if (call.path.endsWith('/history')) return {list:[{amount:'-1.2000',confirmedAt:'2026-10-09'}],total:1};
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
  assert.equal(page.data.records[1].statusText, '平台核对中')
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
  const h=harness(c=>scoped(c)??{list:[],groups:[],total:0,summary:{amount:'0',confirmedAmount:'0',pendingAmount:'0',internalAmount:'0'}});
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
    if (call.path === '/core/earnings/mine')
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
  assert.equal(h.calls.some(c=>c.path==='/core/earnings/mine'),false,'运营端不请求财务数据')
})

test('type/group filters and pagination use the full server summary, never the current page total',async()=>{
  const {h,page,state}=await open();
  h.session({id:'2',role:'leader'});await page.onShow();
  await page.filter({currentTarget:{dataset:{field:'metricType',value:'activation'}}});
  await page.filter({currentTarget:{dataset:{field:'group',value:'team'}}});
  await page.next();
  assert.equal(state.workbench.at(-1).page,2);
  assert.equal(state.workbench.at(-1).metricType,'activation');
  assert.equal(state.workbench.at(-1).group,'team');
  assert.equal(page.data.total,41);assert.equal(page.data.summary.receivable,'35.00');
  await page.quickRange({currentTarget:{dataset:{q:'prev'}}});assert.equal(state.workbench.at(-1).page,1);
  assert.equal(h.calls.some(c=>c.path==='/modules/zhihu/workbench'),false);
});

test('income detail retains backend quantity, price, correction and current confirmed guidance',async()=>{
  const {h,page}=await open();await page.detail({currentTarget:{dataset:{id:'1'}}});
  assert.equal(page.data.selected.priceText,'¥1.2');assert.equal(page.data.selected.calculationText,'¥6.00');
  assert.equal(page.data.selected.nextText,'金额已确认，可查看提现状态');
  assert.equal(page.data.history[0].amountText,'¥-1.20');
  assert.equal(h.calls.at(-1).path,'/core/earnings/1/history');
  page.keyword();assert.match(h.navigation.at(-1),/keywords\/index\?search=/);
  const p=h.page('keywords');p.onLoad({search:encodeURIComponent('关键词一')});assert.equal(p.data.search,'关键词一');
});

test('late history requests cannot overwrite another selected earning or a cleared session',async()=>{
  const {h,page}=await open();let complete;
  const request=h.load('utils/request'),old=request.get;
  request.get=(url,data)=>url.endsWith('/1/history')?new Promise(r=>complete=r):old(url,data);
  const pending=page.detail({currentTarget:{dataset:{id:'1'}}});
  await page.detail({currentTarget:{dataset:{id:'2'}}});
  complete({list:[{amount:'999.0000'}],total:1});await pending;
  assert.equal(page.data.selected.id,'2');assert.equal(page.data.history[0].amountText,'¥-1.20');
  const again=page.detail({currentTarget:{dataset:{id:'1'}}});page.onHide();
  complete({list:[{amount:'888.0000'}],total:1});await again;assert.equal(page.data.history.length,0);
});

test('decimal formatting preserves null, exact rounding and values beyond Number precision',()=>{
  const {money,units}=require('../miniprogram/utils/amount');
  assert.equal(money(null),'待计算');assert.equal(money('0'),'0.00');assert.equal(money('1.0050'),'1.01');
  assert.equal(money('-0.0050'),'-0.01');assert.equal(money('9007199254740993.9950'),'9007199254740994.00');
  assert.ok(units('10.0001')>units('10.0000'));
});

test('confirmed original with a new delta keeps server follow-up and marks only the delta pending',async()=>{
 const {page}=await open({entries:[{id:'f1',keyword:'已更正',date:'2026-10-09',amount:'7.2000',confirmedAmount:'6.0000',pendingAmount:'1.2000',status:'confirmed',ownReceivable:true,blocked:'',nextAction:'财务：核对本次差额'}]});
 assert.equal(page.data.records[0].statusText,'差额待确认');assert.equal(page.data.records[0].nextText,'财务：核对本次差额');assert.equal(page.data.records[0].confirmedText,'¥6.00');assert.equal(page.data.records[0].pendingText,'¥1.20');
});
