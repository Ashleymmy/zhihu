import { describe, it, expect } from 'vitest'
import { keywordProgress } from '../../module-views/zhihu/keyword-progress'

describe('keyword submission and business status', () => {
  it('does not show a successful creation as still waiting to be submitted', () => {
    expect(keywordProgress({ syncStatus: 'synced', lifecycleStatus: 'pending' })).toBe('已创建，待核实可用状态')
  })
  it('separates failed, queued and uncertain submissions', () => {
    expect(keywordProgress({ syncStatus: 'failed', lifecycleStatus: 'pending' })).toBe('提交失败，暂不可领取')
    expect(keywordProgress({ syncStatus: 'local', lifecycleStatus: 'pending' })).toBe('待提交知乎')
    expect(keywordProgress({ syncStatus: 'syncing', lifecycleStatus: 'pending' })).toBe('提交结果待确认')
  })
  it('preserves confirmed allocation and retirement states', () => {
    expect(keywordProgress({ syncStatus: 'synced', lifecycleStatus: 'active' })).toBe('使用中')
    expect(keywordProgress({ syncStatus: 'synced', lifecycleStatus: 'retired' })).toBe('已停用')
  })
});
