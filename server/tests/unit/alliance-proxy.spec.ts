import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { createApp } from '../../src/app';
import { signToken } from '../../src/auth/jwt';

const upstream = setupServer(
  http.post('https://open.zhihu.com/alliance/api/popularize_plan', () =>
    new HttpResponse('{"data":{"plan_id":2071265453767405652},"success":true}', {
      headers: { 'Content-Type': 'application/json' },
    })),
);

beforeAll(() => upstream.listen({
  onUnhandledRequest(request, print) {
    if (new URL(request.url).hostname !== '127.0.0.1') print.error();
  },
}));
afterEach(() => upstream.resetHandlers());
afterAll(() => upstream.close());

it('管理员知乎代理向浏览器返回精确 Snowflake ID 字符串', async () => {
  const token = await signToken({
    id: '1', role: 'boss', parentId: null, username: 'boss', displayName: 'Boss',
  });
  const response = await request(createApp())
    .post('/api/alliance/api/popularize_plan')
    .set('Authorization', `Bearer ${token}`)
    .send({
      task_id: 'task-1',
      channel_id: 'channel-1',
      content_url: 'https://example.com/content',
      popularize_type: 0,
      keyword: '测试',
    });

  expect(response.status).toBe(200);
  expect(response.body.data.plan_id).toBe('2071265453767405652');
});
