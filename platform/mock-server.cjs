// ─────────────────────────────────────────────────────────────────────────────
// Mock BFF  —  仅供前端开发预览，无需真实后端
// 使用方法: node mock-server.js
// 前端访问: http://localhost:5174  (登录账号/密码随意输)
// ─────────────────────────────────────────────────────────────────────────────
const http = require('http')
const PORT = 3000
const BASE = '/api/v1'

// ── Mock 数据 ────────────────────────────────────────────────────────────────
const USER = {
  id: '100000000000000001', nickname: 'JT', avatar: '',
  role: 'boss', parent_id: null, zhihu_uid: null,
}

const d = (offset) => {
  const t = new Date(); t.setDate(t.getDate() + offset)
  return t.toISOString().slice(0, 10)
}

const TREND = Array.from({ length: 7 }, (_, i) => ({
  date: d(i - 6),
  impressions: Math.round(80000 + Math.sin(i) * 30000 + 60000),
  clicks:      Math.round(3200  + Math.sin(i) * 1200  + 2000),
  conversions: Math.round(320   + Math.sin(i) * 120   + 200),
  spend:       Math.round(480000 + Math.sin(i) * 120000 + 80000),
  earnings:    Math.round(120000 + Math.sin(i) * 30000  + 20000),
}))

const CHANNELS = [
  { id: 'ch001', zhihu_channel_id: 'z001', name: '知乎信息流-A', owner_id: USER.id, owner_name: USER.nickname, created_at: '2026-07-01T00:00:00Z' },
  { id: 'ch002', zhihu_channel_id: 'z002', name: '知乎信息流-B', owner_id: USER.id, owner_name: USER.nickname, created_at: '2026-07-01T00:00:00Z' },
]

