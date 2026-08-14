import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  normalizePromoUrl,
  resolveCompositionDisplayStatus,
} from '../node_modules/.tmp/composition-feedback-tests/compositionFeedback.js'

test('同步状态优先于审核状态', () => {
  const cases = [
    ['local', 'pending', '待回传'],
    ['syncing', 'active', '回传中'],
    ['failed', 'active', '回传失败'],
    ['synced', 'pending', '审核中'],
    ['synced', 'active', '已绑定'],
    ['synced', 'approved', '已绑定'],
    ['synced', 'rejected', '审核失败'],
    ['synced', 'ended', '已结束'],
  ]

  for (const [syncStatus, status, label] of cases) {
    assert.equal(resolveCompositionDisplayStatus({ syncStatus, status }).label, label)
  }
})

test('内容链接会去除空白并从分享文案中提取 URL', () => {
  assert.equal(
    normalizePromoUrl('  https://www.douyin.com/video/123  '),
    'https://www.douyin.com/video/123',
  )
  assert.equal(
    normalizePromoUrl('复制打开抖音 https://v.douyin.com/abc123/ 查看作品'),
    'https://v.douyin.com/abc123/',
  )
})

test('内容链接拒绝无效或非 HTTP(S) URL', () => {
  assert.throws(() => normalizePromoUrl('这不是链接'), /请输入有效的 HTTP 或 HTTPS 链接/)
  assert.throws(() => normalizePromoUrl('ftp://example.com/file'), /内容链接仅支持 HTTP 或 HTTPS/)
})

test('回传列表使用 promoUrl 和 updatedAt', () => {
  const filePath = new URL('../src/views/dashboard/KeywordsView.vue', import.meta.url)
  const source = readFileSync(filePath, 'utf8')

  assert.match(source, /record\.promoUrl/)
  assert.match(source, /record\.updatedAt/)
  assert.doesNotMatch(source, /record\.content_url/)
  assert.doesNotMatch(source, /record\.callbackAt/)
})
