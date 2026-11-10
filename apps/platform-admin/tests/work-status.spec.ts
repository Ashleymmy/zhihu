import { describe, it, expect } from 'vitest'
import { upstreamReview, rawUpstreamReview, evidenceReview } from '../../module-views/zhihu/work-status'

describe('independent platform and Zhihu reviews', () => {
  it('prioritizes failed creation over stale review status', () => {
    expect(upstreamReview({source:'evidence',status:'passed',syncStatus:'failed',planSyncStatus:'failed',failureReason:'请更换关键词',zhihuStatusJson:{auditStatus:'approved'}})).toEqual({label:'关键词创建失败，作品尚未报送',reason:'请更换关键词'})
  })
  it('uses the R7 platform default after normal registration while keeping raw upstream pending separate', () => {
    const work={source:'evidence' as const,status:'passed',syncStatus:'synced',zhihuStatusJson:{audit_status:'pending'}}
    expect(upstreamReview(work).label).toBe('作品已登记，平台默认通过')
    expect(rawUpstreamReview(work).label).toBe('来源标记为待审核')
    expect(evidenceReview(work).label).toBe('作品已登记，平台默认通过')
  })
  it('reads stored JSON and normalized objects with rejection reasons', () => {
    expect(upstreamReview({source:'composition',status:'pending',zhihuStatusJson:'{"audit_status":"rejected","reject_reason":"需修改"}'})).toEqual({label:'作品已退回或停用',reason:'需修改'})
    expect(upstreamReview({source:'evidence',status:'passed',verificationStatus:'disputed'}).label).toBe('作品归属有争议')
  })
  it('handles malformed historic data and preserves unknown upstream codes', () => {
    expect(upstreamReview({source:'composition',status:'missing',zhihuStatusJson:'invalid'}).label).toBe('作品登记结果待核对')
    expect(rawUpstreamReview({source:'composition',status:'pending',zhihuStatusJson:{auditStatus:0}}).label).toBe('来源状态尚未识别')
  })
})
