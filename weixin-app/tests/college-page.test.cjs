const test = require('node:test')
const assert = require('node:assert/strict')
const { harness, deferred } = require('./harness.cjs')

/**
 * 学院页（pages/college）前端契约：
 *   - 按后端返回的 tiers 渲染，课程封面为空时按级别映射本地占位图
 *   - 点课程加载详情并打开弹层；失败有提示
 */

const CREATOR = { id: '3', role: 'creator', parentId: '2' }

function setup(coursesData) {
  const state = { toasts: [] }
  const h = harness(call => {
    if (call.path === '/modules/zhihu/courses') return coursesData
    if (call.path === '/modules/zhihu/courses/c1')
      return { id: 'c1', tier: 'silver', title: '入门课', intro: '简介', duration: '6 分钟', views: 10, sections: [{ title: '第一节', content: '内容' }] }
    return {}
  })
  h.wx.showToast = options => {
    state.toasts.push((options && options.title) || '')
    if (options && options.complete) options.complete()
  }
  h.session(CREATOR)
  return { h, state }
}

const DATA = {
  total: 2,
  tiers: [
    { key: 'silver', title: '白银课程', subtitle: '入门', courses: [
      { id: 'c1', tier: 'silver', title: '入门课', cover: '', intro: '简介', duration: '6 分钟', views: 10 },
    ] },
    { key: 'gold', title: '黄金课程', subtitle: '进阶', courses: [
      { id: 'c2', tier: 'gold', title: '进阶课', cover: 'https://cdn.example.com/x.png', intro: '简介', duration: '9 分钟', views: 5 },
    ] },
    { key: 'elite', title: '卓越课程', subtitle: '高级', courses: [] },
  ],
}

test('college renders tiers and maps placeholder covers by tier', async () => {
  const { h } = setup(DATA)
  const page = h.page('college')
  await page.onShow()

  assert.equal(page.data.tiers.length, 3)
  const silver = page.data.tiers[0].courses[0]
  assert.equal(silver.coverSrc, '/images/courses/silver.png', '无封面按级别用本地占位图')
  const gold = page.data.tiers[1].courses[0]
  assert.equal(gold.coverSrc, 'https://cdn.example.com/x.png', '有封面用真实封面')
})

test('college openCourse loads the detail into the modal', async () => {
  const { h } = setup(DATA)
  const page = h.page('college')
  await page.onShow()

  await page.openCourse({ currentTarget: { dataset: { id: 'c1' } } })

  assert.equal(page.data.detail.title, '入门课')
  assert.equal(page.data.detail.sections.length, 1)
  page.closeDetail()
  assert.equal(page.data.detail, null)
})

test('college keeps an empty catalog empty and does not invent learning counts', async () => {
  const { h } = setup({tiers:[],total:0})
  const page=h.page('college'); await page.onShow()
  assert.equal(page.data.tiers.length,0)
  assert.equal(page.data.loading,false)
  const {h:h2}=setup({total:1,tiers:[{key:'1',courses:[{id:'1',title:'项目课',views:null}]}]})
  const other=h2.page('college'); await other.onShow()
  assert.equal(other.data.tiers[0].courses[0].meta,'')
  assert.equal(other.data.tiers[0].courses[0].coverSrc,'/images/courses/silver.png')
})

test('college load failures remain errors instead of looking like an empty catalog', async () => {
  const { h }=setup({http:503,body:{code:50300,message:'课程服务暂不可用'}})
  const page=h.page('college'); await page.onShow()
  assert.equal(page.data.loading,false)
  assert.match(page.data.error,/课程服务暂不可用/)
})

test('college ignores detail responses after leaving the page and reports detail failures', async () => {
  const pending=deferred()
  const h=harness(call=>call.path.endsWith('/courses')?DATA:pending.promise)
  h.session(CREATOR)
  const page=h.page('college'); await page.onShow()
  const opening=page.openCourse({currentTarget:{dataset:{id:'c1'}}})
  page.onHide()
  pending.resolve({id:'c1',title:'迟到详情'})
  await opening
  assert.equal(page.data.detail,null)
  assert.equal(page.data.detailLoading,false)

  const {h:h2,state}=setup(DATA)
  const other=h2.page('college'); await other.onShow()
  h2.wx.cloud.callFunction=options=>options.success({result:{statusCode:404,code:40400,message:'课程已下架'}})
  await other.openCourse({currentTarget:{dataset:{id:'c1'}}})
  assert.equal(other.data.detail,null)
  assert.ok(state.toasts.includes('课程已下架'))
})

test('college project course detail has a cover and can copy its link', async () => {
  const h=harness(call=>call.path.endsWith('/courses')?DATA:{id:'1',url:'https://example.com/course',sections:[]})
  h.session(CREATOR)
  let copied
  h.wx.setClipboardData=options=>{copied=options.data}
  const page=h.page('college');await page.onShow()
  await page.openCourse({currentTarget:{dataset:{id:'1'}}})
  assert.equal(page.data.detail.coverSrc,'/images/courses/silver.png')
  assert.equal(page.data.detail.meta,'')
  page.copyCourseUrl()
  assert.equal(copied,'https://example.com/course')
})
