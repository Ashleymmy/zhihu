import { randomBytes } from 'node:crypto';
import { parseEnvironment as core } from '../../src/config';
import { parseEnvironment as zhihu } from '../../src/modules/zhihu/config';

describe('production signing key validation', () => {
  const provider = {
    ZHIHU_ACCESS_TOKEN: 'provider_access_token',
    ZHIHU_SECRET_KEY: 'provider_secret_key',
    CALLBACK_SECRET_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  for (const [name, parse] of [['core', core], ['zhihu', zhihu]] as const) {
    it(`${name} refuses documented placeholders and repeated signing keys`, () => {
      for (const secret of [
        'replace_with_at_least_32_random_characters',
        'please_change_me_to_a_long_random_secret',
        'test_only_jwt_secret_at_least_32_chars',
        'change_me_' + 'x'.repeat(40),
        'a'.repeat(64),
        '01234567'.repeat(8),
      ]) {
        expect(() => parse({ ...provider, NODE_ENV: 'production', JWT_SECRET: secret })).toThrow('生产环境缺少安全配置');
      }
    });
    it(`${name} accepts a newly generated production key and retains local test defaults`, () => {
      expect(() => parse({ ...provider, NODE_ENV: 'production', JWT_SECRET: randomBytes(32).toString('hex') })).not.toThrow();
      expect(() => parse({ NODE_ENV: 'test' })).not.toThrow();
    });
  }
});
