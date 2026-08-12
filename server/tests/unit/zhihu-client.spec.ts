import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { zhihuGet, zhihuPost } from '../../src/zhihu/client';

const server = setupServer(
  http.post('https://open.zhihu.com/alliance/api/popularize_plan', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    if (!body.signature || body.access_token !== 'mock_access_token') return HttpResponse.json({ message: '签名错误' }, { status: 400 });
    return HttpResponse.json({ data: { plan_id: '1234567890123456789' } });
  }),
  http.get('https://open.zhihu.com/alliance/api/get_agent_channels', ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get('access_token') !== 'mock_access_token') {
      return HttpResponse.json({ message: '鉴权错误' }, { status: 401 });
    }
    if (url.searchParams.has('timestamp') || url.searchParams.has('signature')) {
      return HttpResponse.json({ message: '不应携带签名' }, { status: 400 });
    }
    return HttpResponse.json({ success: true, data: [] });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it('所有知乎写请求由 MSW 拦截并携带签名', async () => {
  await expect(zhihuPost('/alliance/api/popularize_plan', { keyword: '测试' }))
    .resolves.toEqual({ data: { plan_id: '1234567890123456789' } });
});

it('渠道查询只携带 access_token，不附加签名参数', async () => {
  await expect(zhihuGet('/alliance/api/get_agent_channels'))
    .resolves.toEqual({ success: true, data: [] });
});

it('未知上游错误仅保留 HTTP 状态、错误码和脱敏消息', async () => {
  server.use(
    http.post('https://open.zhihu.com/alliance/api/popularize_plan', () => HttpResponse.json({
      code: 40317,
      message: 'permission denied access_token=real-token signature=real-signature',
    }, { status: 403 })),
  );

  await expect(zhihuPost('/alliance/api/popularize_plan', { keyword: '测试' }))
    .rejects.toMatchObject({
      httpStatus: 502,
      code: 50002,
      message: '知乎接口失败（HTTP 403 / code 40317）：permission denied access_token=[REDACTED] signature=[REDACTED]',
    });
});
