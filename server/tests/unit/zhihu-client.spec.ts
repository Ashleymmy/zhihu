import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { zhihuGet, zhihuPost, zhihuSyncErrorDetail } from '../../src/zhihu/client';

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

it('未知上游错误对外保持通用文案，仅在同步详情中保留脱敏诊断', async () => {
  server.use(
    http.post('https://open.zhihu.com/alliance/api/popularize_plan', () => HttpResponse.json({
      code: 40317,
      message: 'permission denied access_token=real-token signature=real-signature',
    }, { status: 403 })),
  );

  const error = await zhihuPost('/alliance/api/popularize_plan', { keyword: '测试' }).catch((reason) => reason);
  expect(error).toMatchObject({
    httpStatus: 502,
    code: 50002,
    message: '知乎服务暂时不可用，请稍后重试',
  });
  expect(zhihuSyncErrorDetail(error)).toBe(
    '知乎接口失败（HTTP 403 / code 40317）：permission denied access_token=[REDACTED] signature=[REDACTED]',
  );
});

it('HTTP 200 中的 error envelope 仍按失败处理', async () => {
  server.use(
    http.post('https://open.zhihu.com/alliance/api/popularize_plan', () => HttpResponse.json({
      error: { code: 400400, name: 'OpenApiParamError', message: 'unknown parameter' },
    })),
  );

  const error = await zhihuPost('/alliance/api/popularize_plan', { keyword: '测试' }).catch((reason) => reason);
  expect(error).toMatchObject({ code: 50002, message: '知乎服务暂时不可用，请稍后重试' });
  expect(zhihuSyncErrorDetail(error)).toBe(
    '知乎接口失败（HTTP 200 / code 400400）：unknown parameter',
  );
});
