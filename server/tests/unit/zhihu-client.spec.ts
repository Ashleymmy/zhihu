import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const signing = vi.hoisted(() => ({ inject: vi.fn() }));

vi.mock('../../src/sign/zhihu', async () => {
  const actual = await vi.importActual<typeof import('../../src/sign/zhihu')>('../../src/sign/zhihu');
  return {
    ...actual,
    injectSignParams: (...args: Parameters<typeof actual.injectSignParams>) => {
      signing.inject();
      return actual.injectSignParams(...args);
    },
  };
});

import { zhihuGet, zhihuPost, zhihuSyncErrorDetail } from '../../src/zhihu/client';

const outboundRequests: string[] = [];
const validPlan = {
  task_id: 'task-1',
  channel_id: 'channel-1',
  content_url: 'https://example.com/landing',
  popularize_type: 0,
  keyword: '测试',
};
const validComposition = {
  plan_id: 'plan-1',
  channel_id: 'channel-1',
  media_type: 'KOC抖音',
  media_account: 'account-1',
  composition_type: 1,
  composition_sub_type: 2,
  composition_url: 'https://example.com/composition',
  release_time: Math.floor(Date.parse('2026-08-17T10:00:00+08:00') / 1000),
};

const server = setupServer(
  http.post('https://open.zhihu.com/alliance/api/popularize_plan', async ({ request }) => {
    outboundRequests.push(`${request.method} ${new URL(request.url).pathname}`);
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.signature || body.access_token !== 'mock_access_token') {
      return HttpResponse.json({ message: '签名错误' }, { status: 400 });
    }
    return HttpResponse.json({ data: { plan_id: '1234567890123456789' } });
  }),
  http.post('https://open.zhihu.com/alliance/api/popularize_composition/v2', ({ request }) => {
    outboundRequests.push(`${request.method} ${new URL(request.url).pathname}`);
    return HttpResponse.json({ data: { composition_id: '2071266138193975100' } });
  }),
  http.get('https://open.zhihu.com/alliance/api/data_report/real_time_data', ({ request }) => {
    outboundRequests.push(`${request.method} ${new URL(request.url).pathname}`);
    const url = new URL(request.url);
    expect(url.searchParams.get('access_token')).toBe('mock_access_token');
    expect(url.searchParams.get('timestamp')).toBeNull();
    expect(url.searchParams.get('signature')).toBeNull();
    return HttpResponse.json({ time_range: '2026-08-17', data: [] });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  signing.inject.mockClear();
  outboundRequests.length = 0;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('知乎后台 Client', () => {
  it('P0007-R2A-CLIENT-001 validates, signs, projects, and sends an allowlisted write', async () => {
    await expect(zhihuPost('/alliance/api/popularize_plan', validPlan)).resolves.toEqual({
      data: { plan_id: '1234567890123456789' },
    });
    expect(signing.inject).toHaveBeenCalledTimes(1);
    expect(outboundRequests).toEqual(['POST /alliance/api/popularize_plan']);
  });

  it('preserves an unquoted Snowflake ID returned by Zhihu without exposing the raw envelope', async () => {
    server.use(
      http.post(
        'https://open.zhihu.com/alliance/api/popularize_plan',
        () =>
          new HttpResponse('{"data":{"plan_id":2071265453767405652},"success":true}', {
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    await expect(zhihuPost('/alliance/api/popularize_plan', validPlan)).resolves.toEqual({
      data: { plan_id: '2071265453767405652' },
    });
  });

  it('allows realtime token-only requests and projects canonical data', async () => {
    await expect(
      zhihuGet('/alliance/api/data_report/real_time_data', {
        type: 1,
        time_scale: 1,
        fields: 'search_num,order_num,created_at',
      }),
    ).resolves.toEqual({ data: { time_range: '2026-08-17', items: [] } });
    expect(signing.inject).not.toHaveBeenCalled();
    expect(outboundRequests).toEqual(['GET /alliance/api/data_report/real_time_data']);
  });

  it('P0007-R2A-UPLOAD-001 keeps backend batch calls fail closed before signing or egress', async () => {
    await expect(
      zhihuPost('/alliance/api/popularize_plans', {
        task_id: 'task-1',
        channel_id: 'channel-1',
        popularize_type: 0,
      }),
    ).rejects.toMatchObject({ httpStatus: 503, code: 50300, message: '批量上传暂未开放' });
    expect(signing.inject).not.toHaveBeenCalled();
    expect(outboundRequests).toEqual([]);
  });

  it('P0007-R1-JOB-001 rejects all three legacy Job paths before signing or egress', async () => {
    for (const path of [
      '/alliance/api/get_agent_channels',
      '/alliance/api/popularize_tasks',
      '/alliance/api/data_report/daily_data',
      'https://attacker.example/alliance/api/popularize_plan',
    ]) {
      await expect(zhihuGet(path)).rejects.toMatchObject({
        httpStatus: 502,
        code: 50002,
        message: '知乎服务暂时不可用，请稍后重试',
      });
    }
    expect(signing.inject).not.toHaveBeenCalled();
    expect(outboundRequests).toEqual([]);
  });

  it('maps unknown upstream errors without exposing the upstream message', async () => {
    server.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', () =>
        HttpResponse.json(
          { code: 40317, message: 'permission denied access_token=real-token signature=real-signature' },
          { status: 403 },
        ),
      ),
    );

    const error = await zhihuPost('/alliance/api/popularize_plan', validPlan).catch((reason) => reason);
    expect(error).toMatchObject({ httpStatus: 502, code: 50002, message: '知乎服务暂时不可用，请稍后重试' });
    expect(zhihuSyncErrorDetail(error)).toBe('知乎接口失败（HTTP 403 / code 40317）');
    expect(JSON.stringify(error)).not.toContain('real-token');
  });

  it('keeps the stable known error translations', async () => {
    server.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', () =>
        HttpResponse.json(
          { error: { code: 400402, message: '关键词，不能包含违规词词根，请更换关键词 access_token=sentinel' } },
          { status: 400 },
        ),
      ),
    );

    const error = await zhihuPost('/alliance/api/popularize_plan', { ...validPlan, keyword: '知乎故事' }).catch(
      (reason) => reason,
    );
    expect(zhihuSyncErrorDetail(error)).toBe(
      '知乎接口失败（HTTP 400 / code 400402）：关键词不符合知乎规则，请更换关键词',
    );
    expect(zhihuSyncErrorDetail(error)).not.toContain('sentinel');
  });

  it('maps changed 400402 wording by code', async () => {
    server.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', () =>
        HttpResponse.json({ code: 400402, message: 'upstream wording changed access_token=sentinel' }, { status: 400 }),
      ),
    );
    const error = await zhihuPost('/alliance/api/popularize_plan', { ...validPlan, keyword: '知乎故事' }).catch(
      (reason) => reason,
    );
    expect(zhihuSyncErrorDetail(error)).toBe(
      '知乎接口失败（HTTP 400 / code 400402）：关键词不符合知乎规则，请更换关键词',
    );
    expect(JSON.stringify(error)).not.toContain('sentinel');
  });

  it('does not classify a duplicate composition as a keyword rule', async () => {
    server.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_composition/v2', () =>
        HttpResponse.json(
          { error: { code: 400402, name: 'OpenApiBadRequestError', message: '作品链接重复绑定' } },
          { status: 400 },
        ),
      ),
    );
    const error = await zhihuPost('/alliance/api/popularize_composition/v2', validComposition).catch(
      (reason) => reason,
    );
    expect(zhihuSyncErrorDetail(error)).toBe('知乎接口失败（HTTP 400 / code 400402）：作品链接已绑定，请更换作品链接');
  });

  it('treats HTTP 200 error and success:false envelopes as failures', async () => {
    for (const body of [
      { error: { code: 400400, name: 'OpenApiParamError', message: 'unknown parameter access_token=sentinel' } },
      { success: false, data: { message: 'failure access_token=sentinel' } },
    ]) {
      server.use(http.post('https://open.zhihu.com/alliance/api/popularize_plan', () => HttpResponse.json(body)));
      const error = await zhihuPost('/alliance/api/popularize_plan', validPlan).catch((reason) => reason);
      expect(error).toMatchObject({ code: 50002, message: '知乎服务暂时不可用，请稍后重试' });
      expect(JSON.stringify(error)).not.toContain('sentinel');
      server.resetHandlers();
    }
  });
});
