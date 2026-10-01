const test = require('node:test')
const assert = require('node:assert/strict')
const { harness } = require('./harness.cjs')

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
