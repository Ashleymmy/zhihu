const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, scope } = require('./cloud-fixture.cjs')

/**
 * 学院课程后端契约：
 *   - 集合为空时返回内置种子课程（页面上线即有内容）
 *   - 运营上架真实课程后整体切换为数据库数据，种子不再出现
 *   - 上下架、详情 404、写操作权限与字段校验
 */

test('courses list falls back to seed data while the collection is empty', async () => {
  const f = await fixture()
  const token = await f.login('creator')
  const res = await f.call(token, 'GET', '/modules/zhihu/courses')
  assert.equal(res.code, 0, res.message)
  assert.equal(res.data.tiers.length, 3)
  assert.ok(res.data.total >= 7)
  const silver = res.data.tiers.find(t => t.key === 'silver')
  assert.ok(silver.courses.length >= 3)
  assert.ok(silver.subtitle, '种子要带分级副标题')
  assert.ok(silver.courses.every(c => c.coverSrc === undefined), '后端不拼前端占位图')
})

test('seed course detail returns sections; unknown id returns 404', async () => {
  const f = await fixture()
  const token = await f.login('creator')
  const list = await f.call(token, 'GET', '/modules/zhihu/courses')
  const first = list.data.tiers[0].courses[0]

  const detail = await f.call(token, 'GET', '/modules/zhihu/courses/' + first.id)
  assert.equal(detail.code, 0)
  assert.ok(Array.isArray(detail.data.sections) && detail.data.sections.length >= 1)

  const missing = await f.call(token, 'GET', '/modules/zhihu/courses/nope')
  assert.equal(missing.statusCode, 404)
})

test('operations admin can create a course and the list switches to database data', async () => {
  const f = await fixture()
  const ops = await f.login('operations')
  const created = await f.call(ops, 'POST', '/core/courses', {
    tier: 'gold',
    title: '真实课程',
    intro: '运营上架的第一门课',
    duration: '20 分钟',
    sections: [{ title: '第一节', content: '内容' }],
  })
  assert.equal(created.code, 0, created.message)
  assert.ok(created.data.id)

  const list = await f.call(ops, 'GET', '/modules/zhihu/courses')
  assert.equal(list.data.total, 1, '有真实课程后种子整体退出')
  assert.equal(list.data.tiers.find(t => t.key === 'gold').courses[0].title, '真实课程')
  assert.equal(list.data.tiers.find(t => t.key === 'silver').courses.length, 0)
})

test('course writes reject non-operations users and bad payloads', async () => {
  const f = await fixture()
  const creator = await f.login('creator')
  const denied = await f.call(creator, 'POST', '/core/courses', { tier: 'gold', title: 'x', intro: 'y' })
  assert.equal(denied.statusCode, 403)

  const finance = await f.login('finance')
  const wrongDuty = await f.call(finance, 'POST', '/core/courses', { tier: 'gold', title: 'x', intro: 'y' })
  assert.equal(wrongDuty.statusCode, 403, '财务管理员也不能管课程')

  const ops = await f.login('operations')
  const badTier = await f.call(ops, 'POST', '/core/courses', { tier: 'diamond', title: 'x', intro: 'y' })
  assert.equal(badTier.statusCode, 422)
  const noTitle = await f.call(ops, 'POST', '/core/courses', { tier: 'gold', intro: 'y' })
  assert.equal(noTitle.statusCode, 422)
})

test('course patch and unpublish hide it from the list without seed fallback', async () => {
  const f = await fixture()
  const ops = await f.login('operations')
  const created = await f.call(ops, 'POST', '/core/courses', { tier: 'elite', title: '旧标题', intro: '简介' })

  const patched = await f.call(ops, 'PATCH', '/core/courses/' + created.data.id, { title: '新标题' })
  assert.equal(patched.data.title, '新标题')

  const hidden = await f.call(ops, 'POST', '/core/courses/' + created.data.id + '/status', { published: false })
  assert.equal(hidden.code, 0)

  const list = await f.call(ops, 'GET', '/modules/zhihu/courses')
  assert.equal(list.data.total, 0, '全部下架后列表为空，而不是回退到种子')

  const detail = await f.call(ops, 'GET', '/modules/zhihu/courses/' + created.data.id)
  assert.equal(detail.statusCode, 404, '已下架课程详情不可见')
})

// 新环境（未来的正式生产环境）里 opc_courses / opc_invite_rewards 集合还不存在，
// CloudBase 对不存在的集合查询直接抛错。读路径必须按空集合兜底，不能 500。
test('courses list and invite rewards survive missing collections', async () => {
  const f = await fixture()
  const missing = () => Object.assign(new Error('database collection not exists'), { errCode: -502001 })
  const origFind = f.store.find.bind(f.store)
  const origGet = f.store.get.bind(f.store)
  f.store.find = (name, where, options) =>
    name === 'courses' || name === 'invite_rewards' ? Promise.reject(missing()) : origFind(name, where, options)
  f.store.get = (name, id) =>
    name === 'courses' ? Promise.reject(missing()) : origGet(name, id)

  const token = await f.login('creator')
  const list = await f.call(token, 'GET', '/modules/zhihu/courses')
  assert.equal(list.code, 0, '集合缺失时种子课程兜底：' + list.message)
  assert.ok(list.data.total >= 7)

  const detail = await f.call(token, 'GET', '/modules/zhihu/courses/seed-silver-1')
  assert.equal(detail.code, 0, '集合缺失时种子详情可见')

  const rewards = await f.call(token, 'GET', '/modules/zhihu/invite/rewards', scope)
  assert.equal(rewards.code, 0, '邀请奖励集合缺失时按无记录处理：' + rewards.message)
  assert.deepEqual(rewards.data.records, [])
})
