import { describe, it, expect } from 'vitest'
import { upstreamReview } from '../../module-views/zhihu/work-status'

describe('independent platform and Zhihu reviews', () => {
  it('does not treat a local review or sync success as upstream approval', () => {
    expect(upstreamReview({source:'evidence',status:'passed',syncStatus:'synced'}).label).toBe('暂未返回审核结果')
    expect(upstreamReview({source:'composition',status:'active',zhihuStatusJson:'{}'}).label).toBe('暂未返回审核结果')
  })
  it('reads stored JSON and normalized objects with rejection reasons', () => {
    expect(upstreamReview({source:'composition',status:'pending',zhihuStatusJson:'{"audit_status":"rejected","reject_reason":"需修改"}'})).toEqual({label:'已拒绝',reason:'需修改'})
    expect(upstreamReview({source:'evidence',status:'pending',zhihuStatusJson:{auditStatus:'approved'}}).label).toBe('已通过')
  })
  it('handles malformed historic data and preserves unknown upstream codes', () => {
    expect(upstreamReview({source:'composition',status:'pending',zhihuStatusJson:'invalid'}).label).toBe('暂未返回审核结果')
    expect(upstreamReview({source:'composition',status:'pending',zhihuStatusJson:{auditStatus:0}}).label).toBe('0')
  })
})
