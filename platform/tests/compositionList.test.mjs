import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createCompositionQuerySnapshot,
  normalizeCompositionItems,
  resolveCompositionAuditStatus,
} from '../node_modules/.tmp/composition-feedback-tests/compositionList.js'

test('作品查询会裁剪参数并保存独立快照', () => {
  const query = { channel_id: ' 2067662706400834870 ', keyword: ' 伤心大西洋 ' }
  const snapshot = createCompositionQuerySnapshot(query)

  assert.deepEqual(snapshot, {
    channel_id: '2067662706400834870',
    keyword: '伤心大西洋',
  })
  assert.notEqual(snapshot, query)
  query.keyword = '已修改'
  assert.equal(snapshot.keyword, '伤心大西洋')
})

test('作品列表只接受真实数组，null 或其他值归一为空列表', () => {
  const items = [{ composition_id: '123' }]

  assert.equal(normalizeCompositionItems(items), items)
  assert.deepEqual(normalizeCompositionItems(null), [])
  assert.deepEqual(normalizeCompositionItems({ data: items }), [])
})

test('审核状态缺失时明确显示知乎未返回，仅拒绝状态可修改', () => {
  assert.deepEqual(resolveCompositionAuditStatus(undefined), {
    label: '知乎未返回',
    badgeClass: 'badge-default',
    canEdit: false,
  })
  assert.equal(resolveCompositionAuditStatus(null).label, '知乎未返回')
  assert.equal(resolveCompositionAuditStatus(1).canEdit, false)
  assert.equal(resolveCompositionAuditStatus(2).canEdit, true)
  assert.equal(resolveCompositionAuditStatus(0).label, '审核中')
})

test('作品查询保留 v2 契约，创建成功后执行真实回查', () => {
  const apiSource = readFileSync(new URL('../src/api/alliance.ts', import.meta.url), 'utf8')
  const viewSource = readFileSync(new URL('../src/views/dashboard/ZhihuCompositionsView.vue', import.meta.url), 'utf8')
  const createRequest = apiSource.match(/export interface CreateCompositionReq \{([\s\S]*?)\n\}/)?.[1] ?? ''

  assert.match(apiSource, /listCompositions:[\s\S]*?popularize_compositions\/v2/)
  assert.doesNotMatch(createRequest, /keyword/)
  assert.match(
    viewSource,
    /const createdId = await co\.submitCreate\(req\)[\s\S]*?lq\.keyword = cf\.keyword\.trim\(\)[\s\S]*?const items = await co\.fetchList\(lq\)/,
  )
  assert.match(viewSource, /items\.some\(item => item\.composition_id === createdId\)/)
})
