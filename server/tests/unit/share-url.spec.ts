import { describe, expect, it } from 'vitest';
import { assertCompleteShareUrl, isTruncatedShareUrl, TRUNCATED_SHARE_URL_MESSAGE } from '../../src/modules/zhihu/zhihu/shareUrl';
import { buildPlanPayload } from '../../src/modules/zhihu/jobs/pushPlan';

const share = 'https://soia.zhihu.com/km_paid_content/share?is_delivery=true&source=e9f03bea58b4524092f6cb42207b6a5f&package=zhihushare0812&channel_id=67154024128158&appkey=2400&ustkn=1&is_share_data=true&fallback_url=zhvip%3A%2F%2Ftab%2Fhome&mst=fixture-complete-story-reference';

describe('mobile story share URLs', () => {
  it('rejects the observed native 140-character cutoff before mst', () => {
    const broken = share.slice(0, 140);
    expect(broken.endsWith('channel_id=6715')).toBe(true);
    expect(() => assertCompleteShareUrl(broken)).toThrow(TRUNCATED_SHARE_URL_MESSAGE);
  });
  it('preserves a complete opaque share link in the upstream payload', () => {
    expect(() => assertCompleteShareUrl(share)).not.toThrow();
    expect(buildPlanPayload({zhihu_task_id:'1',channel_id:'2',second_channel_id:null,keyword:'完整分享链接',landing_url:share,popularize_type:0}).content_url).toBe(share);
  });
  it('does not infer missing content or reject unrelated 140-character URLs', () => {
    for (const base of ['https://www.zhihu.com/market/paid_column/', 'https://example.com/', 'https://soia.zhihu.com/other/', 'https://soia.zhihu.com/km_paid_content/share?mst=']) {
      expect(isTruncatedShareUrl(base.padEnd(140, 'x'))).toBe(false);
    }
    expect(isTruncatedShareUrl('https://soia.zhihu.com/km_paid_content/share')).toBe(false);
    expect(isTruncatedShareUrl(null)).toBe(false);
  });
});
