import { describe, it, expect } from 'vitest'
import { keywordProgress } from '../../module-views/zhihu/keyword-progress'

describe('keyword submission and business status', () => {
  it('interprets database string flags by value for reserved and conflicted keywords', () => {
    expect(keywordProgress({ syncStatus: 'synced', lifecycleStatus: 'reserved', ownershipConflict: '0', allocationReady: '0' })).toBe('等待分发')
    expect(keywordProgress({ syncStatus: 'synced', lifecycleStatus: 'assigned', ownershipConflict: '1', allocationReady: '0' })).toBe('归属待核对，禁止新增使用')
    expect(keywordProgress({ syncStatus: 'synced', lifecycleStatus: 'available', ownershipConflict: '0', allocationReady: '0' })).toBe('暂不可领取，请联系管理员核对')
  })
  it('does not show a successful creation as still waiting to be submitted', () => {
    expect(keywordProgress({ syncStatus: 'synced', lifecycleStatus: 'available', allocationReady: 1 })).toBe('可以领取')
    expect(keywordProgress({ syncStatus: 'synced', lifecycleStatus: 'pending', allocationReady: 0 })).toBe('创建记录待核对，暂不可领取')
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
  it('does not show a paused or rejected plan as claimable', () => {
    expect(keywordProgress({syncStatus:'synced',lifecycleStatus:'available',planStatus:'paused',allocationReady:0})).toBe('计划已暂停')
    expect(keywordProgress({syncStatus:'synced',lifecycleStatus:'available',planStatus:'rejected',allocationReady:0})).toBe('计划已拒绝，暂不可领取')
  })
});
