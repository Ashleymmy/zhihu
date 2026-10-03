import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { textsFor, contentDigest, requireContentProof } from '../../src/wechat/content-safety';
const cloud = createRequire(__filename)(
  path.resolve(__dirname, '../../../weixin-app/cloudfunctions/opc-bridge/content-safety.js'),
);
it('cloud/server agreement covers registration, nested text, read-only calls and private fields', () => {
  const cases: [string, string, Record<string, unknown>][] = [
    [
      '/core/auth/register',
      'POST',
      { username: 'person', displayName: '昵称', password: 'secret', phone: '13900000000', smsCode: '123456' },
    ],
    ['/core/auth/login', 'POST', { username: 'person', password: 'secret' }],
    ['/core/auth/profile', 'POST', { displayName: '  姓名  ', contact: 'private' }],
    [
      '/modules/zhihu/mini-import-works',
      'POST',
      { rows: [{ mediaAccount: '账号', note: '备注', url: 'https://invalid' }] },
    ],
    ['/core/finance/withdrawals', 'POST', { remark: 'private', bankAccount: '12345' }],
    ['/core/files/chunk', 'POST', { content: 'base64' }],
    ['/core/announcements', 'GET', { content: 'read' }],
  ];
  for (const [p, m, d] of cases) {
    expect(textsFor(p, m, d)).toEqual(cloud.textsFor(p, m, d));
    expect(contentDigest(p, m, d)).toBe(cloud.digest(p, m, cloud.textsFor(p, m, d)));
  }
});
it('requires proof for matching content and cannot reuse a valid proof on modified data', () => {
  const body = { path: '/core/auth/profile', method: 'POST', data: { displayName: 'approved' } };
  expect(() => requireContentProof(body)).toThrow();
  const contentSafety = { version: 1, digest: contentDigest(body.path, body.method, body.data) };
  expect(() => requireContentProof({ ...body, contentSafety })).not.toThrow();
  expect(() => requireContentProof({ ...body, data: { displayName: 'changed' }, contentSafety })).toThrow();
  expect(() =>
    requireContentProof({ path: '/core/auth/login', method: 'POST', data: { username: 'name', password: 'secret' } }),
  ).not.toThrow();
});
