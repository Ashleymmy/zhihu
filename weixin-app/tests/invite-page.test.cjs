const test = require('node:test')
const assert = require('node:assert/strict')
const { harness, scoped } = require('./harness.cjs')

/**
 * 邀请好友页（pages/invite）契约：
 *   - 展示 invite/me 的邀请码与统计、invite/rewards 的奖励记录
 *   - 金额两位小数；分享路径携带邀请码
 *   - 注册页支持 URL 参数预填邀请码
 */

const CREATOR = { id: '3', role: 'creator', parentId: '2' }

function setup() {
  const h = harness(call => {
    const common = scoped(call)
    if (common !== undefined) return common
    if (call.path === '/modules/zhihu/invite/me')
      return { code: 'ABCD1234', total: '10.0000', usageCount: 2 }
    if (call.path === '/modules/zhihu/invite/rewards')
      return {
        total: '10.0000',
        records: [
          { key: 'r1', title: '邀请好友 · 新人甲', time: '2026-09-20T02:00:00.000Z', amount: '5.0000' },
        ],
      }
    return {}
  })
  h.session(CREATOR)
  return h
}

test('invite page shows code and registration records without monetary rewards', async () => {
  const h = setup()
  const page = h.page('invite')
  await page.onShow()

  assert.equal(page.data.code, 'ABCD1234')
  assert.equal(page.data.total, 0)
  assert.equal(page.data.usageCount, 2)
  assert.equal(page.data.records.length, 1)
  assert.equal(page.data.rewardAmount, undefined)
  assert.equal(page.data.records[0].timeText, '2026-09-20')
})

test('invite page share message carries the invite code', async () => {
  const h = setup()
  const page = h.page('invite')
  await page.onShow()

  const share = page.onShareAppMessage()
  assert.ok(share.path.includes('/pages/register/index?code=ABCD1234'))
})

test('register page prefills the invite code from the share link', async () => {
  const h = harness(() => ({}))
  const page = h.page('register')
  page.onLoad({ code: 'abcd1234' })
  assert.equal(page.data.inviteCode, 'ABCD1234', '预填并统一大写')
})
