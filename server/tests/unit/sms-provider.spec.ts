import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
const { send, requests, runtimes } = vi.hoisted(() => ({
  send: vi.fn(),
  requests: [] as unknown[],
  runtimes: [] as unknown[],
}));
vi.mock('@alicloud/dysmsapi20170525', () => ({
  default: class {
    sendSmsWithOptions = send;
  },
  SendSmsRequest: class {
    constructor(v: unknown) {
      requests.push(v);
    }
  },
}));
vi.mock('@alicloud/tea-util', () => ({
  RuntimeOptions: class {
    constructor(v: unknown) {
      runtimes.push(v);
    }
  },
}));
vi.mock('@alicloud/openapi-client', () => ({
  Config: class {
    constructor(_v: unknown) {}
  },
}));
vi.mock('@alicloud/credentials', () => ({
  default: class {
    constructor(_v: unknown) {}
  },
  Config: class {
    constructor(_v: unknown) {}
  },
}));
import { sendRegistrationSms } from '../../src/sms/aliyun';
import { smsSettings } from '../../src/sms/config';
beforeEach(() => {
  vi.stubEnv('SMS_REGISTRATION_ENABLED', '1');
  vi.stubEnv('SMS_REGISTRATION_PILOT_INVITATIONS', '');
  vi.stubEnv('SMS_SIGN_NAME', '测试签名');
  vi.stubEnv('SMS_TEMPLATE_CODE', 'SMS_123456');
  vi.stubEnv('SMS_VERIFICATION_SECRET', 'isolated_test_verification_secret_long_enough');
  vi.stubEnv('SMS_DAILY_LIMIT', '100');
  send.mockReset();
  requests.length = 0;
  runtimes.length = 0;
});
afterEach(() => vi.unstubAllEnvs());
it('sends exactly configured registration template with no SDK automatic retries', async () => {
  send.mockResolvedValue({ body: { code: 'OK' } });
  await sendRegistrationSms('13900001234', '012345');
  expect(requests[0]).toEqual({
    phoneNumbers: '13900001234',
    signName: '测试签名',
    templateCode: 'SMS_123456',
    templateParam: '{"code":"012345"}',
  });
  expect(runtimes[0]).toMatchObject({ autoretry: false, connectTimeout: 3000, readTimeout: 5000 });
  expect(send).toHaveBeenCalledTimes(1);
});
it('rejects HTTP-success/business-failure replies', async () => {
  send.mockResolvedValue({ body: { code: 'isv.BUSINESS_LIMIT_CONTROL' } });
  await expect(sendRegistrationSms('13900001234', '123456')).rejects.toMatchObject({ httpStatus: 503, code: 50321 });
});
it('sanitizes provider exceptions and never logs their signed requests', async () => {
  const log = vi.spyOn(console, 'error');
  send.mockRejectedValue(new Error('SECRET=fixture phone=13900001234 code=123456'));
  try {
    await sendRegistrationSms('13900001234', '123456');
    throw new Error('expected failure');
  } catch (e) {
    expect(String(e)).not.toMatch(/SECRET|13900001234|123456/);
    expect(e).toMatchObject({ code: 50321 });
  }
  expect(log).not.toHaveBeenCalled();
});
it('does not call a provider when disabled or misconfigured', async () => {
  vi.stubEnv('SMS_REGISTRATION_ENABLED', '0');
  await expect(sendRegistrationSms('13900001234', '123456')).rejects.toMatchObject({ code: 50320 });
  expect(send).not.toHaveBeenCalled();
  vi.stubEnv('SMS_REGISTRATION_ENABLED', '1');
  vi.stubEnv('SMS_VERIFICATION_SECRET', '');
  expect(() => smsSettings()).toThrow();
});
it('rejects production placeholder verification keys', () => {
  vi.stubEnv('NODE_ENV', 'production');
  expect(() => smsSettings()).toThrow();
  vi.stubEnv('SMS_VERIFICATION_SECRET', 'A'.repeat(64));
  expect(() => smsSettings()).toThrow();
});

it('allows only the configured pilot invitation while global registration remains off', async () => {
  vi.stubEnv('SMS_REGISTRATION_ENABLED', '0');
  const token = 'isolated_pilot_invitation';
  vi.stubEnv('SMS_REGISTRATION_PILOT_INVITATIONS', createHash('sha256').update(token).digest('hex'));
  expect(smsSettings().enabled).toBe(false);
  expect(smsSettings('other_invitation').enabled).toBe(false);
  expect(smsSettings(token).enabled).toBe(true);
  await expect(sendRegistrationSms('13900001234', '123456', 'other_invitation')).rejects.toMatchObject({ code: 50320 });
  expect(send).not.toHaveBeenCalled();
  send.mockResolvedValue({ body: { code: 'OK' } });
  await sendRegistrationSms('13900001234', '123456', token);
  expect(send).toHaveBeenCalledTimes(1);
  vi.stubEnv('SMS_REGISTRATION_ENABLED', '1');
  expect(smsSettings('other_invitation').enabled).toBe(true);
});

it('fails closed for malformed pilot lists and incomplete pilot configuration', () => {
  vi.stubEnv('SMS_REGISTRATION_ENABLED', '0');
  for (const value of ['typo', 'a'.repeat(64) + ',', Array(21).fill('a'.repeat(64)).join(',')]) {
    vi.stubEnv('SMS_REGISTRATION_PILOT_INVITATIONS', value);
    expect(() => smsSettings()).toThrow();
  }
  vi.stubEnv('SMS_REGISTRATION_PILOT_INVITATIONS', 'a'.repeat(64));
  vi.stubEnv('SMS_VERIFICATION_SECRET', '');
  expect(() => smsSettings()).toThrow();
});
