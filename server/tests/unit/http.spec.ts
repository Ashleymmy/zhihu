import { unitClientId, unitSessionId } from '../support/unitAuthSession';
import { vi } from 'vitest';
vi.mock('../../src/db', async (original) => {
  const { unitAuthRows } = await import('../support/unitAuthSession');
  return {
    ...(await original<typeof import('../../src/db')>()),
    rows: vi.fn(unitAuthRows({ '1': { role: 'creator', parent_id: '2' } })),
  };
});
import request from 'supertest';
import { createApp } from '../support/legacyApp';
import { signToken } from '../../src/auth/jwt';

describe('HTTP 基础契约', () => {
  it('无 token 返回统一 401', async () => {
    const response = await request(createApp()).get('/api/v1/auth/me');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 40100, data: null, message: '请先登录' });
  });

  it('有效 token 可以读取枚举且使用统一外壳', async () => {
    const token = await signToken({
      sessionId: unitSessionId('1'),
      id: '1',
      role: 'creator',
      parentId: '2',
      username: 'creator',
      displayName: '成员',
    });
    const response = await request(createApp())
      .get('/api/v1/meta/enums')
      .set('X-Client-Id', unitClientId)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.mediaType).toHaveLength(10);
    expect(response.body.data.mediaType).toContainEqual({ value: 'KOC定向', label: 'KOC定向' });
    expect(response.body.data.compositionSubType).toContainEqual({ value: 11, label: '其他', parent: 0 });
    expect(response.body.data.compositionSubType).toContainEqual({ value: 10, label: '滚屏', parent: 2 });
  });

  it('普通账号不能访问仅管理员使用的知乎透传入口', async () => {
    const token = await signToken({
      sessionId: unitSessionId('1'),
      id: '1',
      role: 'creator',
      parentId: '2',
      username: 'creator',
      displayName: '成员',
    });
    const response = await request(createApp())
      .get('/api/alliance/api/popularize_compositions')
      .set('X-Client-Id', unitClientId)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe(40301);
    expect(response.body.message).toBe('无权执行此操作');
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.body.requestId).not.toBe('');
    expect(Number.isSafeInteger(response.body.timestamp)).toBe(true);
    expect(response.body).not.toHaveProperty('data');
  });

  it('未知接口返回统一 404', async () => {
    const response = await request(createApp()).get('/not-found');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe(40400);
  });

  it('有效签名仍不能绕过客户端标识及登录会话校验', async () => {
    const claims = { id: '1', role: 'creator' as const, parentId: '2', username: 'creator', displayName: '成员' };
    const token = await signToken({ ...claims, sessionId: unitSessionId('1') });
    const missingClient = await request(createApp()).get('/api/v1/meta/enums').auth(token, { type: 'bearer' });
    const wrongClient = await request(createApp())
      .get('/api/v1/meta/enums')
      .set('X-Client-Id', 'another-browser-installation')
      .auth(token, { type: 'bearer' });
    const missingSession = await request(createApp())
      .get('/api/v1/meta/enums')
      .set('X-Client-Id', unitClientId)
      .auth(await signToken(claims), { type: 'bearer' });
    const wrongOwner = await request(createApp())
      .get('/api/v1/meta/enums')
      .set('X-Client-Id', unitClientId)
      .auth(await signToken({ ...claims, sessionId: unitSessionId('2') }), { type: 'bearer' });
    for (const response of [missingClient, wrongClient, missingSession, wrongOwner]) {
      expect(response.status).toBe(401);
      expect(response.body.code).toBe(40101);
    }
  });
});
