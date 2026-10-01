const d = require('./domain')

// 新环境（或从未上架过课程的环境）里 opc_courses 集合可能还不存在：
// CloudBase 对不存在的集合查询直接抛错。读路径把它视为「空集合」，
// 让种子课程兜底；其余错误继续抛出（不掩盖真实故障）。
function isCollectionMissing(error) {
  const message = String((error && (error.errMsg || error.message)) || '')
  return /collection/i.test(message) && /not exist|not found|does not exist/i.test(message)
}
async function allCourses(store) {
  try {
    return await store.find('courses', {})
  } catch (error) {
    if (isCollectionMissing(error)) return []
    throw error
  }
}

// CloudBase 不允许写不存在的集合：运营首次上架前主动建集合（已存在则忽略）。
async function ensureCoursesCollection(store) {
  if (!store.db || typeof store.db.createCollection !== 'function') return
  try { await store.db.createCollection('opc_courses') } catch (_) { /* 已存在 */ }
}

// 学院课程：数据存 opc_courses 集合（store.js 已注册）。
// 集合暂无已上架课程时返回内置种子课程，保证页面上线即有内容；
// 运营通过 POST /core/courses 上架真实课程后，列表自动整体切换为数据库数据。
// 课程文档结构：{ id, tier, title, cover, intro, duration, views, sort,
//   sections: [{ title, content }], published, createdAt, updatedAt }
const TIERS = [
  { key: 'silver', title: '白银课程', subtitle: '入门基础 · 从零跑通第一单' },
  { key: 'gold', title: '黄金课程', subtitle: '进阶提升 · 稳定产出与放量' },
  { key: 'elite', title: '卓越课程', subtitle: '高级策略 · 转化与数据驱动' },
]
const TIER_KEYS = TIERS.map(t => t.key)

const SEED = [
  {
    id: 'seed-silver-1', tier: 'silver', title: '认识知乎推广', cover: '',
    intro: '了解知乎关键词推广的基本玩法、结算链路和平台规则', duration: '6 分钟', views: 2191, sort: 1,
    sections: [
      { title: '什么是关键词推广', content: '达人为指定知乎关键词创作内容（文章或视频），用户通过关键词搜索看到你的作品并产生有效行为后，按规则结算收益。' },
      { title: '结算是怎么来的', content: '平台定期导出报表，财务核对后按关键词归因到具体作品与达人，确认开放后即可在钱包申请提现。' },
    ],
  },
  {
    id: 'seed-silver-2', tier: 'silver', title: '领取与提交第一单', cover: '',
    intro: '从领取关键词到提交作品回填的完整操作演示', duration: '8 分钟', views: 1874, sort: 2,
    sections: [
      { title: '领取关键词', content: '在关键词页选择「可领取」的关键词，确认后在规定时间内完成内容发布。' },
      { title: '提交作品回填', content: '发布成功后回到关键词页，点击「立即回填」提交作品链接、发布日期与作品类型，等待审核。' },
    ],
  },
  {
    id: 'seed-silver-3', tier: 'silver', title: '审核常见退回原因', cover: '',
    intro: '链接打不开、关键词不符、发布时间异常等高频问题自查清单', duration: '5 分钟', views: 1523, sort: 3,
    sections: [
      { title: '链接有效性', content: '提交前自己先点开链接确认能正常访问，注意区分文章链接与视频链接。' },
      { title: '内容相关性', content: '作品内容必须与关键词主题直接相关，标题或开头建议自然包含关键词。' },
    ],
  },
  {
    id: 'seed-gold-1', tier: 'gold', title: '爆款标题怎么写', cover: '',
    intro: '高点击率标题的结构模板与避坑指南', duration: '10 分钟', views: 1289, sort: 1,
    sections: [
      { title: '标题结构', content: '数字+痛点+悬念是最稳定的三件套，避免夸大宣传和平台违禁词。' },
      { title: '关键词植入', content: '关键词要自然出现在标题前 15 个字内，生硬堆砌会被判定低质。' },
    ],
  },
  {
    id: 'seed-gold-2', tier: 'gold', title: '稳定产出的工作流', cover: '',
    intro: '从选题库到批量回填，建立每周稳定产出的节奏', duration: '12 分钟', views: 986, sort: 2,
    sections: [
      { title: '选题库', content: '把可领取的关键词按主题分组，提前一周排好发布计划。' },
      { title: '批量回填', content: '多条作品用 xlsx 批量回填，注意每条的平台账号与发布日期要对应准确。' },
    ],
  },
  {
    id: 'seed-elite-1', tier: 'elite', title: '高转化内容策略', cover: '',
    intro: '从曝光到有效行为的转化漏斗拆解与优化方法', duration: '15 分钟', views: 3421, sort: 1,
    sections: [
      { title: '转化漏斗', content: '曝光→点击→有效行为，每一层都有可优化的杠杆：封面、开头、引导语。' },
      { title: '复盘方法', content: '每周对比收益报表中不同关键词的表现，把预算倾斜到高转化主题。' },
    ],
  },
  {
    id: 'seed-elite-2', tier: 'elite', title: '看懂收益报表', cover: '',
    intro: '报表字段口径、异常处理和更正流程的完整说明', duration: '9 分钟', views: 2156, sort: 2,
    sections: [
      { title: '口径说明', content: '已确认金额是财务核对完成的可结算部分；待确认金额在下一期报表核对后更新。' },
      { title: '异常处理', content: '报表异常会进入待核对状态，期间相关款项暂停使用，核对完成后自动恢复。' },
    ],
  },
]

