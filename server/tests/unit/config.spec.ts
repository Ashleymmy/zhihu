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
});