const PLANS = [
  { id: 'plan001', channel_id: 'ch001', channel_name: '知乎信息流-A', keyword: '夸克网盘',   zhihu_plan_id: 'zp001', status: 'active',  sync_status: 'synced', daily_budget: 50000, start_date: '2026-07-01', end_date: null,         owner_id: USER.id, owner_name: USER.nickname, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
  { id: 'plan002', channel_id: 'ch001', channel_name: '知乎信息流-A', keyword: '番茄小说',   zhihu_plan_id: 'zp002', status: 'active',  sync_status: 'synced', daily_budget: 30000, start_date: '2026-07-10', end_date: null,         owner_id: USER.id, owner_name: USER.nickname, created_at: '2026-07-10T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
  { id: 'plan003', channel_id: 'ch002', channel_name: '知乎信息流-B', keyword: '红果短剧',   zhihu_plan_id: null,    status: 'paused',  sync_status: 'local',  daily_budget: 20000, start_date: '2026-07-20', end_date: null,         owner_id: USER.id, owner_name: USER.nickname, created_at: '2026-07-20T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
  { id: 'plan004', channel_id: 'ch002', channel_name: '知乎信息流-B', keyword: '得物APP',    zhihu_plan_id: 'zp003', status: 'ended',   sync_status: 'synced', daily_budget: 15000, start_date: '2026-06-01', end_date: '2026-07-31', owner_id: USER.id, owner_name: USER.nickname, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-07-31T00:00:00Z' },
]

const COMPS = [
  { id: 'comp001', plan_id: 'plan001', keyword: '夸克网盘', channel_id: 'ch001', channel_name: '知乎信息流-A', zhihu_task_id: 'zt001', status: 'approved',  assignee_id: 'u002', assignee_name: '达人小王', content_url: 'https://www.zhihu.com/question/123456', callback_at: '2026-08-05T10:00:00Z', created_at: '2026-07-15T00:00:00Z', updated_at: '2026-08-05T00:00:00Z' },
  { id: 'comp002', plan_id: 'plan001', keyword: '夸克网盘', channel_id: 'ch001', channel_name: '知乎信息流-A', zhihu_task_id: null,    status: 'pending',   assignee_id: 'u003', assignee_name: '达人小李', content_url: null,                                               callback_at: null,                    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
  { id: 'comp003', plan_id: 'plan002', keyword: '番茄小说', channel_id: 'ch001', channel_name: '知乎信息流-A', zhihu_task_id: 'zt002', status: 'submitted', assignee_id: 'u002', assignee_name: '达人小王', content_url: 'https://www.zhihu.com/question/234567',             callback_at: null,                    created_at: '2026-07-25T00:00:00Z', updated_at: '2026-08-04T00:00:00Z' },
  { id: 'comp004', plan_id: 'plan002', keyword: '番茄小说', channel_id: 'ch001', channel_name: '知乎信息流-A', zhihu_task_id: null,    status: 'rejected',  assignee_id: 'u004', assignee_name: '达人小张', content_url: null,                                               callback_at: null,                    created_at: '2026-07-28T00:00:00Z', updated_at: '2026-08-03T00:00:00Z' },
  { id: 'comp005', plan_id: 'plan003', keyword: '红果短剧', channel_id: 'ch002', channel_name: '知乎信息流-B', zhihu_task_id: null,    status: 'accepted',  assignee_id: 'u003', assignee_name: '达人小李', content_url: null,                                               callback_at: null,                    created_at: '2026-08-02T00:00:00Z', updated_at: '2026-08-02T00:00:00Z' },
]

const EARNINGS = [
  { id: 'earn001', date: '2026-08-05', plan_id: 'plan001', keyword: '夸克网盘', channel_id: 'ch001', channel_name: '知乎信息流-A', owner_id: USER.id, owner_name: USER.nickname, amount: 12480, status: 'settled' },
  { id: 'earn002', date: '2026-08-04', plan_id: 'plan001', keyword: '夸克网盘', channel_id: 'ch001', channel_name: '知乎信息流-A', owner_id: USER.id, owner_name: USER.nickname, amount:  9600, status: 'settled' },
  { id: 'earn003', date: '2026-08-04', plan_id: 'plan002', keyword: '番茄小说', channel_id: 'ch001', channel_name: '知乎信息流-A', owner_id: USER.id, owner_name: USER.nickname, amount:  8320, status: 'pending' },
  { id: 'earn004', date: '2026-08-03', plan_id: 'plan003', keyword: '红果短剧', channel_id: 'ch002', channel_name: '知乎信息流-B', owner_id: USER.id, owner_name: USER.nickname, amount:  3880, status: 'locked'  },
  { id: 'earn005', date: '2026-08-02', plan_id: 'plan002', keyword: '番茄小说', channel_id: 'ch001', channel_name: '知乎信息流-A', owner_id: USER.id, owner_name: USER.nickname, amount:  6240, status: 'settled' },
]

const TEAM = [
  { id: 'u001', nickname: 'JT',       avatar: '', role: 'leader', parent_id: null,   plan_count: 3, total_earnings: 450000, created_at: '2026-01-01T00:00:00Z' },
  { id: 'u002', nickname: '达人小王', avatar: '', role: 'member', parent_id: 'u001', plan_count: 2, total_earnings: 210000, created_at: '2026-03-15T00:00:00Z' },
  { id: 'u003', nickname: '达人小李', avatar: '', role: 'member', parent_id: 'u001', plan_count: 1, total_earnings:  98000, created_at: '2026-04-20T00:00:00Z' },
  { id: 'u004', nickname: '达人小张', avatar: '', role: 'member', parent_id: 'u001', plan_count: 1, total_earnings:  54000, created_at: '2026-05-10T00:00:00Z' },
]

// ── 工具函数 ─────────────────────────────────────────────────────────────────
const ok   = (data)  => ({ code: 'OK', data })
const page = (items) => ok({ items, total: items.length, page: 1, page_size: 50 })

function readBody(req) {
  return new Promise(resolve => {
    let buf = ''
    req.on('data', c => buf += c)
    req.on('end', () => { try { resolve(JSON.parse(buf)) } catch { resolve({}) } })
  })
}
function send(res, payload, status = 200) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  })
  res.end(body)
}

// ── 路由 ─────────────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const url    = req.url.split('?')[0]
  const method = req.method

  if (method === 'OPTIONS') return send(res, {})

  console.log(`${method.padEnd(7)} ${url}`)

  // ── Auth
  if (method === 'POST' && url === `${BASE}/auth/login`)
    return send(res, ok({ token: 'mock-dev-token', user: USER }))
  if (method === 'GET'  && url === `${BASE}/auth/me`)
    return send(res, ok(USER))
  if (method === 'POST' && url === `${BASE}/auth/logout`)
    return send(res, ok(null))

  // ── Meta
  if (method === 'GET' && url === `${BASE}/meta/enums`)
    return send(res, ok({
      plan_status:     [{ value:'active',label:'投放中' },{ value:'paused',label:'暂停' },{ value:'ended',label:'已结束' },{ value:'draft',label:'草稿' }],
      task_status:     [{ value:'pending',label:'待处理' },{ value:'accepted',label:'已接受' },{ value:'submitted',label:'已提交' },{ value:'approved',label:'审核通过' },{ value:'rejected',label:'审核拒绝' }],
      sync_status:     [{ value:'local',label:'本地' },{ value:'synced',label:'已同步' },{ value:'failed',label:'同步失败' }],
      earnings_status: [{ value:'settled',label:'已结算' },{ value:'pending',label:'待结算' },{ value:'locked',label:'已锁定' }],
    }))

  // ── Channels
  if (method === 'GET' && url === `${BASE}/channels`)
    return send(res, ok(CHANNELS))

  // ── Plans
  if (method === 'GET'  && url === `${BASE}/plans`)          return send(res, page(PLANS))
  if (method === 'POST' && url === `${BASE}/plans`) {
    const b = await readBody(req)
    const p = { id:'plan'+Date.now(), zhihu_plan_id:null, status:'active', sync_status:'local', end_date:null, owner_id:USER.id, owner_name:USER.nickname, channel_name: CHANNELS.find(c=>c.id===b.channel_id)?.name??'—', created_at:new Date().toISOString(), updated_at:new Date().toISOString(), ...b }
    PLANS.push(p); return send(res, ok(p))
  }
  if (method === 'POST'  && url === `${BASE}/plans/check-keyword`)
    return send(res, ok({ available: true }))
  if (method === 'PATCH' && url.startsWith(`${BASE}/plans/`)) {
    const id = url.split('/').pop(); const b = await readBody(req)
    const p  = PLANS.find(p => p.id === id)
    if (p) Object.assign(p, b, { updated_at: new Date().toISOString() })
    return send(res, ok(p ?? {}))
  }
  if (method === 'GET' && url.startsWith(`${BASE}/plans/`))
    return send(res, ok(PLANS[0]))

  // ── Metrics
  if (method === 'GET' && url === `${BASE}/metrics/overview`)
    return send(res, ok({ total_impressions:902000, total_clicks:35200, total_conversions:3852, total_spend:5948000, total_earnings:1842000, ctr:0.039, cvr:0.109, cpc:169 }))
  if (method === 'GET' && url === `${BASE}/metrics/trend`)
    return send(res, ok(TREND))
  if (method === 'GET' && url === `${BASE}/metrics/by-keyword`)
    return send(res, page([
      { keyword:'夸克网盘', plan_id:'plan001', channel_name:'知乎信息流-A', impressions:480000, clicks:18600, conversions:2040, spend:3140000, earnings:980000, ctr:0.039, cvr:0.110 },
      { keyword:'番茄小说', plan_id:'plan002', channel_name:'知乎信息流-A', impressions:280000, clicks:11200, conversions:1200, spend:1890000, earnings:570000, ctr:0.040, cvr:0.107 },
      { keyword:'红果短剧', plan_id:'plan003', channel_name:'知乎信息流-B', impressions:142000, clicks: 5400, conversions: 612, spend: 918000, earnings:292000, ctr:0.038, cvr:0.113 },
    ]))

  // ── Compositions
  if (method === 'GET'  && url === `${BASE}/compositions`) return send(res, page(COMPS))
  if (method === 'POST' && url === `${BASE}/compositions`) {
    const b = await readBody(req)
    const plan = PLANS.find(p => p.id === b.plan_id)
    const c = { id:'comp'+Date.now(), keyword:plan?.keyword??'—', channel_id:plan?.channel_id??'', channel_name:plan?.channel_name??'—', zhihu_task_id:null, status:'pending', content_url:null, callback_at:null, created_at:new Date().toISOString(), updated_at:new Date().toISOString(), ...b }
    COMPS.push(c); return send(res, ok(c))
  }
  if (method === 'PATCH' && url.startsWith(`${BASE}/compositions/`)) {
    const id = url.split('/').pop(); const b = await readBody(req)
    const c  = COMPS.find(c => c.id === id)
    if (c) Object.assign(c, b, { updated_at: new Date().toISOString() })
    return send(res, ok(c ?? {}))
  }

  // ── Earnings
  if (method === 'GET' && url === `${BASE}/earnings/summary`)
    return send(res, ok({ settled:220800, pending:83200, locked:38800, total:342800 }))
  if (method === 'GET' && url === `${BASE}/earnings`) return send(res, page(EARNINGS))

  // ── Team
  if (method === 'GET'  && url === `${BASE}/team/members`) return send(res, ok(TEAM))
  if (method === 'POST' && url === `${BASE}/team/members`) {
    const b = await readBody(req)
    const m = { id:'u'+Date.now(), avatar:'', plan_count:0, total_earnings:0, parent_id:null, created_at:new Date().toISOString(), ...b }
    TEAM.push(m); return send(res, ok(m))
  }
  if (method === 'PATCH' && url.startsWith(`${BASE}/team/members/`)) {
    const id = url.split('/').pop(); const b = await readBody(req)
    const m  = TEAM.find(m => m.id === id)
    if (m) Object.assign(m, b)
    return send(res, ok(m ?? {}))
  }
  if (method === 'DELETE' && url.startsWith(`${BASE}/team/members/`)) {
    const id  = url.split('/').pop()
    const idx = TEAM.findIndex(m => m.id === id)
    if (idx >= 0) TEAM.splice(idx, 1)
    return send(res, ok(null))
  }

  // ══════════════════════════════════════════════════════════════
  // ── 知乎联盟接口  /api/alliance/api/...
  // ══════════════════════════════════════════════════════════════
  const AL = '/alliance/api'
  const aok  = (data) => ({ success: true,  data })
  const apg  = (items) => ({ success: true, data: items, pagination: { total: items.length, offset: 0, limit: 50 } })

  // 渠道
  if (method === 'GET' && url === `${AL}/get_agent_channels`)
    return send(res, aok([
      { channel_id: 'ch001', channel_name: '知乎信息流-A' },
      { channel_id: 'ch002', channel_name: '知乎信息流-B' },
    ]))
  if (method === 'GET' && url === `${AL}/second_channels`)
    return send(res, apg([
      { channel_id: 'sch001', channel_name: '二代渠道-1' },
      { channel_id: 'sch002', channel_name: '二代渠道-2' },
    ]))

  // 推广任务
  if (method === 'GET' && url === `${AL}/popularize_tasks`)
    return send(res, apg([
      { id: 'task001', task_name: '夸克网盘KOC推广任务', product_name: '夸克网盘', status: '开启', pay_caliber: '激活有效', expiry_time: '2026-12-31 23:59:59' },
      { id: 'task002', task_name: '番茄小说KOC推广任务', product_name: '番茄小说', status: '开启', pay_caliber: '注册有效', expiry_time: '2026-12-31 23:59:59' },
      { id: 'task003', task_name: '红果短剧KOC推广任务', product_name: '红果短剧', status: '暂停', pay_caliber: '付费有效', expiry_time: '2026-10-31 23:59:59' },
    ]))

  // 推广计划
  if (method === 'POST' && url === `${AL}/popularize_plan`)
    return send(res, aok({ plan_id: 'plan' + Date.now() }))
  if (method === 'POST' && url === `${AL}/popularize_plans`)
    return send(res, aok({ batch_task_id: 'batch' + Date.now() }))

  // 推广作品
  if (method === 'GET' && url === `${AL}/popularize_compositions`)
    return send(res, apg([
      { keyword:'夸克网盘', composition_id:'comp' + Date.now(), composition_url:'https://www.zhihu.com/question/123456', category1:'科技', category2:'工具', submit_time:'2026-08-01 10:00:00', popularize_channel:'知乎', audit_status:1 },
    ]))
  if (method === 'POST' && url === `${AL}/popularize_composition/v2`)
    return send(res, aok({ composition_id: 'comp' + Date.now() }))
  if (method === 'POST' && url === `${AL}/popularize_compositions/v2`)
    return send(res, aok({ batch_task_id: 'batch' + Date.now() }))
  if (method === 'PUT' && url.startsWith(`${AL}/popularize_composition/v2/`))
    return send(res, aok(null))

  // 批量任务结果（永远返回 blob 模拟）
  if (method === 'GET' && url.startsWith(`${AL}/get_batch_task_result/`)) {
    // 返回一个假的 Excel 文本，让轮询可以结束
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename=result.xlsx' })
    return res.end(Buffer.from('mock-excel'))
  }

  // 实时数据
  if (method === 'GET' && url === `${AL}/data_report/real_time_data`)
    return send(res, { success: true, time_range: '2026-08-06 00:00 ~ 06:00', data: [
      { keyword:'夸克网盘', channel_name:'知乎信息流-A', fields_data:{ search_num:12400, order_num:186, created_at:'2026-08-06 05:00:00' } },
      { keyword:'番茄小说', channel_name:'知乎信息流-A', fields_data:{ search_num:9800,  order_num:143, created_at:'2026-08-06 05:00:00' } },
      { keyword:'红果短剧', channel_name:'知乎信息流-B', fields_data:{ search_num:5300,  order_num:72,  created_at:'2026-08-06 05:00:00' } },
    ]})

  // 榜单
  if (method === 'GET' && url === `${AL}/vip/content/rule/labels`)
    return send(res, [
      { id:'r001', name:'年度口碑书单', type:1 },
      { id:'r002', name:'高分推荐书单', type:2 },
      { id:'r003', name:'新锐作者书单', type:1 },
    ])
  if (method === 'GET' && url === `${AL}/vip/rule_contents`)
    return send(res, apg([
      { content_id:'c001', title:'被遗忘的科学家',  content_type:'文章', category:'科学', theme:'人物传记' },
      { content_id:'c002', title:'未来城市的构想',  content_type:'回答', category:'科技', theme:'城市规划' },
      { content_id:'c003', title:'量子纠缠的误解',  content_type:'文章', category:'物理', theme:'科普' },
    ]))
  if (method === 'GET' && url.startsWith(`${AL}/vip/rule_content/`))
    return send(res, aok({ title:'被遗忘的科学家', word_count:4800, public_at:'2026-07-15 10:00:00', section_url:'https://www.zhihu.com/question/mockdetail' }))
  if (method === 'GET' && url === `${AL}/online_sections`)
    return send(res, aok([
      { section_title:'量子计算机的现状与未来', well_title:'前沿科技合辑', author:'量子研究员', hot_value:9800, topic:'科技', created_at:'2026-08-05' },
      { section_title:'城市规划中的人文主义', well_title:'城市生活思考', author:'城市观察者', hot_value:7200, topic:'人文', created_at:'2026-08-04' },
    ]))

  // 有声书
  if (method === 'GET' && url === `${AL}/vip/audio/contents`)
    return send(res, apg([
      { section_id:'a001', title:'三体（有声版）',     content_type:'科幻', episodes:66, topic:'科幻文学' },
      { section_id:'a002', title:'人类简史（精讲版）', content_type:'历史', episodes:24, topic:'历史人文' },
      { section_id:'a003', title:'月亮和六便士',       content_type:'文学', episodes:18, topic:'世界名著' },
    ]))
  if (method === 'GET' && url.startsWith(`${AL}/vip/audio/`) && url.endsWith('/download'))
    return send(res, aok({ url: 'https://example.com/mock-audio.mp3' }))

  // 截流举报
  if (method === 'GET' && url === `${AL}/intercept_words`)
    return send(res, apg([
      { keyword:'夸克网盘', channel:'知乎信息流-A', status:1, valided_at:'' },
      { keyword:'免费网盘', channel:'知乎信息流-B', status:2, valided_at:'2026-08-03 10:00:00' },
    ]))
  if (method === 'POST' && url === `${AL}/intercept_words`)
    return send(res, aok(null))

  // 风险词
  if (method === 'GET' && url === `${AL}/risk_words`)
    return send(res, apg([
      { keyword:'免费送大礼', risk_type:1, channel:'知乎信息流-A', status:1, valided_at:'' },
      { keyword:'转发自X文章', risk_type:2, channel:'知乎信息流-B', status:2, valided_at:'2026-08-02 12:00:00' },
    ]))
  if (method === 'POST' && url === `${AL}/risk_words`)
    return send(res, aok(null))

  // 漫剧
  if (method === 'GET' && url === `${AL}/comic_dramas`)
    return send(res, apg([
      { id:'d001', title:'从零开始的异世界生活', tab_artwork:'' },
      { id:'d002', title:'斗破苍穹',             tab_artwork:'' },
      { id:'d003', title:'完美世界',             tab_artwork:'' },
    ]))
  if (method === 'GET' && url.match(new RegExp(`^${AL}/comic_drama/[^/]+/episodes$`)))
    return send(res, apg([
      { id:'e001', title:'第1集：归来', is_pay:false, video_url:'https://example.com/v1', douyin_video_url:'' },
      { id:'e002', title:'第2集：觉醒', is_pay:false, video_url:'https://example.com/v2', douyin_video_url:'' },
      { id:'e003', title:'第3集：对决', is_pay:true,  video_url:'https://example.com/v3', douyin_video_url:'' },
    ]))

  // 内容标签
  if (method === 'GET' && url === `${AL}/content_tag`)
    return send(res, aok({ '兴趣':['科技','人工智能'], '一级领域':'科技互联网', '内容等级':'优质内容' }))
  if (method === 'POST' && url === `${AL}/content_tags`)
    return send(res, aok({ batch_task_id: 'batch' + Date.now() }))

  // 图片上传（mock）
  if (method === 'POST' && url === `${AL}/basic/file_upload`)
    return send(res, aok({ file_token: 'tok_' + Date.now(), file_url: 'https://example.com/mock-image.jpg' }))

  // ── fallback
  send(res, ok(null))

}).listen(PORT, () => {
  console.log('\n  ✅  Mock BFF 已启动')
  console.log(`  ┌─ 服务地址:  http://localhost:${PORT}`)
  console.log(`  ├─ 前端地址:  http://localhost:5174`)
  console.log(`  └─ 登录账号/密码: 随意输入即可\n`)
})