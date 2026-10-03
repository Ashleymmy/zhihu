import { describe, expect, it } from 'vitest';
import { compositionLinkProblem, submissionFailure } from '../../src/modules/zhihu/services/submission-feedback';

describe('actionable submission feedback', () => {
  it('identifies the actual platform mismatch without pretending it came from Zhihu', () => {
    expect(compositionLinkProblem('KOC抖音', 'https://www.tiktok.com/@user/video/123')).toContain('链接来自“TikTok”');
    expect(compositionLinkProblem('KOC抖音', 'https://xhslink.com/test')).toContain('小红书');
    expect(compositionLinkProblem('KOC小红书', 'https://xhslink.com/test')).toBeNull();
    expect(compositionLinkProblem('KOC抖音', 'https://v.douyin.com/test')).toBeNull();
    expect(compositionLinkProblem('KOC定向', 'https://example.com/work')).toBeNull();
    expect(compositionLinkProblem('KOC抖音', 'https://douyin.com.attacker.test/work')).toBeNull();
    expect(compositionLinkProblem('KOC抖音', 'javascript:alert(1)')).toContain('完整的作品链接');
  });
  it('does not invent a reason for historical 400402 failures', () => {
    expect(submissionFailure('知乎接口失败（HTTP 400 / code 400402）：关键词不符合知乎规则，请更换关键词', 'composition')).toContain('旧版提示未保留具体原因');
    expect(submissionFailure('知乎接口失败（HTTP 400 / code 400402）', 'keyword')).not.toContain('更换关键词');
    expect(submissionFailure('知乎接口失败（HTTP 400 / code 400402）：知乎返回：媒体账号与发布平台不一致', 'composition')).toBe('知乎返回：媒体账号与发布平台不一致');
  });
});