function view(row) {
  return {
    id: row.id, tier: row.tier, title: row.title, cover: row.cover || '',
    intro: row.intro || '', duration: row.duration || '', views: row.views || 0,
  }
}
function detail(row) {
  return Object.assign(view(row), {
    sections: Array.isArray(row.sections) ? row.sections : [],
  })
}
function inputCourse(data, partial) {
  const out = {}
  if (!partial || data.tier !== undefined) {
    if (!TIER_KEYS.includes(data.tier)) d.fail('课程级别不正确')
    out.tier = data.tier
  }
  if (!partial || data.title !== undefined) out.title = d.text(data.title, '课程名称', 64)
  if (!partial || data.intro !== undefined) out.intro = d.text(data.intro, '课程简介', 200)
  if (data.cover !== undefined) out.cover = data.cover ? d.text(data.cover, '封面', 255) : ''
  if (data.duration !== undefined) out.duration = data.duration ? d.text(data.duration, '时长', 32) : ''
  if (data.sections !== undefined) {
    if (!Array.isArray(data.sections) || data.sections.length > 20) d.fail('课程章节不正确')
    out.sections = data.sections.map(s => ({
      title: d.text(s && s.title, '章节标题', 100),
      content: d.text(s && s.content, '章节内容', 5000),
    }))
  }
  if (data.sort !== undefined) {
    const sort = Number(data.sort)
    if (!Number.isInteger(sort) || sort < 0 || sort > 9999) d.fail('排序值不正确')
    out.sort = sort
  }
  if (data.published !== undefined) {
    if (typeof data.published !== 'boolean') d.fail('上下架状态不正确')
    out.published = data.published
  }
  if (!partial) {
    if (out.published === undefined) out.published = true
    if (out.sections === undefined) out.sections = []
    if (out.sort === undefined) out.sort = 0
  }
  return out
}

function register(r) {
  r('GET', '/modules/zhihu/courses', async c => {
    // 种子只在集合完全为空时兜底；只要运营写入过课程（哪怕全部下架）就不再回退
    const all = await allCourses(c.store)
    const rows = all
      .filter(x => x.published !== false)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    const list = all.length ? rows : SEED
    return {
      tiers: TIERS.map(t => Object.assign({}, t, {
        courses: list.filter(x => x.tier === t.key).map(view),
      })),
      total: list.length,
    }
  })
  r('GET', '/modules/zhihu/courses/:id', async c => {
    const id = String(c.params.id)
    let row = null
    try {
      row = await c.store.get('courses', id)
    } catch (error) {
      if (!isCollectionMissing(error)) throw error
    }
    row = row || SEED.find(x => x.id === id) || null
    if (!row || row.published === false) d.fail('课程不存在或已下架', 404)
    return detail(row)
  })
  // 管理接口（暂无小程序 UI，供运营用 API/脚本上架课程）
  r('POST', '/core/courses', async c => {
    d.duty(c.user, 'operations')
    const course = inputCourse(c.data || {}, false)
    await ensureCoursesCollection(c.store)
    return c.store.transaction(async tx => {
      const row = await tx.add('courses', Object.assign({ views: 0, updatedAt: d.now() }, course))
      await tx.audit(c.user, 'course.create', row.id, { title: row.title })
      return view(row)
    })
  })
  r('PATCH', '/core/courses/:id', async c => {
    d.duty(c.user, 'operations')
    const patch = inputCourse(c.data || {}, true)
    if (!Object.keys(patch).length) d.fail('没有需要更新的字段')
    return c.store.transaction(async tx => {
      const row = await tx.get('courses', String(c.params.id))
      if (!row) d.fail('课程不存在', 404)
      const next = Object.assign({}, row, patch, { updatedAt: d.now() })
      await tx.put('courses', row.id, next)
      await tx.audit(c.user, 'course.update', row.id, { title: next.title })
      return view(next)
    })
  })
  r('POST', '/core/courses/:id/status', async c => {
    d.duty(c.user, 'operations')
    if (typeof (c.data || {}).published !== 'boolean') d.fail('上下架状态不正确')
    return c.store.transaction(async tx => {
      const row = await tx.get('courses', String(c.params.id))
      if (!row) d.fail('课程不存在', 404)
      const next = Object.assign({}, row, { published: c.data.published, updatedAt: d.now() })
      await tx.put('courses', row.id, next)
      await tx.audit(c.user, c.data.published ? 'course.publish' : 'course.unpublish', row.id)
      return view(next)
    })
  })
}

module.exports = { register, TIERS, SEED }
