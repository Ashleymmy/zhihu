import request from 'supertest';
import { createApp } from '../../src/app';
import { signToken } from '../../src/auth/jwt';

describe('HTTP 基础契约', () => {
  it('无 token 返回统一 401', async () => {
    const response = await request(createApp()).get('/api/v1/auth/me');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 40100, data: null, message: '请先登录' });
  });

  it('有效 token 可以读取枚举且使用统一外壳', async () => {
    const token = await signToken({ id: '1', role: 'member', parentId: '2', username: 'member', displayName: '成员' });
    const response = await request(createApp()).get('/api/v1/meta/enums').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.mediaType).toHaveLength(10);
    expect(response.body.data.mediaType).toContainEqual({ value: 'KOC定向', label: 'KOC定向' });
    expect(response.body.data.compositionSubType).toContainEqual({ value: 11, label: '其他', parent: 0 });
    expect(response.body.data.compositionSubType).toContainEqual({ value: 10, label: '滚屏', parent: 2 });
  });

  it('普通账号不能访问仅管理员使用的知乎透传入口', async () => {
    const token = await signToken({ id: '1', role: 'member', parentId: '2', username: 'member', displayName: '成员' });
    const response = await request(createApp())
      .get('/api/alliance/api/get_agent_channels')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 40301, data: null, message: '无权执行此操作' });
  });

  it('未知接口返回统一 404', async () => {
    const response = await request(createApp()).get('/not-found');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe(40400);
  });
});
