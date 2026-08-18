import { parseEnvironment } from '../../src/config';

describe('配置校验', () => {
  it('生产环境拒绝默认安全凭据', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrow('生产环境缺少安全配置');
  });

  it('生产环境接受完整的安全配置', () => {
    const parsed = parseEnvironment({
      NODE_ENV: 'production',
      JWT_SECRET: 'production_jwt_secret_with_32_chars_minimum',
      ZHIHU_ACCESS_TOKEN: 'production_access_token',
      ZHIHU_SECRET_KEY: 'production_secret_key',
      CALLBACK_SECRET_ENCRYPTION_KEY: '1'.repeat(64),
    });
    expect(parsed.NODE_ENV).toBe('production');
  });

  it('P0007-R1-CONFIG-001 only accepts the fixed Zhihu origin root', () => {
    expect(parseEnvironment({ ZHIHU_API_BASE: 'https://open.zhihu.com' }).ZHIHU_API_BASE).toBe(
      'https://open.zhihu.com',
    );
    expect(parseEnvironment({ ZHIHU_API_BASE: 'https://open.zhihu.com/' }).ZHIHU_API_BASE).toBe(
      'https://open.zhihu.com',
    );

    for (const value of [
      'http://open.zhihu.com',
      'https://attacker.example',
      'https://api.open.zhihu.com',
      'https://open.zhihu.com:443',
      'https://user@open.zhihu.com',
      'https://open.zhihu.com/alliance/api',
      'https://open.zhihu.com?target=attacker',
      'https://open.zhihu.com#fragment',
      'https://open.zhihu.com\\attacker.example',
    ]) {
      expect(() => parseEnvironment({ ZHIHU_API_BASE: value }), value).toThrow(
        '知乎 API 地址必须固定为 https://open.zhihu.com',
      );
    }
  });
});
