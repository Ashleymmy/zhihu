import request from 'supertest';
import { createApp } from '../../src/app';
import { signToken } from '../../src/auth/jwt';
import { isCompositionCategoryValid, isZonedIsoDateTime, normalizeMediaType, normalizeZonedIsoDateTime } from '../../src/zhihu/composition';

describe('作品 v2 契约', () => {
  it('兼容旧数字媒体类型并统一为知乎字符串', () => {
    expect(normalizeMediaType(1)).toBe('KOC抖音');
    expect(normalizeMediaType(2)).toBe('KOC小红书');
    expect(normalizeMediaType('KOC定向')).toBe('KOC定向');
    expect(() => normalizeMediaType('unknown')).toThrow('媒体类型不正确');
  });

  it('严格校验作品一级和二级分类组合', () => {
    expect(isCompositionCategoryValid(0, 11)).toBe(true);
    expect(isCompositionCategoryValid(1, 1)).toBe(true);
    expect(isCompositionCategoryValid(2, 10)).toBe(true);
    expect(isCompositionCategoryValid(1, 11)).toBe(false);
    expect(isCompositionCategoryValid(2, 1)).toBe(false);
  });

  it('创建作品要求带时区发布时间且校验分类组合', async () => {
    const token = await signToken({ id: '1', role: 'member', parentId: '2', username: 'member', displayName: '成员' });
    const base = {
      planId: '1',
      mediaType: 'KOC定向',
      mediaAccount: '测试账号',
      compositionType: 0,
      compositionSubType: 11,
      promoUrl: 'https://example.com/content',
    };
    const missingTime = await request(createApp())
      .post('/api/v1/compositions')
      .set('Authorization', `Bearer ${token}`)
      .send(base);
    expect(missingTime.status).toBe(422);

    const invalidCategory = await request(createApp())
      .post('/api/v1/compositions')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...base, compositionSubType: 1, releaseTime: '2026-08-13T16:05:00+08:00' });
    expect(invalidCategory.status).toBe(422);
  });

  it('接受 JavaScript 和 PowerShell 生成的合法 ISO 8601 小数秒', () => {
    expect(isZonedIsoDateTime('2026-08-13T16:05:00.123Z')).toBe(true);
    expect(isZonedIsoDateTime('2026-08-13T16:05:00.1234567+08:00')).toBe(true);
    expect(isZonedIsoDateTime('2026-08-13T16:05:00')).toBe(false);
    expect(normalizeZonedIsoDateTime('2026-08-13T16:05:00.1234567+08:00'))
      .toBe('2026-08-13T16:05:00.123+08:00');
  });
});
