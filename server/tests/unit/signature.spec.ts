import { buildSignature, buildSignatureTrace, injectSignParams } from '../../src/sign/zhihu';

describe('知乎签名', () => {
  it('匹配规范 Golden Vector', () => {
    expect(
      buildSignature(
        {
          access_token: 'Db6j0Yq0eppBb',
          channel_id: '1462106336904909960',
          content_url: 'https://www.zhihu.com/market/paid_column/1550452094749851648/section/1590711798218661888',
          keyword: '这是一个测试关键词',
          popularize_type: 0,
          task_id: '1443567656205545123',
          timestamp: 1672899103,
        },
        'a735eb11da74123074675fa3522a90d1',
      ),
    ).toBe('794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579');
  });

  it('排除分页、二代渠道和 signature', () => {
    const base = { access_token: 'a', keyword: '中 文', timestamp: 1 };
    expect(buildSignature({ ...base, offset: 10, limit: 20, second_channel_id: 'x', signature: 'old' }, 's')).toBe(
      buildSignature(base, 's'),
    );
  });

  it('注入秒级时间戳及签名', () => {
    const result = injectSignParams({ keyword: '测试' }, 'token', 'secret', 123);
    expect(result).toMatchObject({ access_token: 'token', timestamp: 123, keyword: '测试' });
    expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('支持逐端点 profile 并固定排除项', () => {
    const profile = { excludedKeys: ['second_channel_id', 'offset'] } as const;
    const trace = buildSignatureTrace(
      { access_token: 'token', keyword: '测试', second_channel_id: 'ignored', offset: 10, timestamp: 123 },
      'secret',
      profile,
    );
    expect(trace.kvStr).toBe('access_token=token&keyword=测试&timestamp=123');
    expect(trace.signature).toMatch(/^[a-f0-9]{64}$/);
  });
});
