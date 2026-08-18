import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { request as nodeRequest } from 'node:http';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../../src/auth/jwt';
import { createApp } from '../../src/app';
import { AppError } from '../../src/middleware/errors';
import * as contracts from '../../src/zhihu/allianceContracts';
import {
  ALLIANCE_QUOTA_CONFIRM_SCRIPT,
  ALLIANCE_QUOTA_RELEASE_SCRIPT,
  ALLIANCE_QUOTA_RESERVE_SCRIPT,
  AllianceQuotaManager,
  RedisAllianceQuotaStore,
  installAllianceQuotaManager,
  resetAllianceQuotaManager,
  type AllianceQuotaDecision,
  type AllianceQuotaRedisClient,
} from '../../src/zhihu/allianceQuota';
import { XLSX_MIME } from '../../src/zhihu/allianceXlsx';
import {
  installAllianceQuotaTestFixture,
  TEST_ALLIANCE_QUOTA_POLICY,
  type AllianceQuotaTestFixture,
} from '../support/allianceQuotaFixture';
import { buildMinimalXlsxFixture } from '../support/allianceXlsxFixture';
import { installAllianceAuditTestSink } from '../support/allianceAuditFixture';

const multerMock = vi.hoisted(() => ({ single: vi.fn() }));
const signMock = vi.hoisted(() => ({ inject: vi.fn(), build: vi.fn() }));

type ConfirmFailureMode = 'zero' | 'missing' | 'expired';

class ConfirmFailureRedisClient implements AllianceQuotaRedisClient {
  readonly calls: Array<{ script: string; arguments_: string[] }> = [];
  private readonly reservations = new Map<string, number>();

  constructor(private readonly mode: ConfirmFailureMode) {}

  async eval(script: string, _numberOfKeys: number, ...arguments_: string[]): Promise<unknown> {
    this.calls.push({ script, arguments_ });
    const reservationKey = arguments_[2]!;
    if (script === ALLIANCE_QUOTA_RESERVE_SCRIPT) {
      const reservationId = arguments_[5]!;
      const expiresAt = Number(arguments_[6]);
      if (this.mode !== 'missing') this.reservations.set(reservationKey, expiresAt);
      return [1, reservationId, expiresAt];
    }
    if (script === ALLIANCE_QUOTA_CONFIRM_SCRIPT) {
      const expiresAt = this.reservations.get(reservationKey);
      if (this.mode === 'zero') return 0;
      if (expiresAt === undefined || expiresAt <= Number(arguments_[3])) {
        this.reservations.delete(reservationKey);
        return 0;
      }
      return 1;
    }
    if (script === ALLIANCE_QUOTA_RELEASE_SCRIPT) {
      const existed = this.reservations.delete(reservationKey);
      return existed ? 1 : 0;
    }
    throw new Error('unexpected quota script');
  }
}

class SentinelRedisClient implements AllianceQuotaRedisClient {
  async connect(): Promise<void> {
    throw new Error('redis-reservation-sentinel');
  }
  async eval(): Promise<unknown> {
    throw new Error('redis-reservation-sentinel');
  }
  async quit(): Promise<void> {}
}

vi.mock('multer', async () => {
  const actual = await vi.importActual<typeof import('multer') & { default?: typeof import('multer') }>('multer');
  const actualMulter = actual.default ?? actual;
  const mockedMulter = vi.fn((options?: Parameters<typeof actualMulter>[0]) => {
    const instance = actualMulter(options);
    return {
      ...instance,
      single: (field: string) => {
        const middleware = instance.single(field);
        const wrappedMiddleware: RequestHandler = (req, res, next) => {
          multerMock.single(field);
          return middleware(req, res, next);
        };
        return wrappedMiddleware;
      },
    };
  });
  return { ...actual, default: Object.assign(mockedMulter, actualMulter) };
});

vi.mock('../../src/sign/zhihu', async () => {
  const actual = await vi.importActual<typeof import('../../src/sign/zhihu')>('../../src/sign/zhihu');
  return {
    ...actual,
    injectSignParams: (...args: Parameters<typeof actual.injectSignParams>) => {
      signMock.inject();
      return actual.injectSignParams(...args);
    },
    buildSignature: (...args: Parameters<typeof actual.buildSignature>) => {
      signMock.build();
      return actual.buildSignature(...args);
    },
  };
});

const outboundRequests: string[] = [];
let secondHostRequests = 0;
let auditSink: ReturnType<typeof installAllianceAuditTestSink>;

function recordUpstream(request: Request): void {
  const url = new URL(request.url);
  outboundRequests.push(`${request.method} ${url.pathname}`);
}

const upstream = setupServer(
  http.post('https://open.zhihu.com/alliance/api/popularize_plan', async ({ request }) => {
    recordUpstream(request);
    const body = (await request.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      task_id: 'task-1',
      channel_id: 'channel-1',
      content_url: 'https://example.com/landing',
      popularize_type: 0,
      keyword: '关键词',
      access_token: 'mock_access_token',
    });
    expect(body.timestamp).toEqual(expect.any(Number));
    expect(body.signature).toMatch(/^[a-f0-9]{64}$/u);
    expect(body).not.toHaveProperty('taskId');
    return new HttpResponse('{"data":{"plan_id":2071265453767405652},"success":true}', {
      headers: { 'Content-Type': 'application/json' },
    });
  }),
  http.post('https://open.zhihu.com/alliance/api/popularize_composition/v2', async ({ request }) => {
    recordUpstream(request);
    const body = (await request.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      plan_id: 'plan-1',
      channel_id: 'channel-1',
      media_type: 'KOC抖音',
      media_account: 'account-1',
      composition_type: 1,
      composition_sub_type: 2,
      composition_url: 'https://example.com/composition',
      access_token: 'mock_access_token',
    });
    expect(body.release_time).toBe(Math.floor(Date.parse('2026-08-17T10:00:00+08:00') / 1000));
    return HttpResponse.json({ data: { composition_id: '2071266138193975100' }, success: true });
  }),
  http.post('https://open.zhihu.com/alliance/api/popularize_plans', async ({ request }) => {
    recordUpstream(request);
    expect(request.headers.get('x-requested-with')).toBe('openApi');
    expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data;\s*boundary=/iu);
    const form = await request.formData();
    expect([...form.keys()]).toEqual([
      'task_id',
      'channel_id',
      'popularize_type',
      'access_token',
      'timestamp',
      'signature',
      'file',
    ]);
    expect(form.get('task_id')).toBe('task-1');
    expect(form.get('channel_id')).toBe('channel-1');
    expect(form.get('popularize_type')).toBe('0');
    expect(form.get('access_token')).toBe('mock_access_token');
    expect(form.get('timestamp')).toMatch(/^[0-9]+$/u);
    expect(form.get('signature')).toMatch(/^[a-f0-9]{64}$/u);
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    if (!(file instanceof Blob)) throw new Error('missing multipart file');
    expect(file.name).toBe('upload.xlsx');
    expect(file.type).toBe(XLSX_MIME);
    expect(Buffer.from(await file.arrayBuffer())).toEqual(buildMinimalXlsxFixture());
    return HttpResponse.json({ data: { batch_task_id: '2071267000000000001' }, success: true });
  }),
  http.post('https://open.zhihu.com/alliance/api/popularize_compositions/v2', async ({ request }) => {
    recordUpstream(request);
    expect(request.headers.get('x-requested-with')).toBe('openApi');
    expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data;\s*boundary=/iu);
    const form = await request.formData();
    expect([...form.keys()]).toEqual(['bind_type', 'channel_id', 'access_token', 'timestamp', 'signature', 'file']);
    expect(form.get('bind_type')).toBe('1');
    expect(form.get('channel_id')).toBe('channel-1');
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    if (!(file instanceof Blob)) throw new Error('missing multipart file');
    expect(file.name).toBe('upload.xlsx');
    expect(file.type).toBe(XLSX_MIME);
    expect(Buffer.from(await file.arrayBuffer())).toEqual(buildMinimalXlsxFixture());
    return HttpResponse.json({ data: { batch_task_id: '2071267000000000002' }, success: true });
  }),
  http.put('https://open.zhihu.com/alliance/api/popularize_composition/v2/:id', async ({ request }) => {
    recordUpstream(request);
    const body = (await request.json()) as Record<string, unknown>;
    expect(new URL(request.url).pathname).toBe('/alliance/api/popularize_composition/v2/2071266138193975100');
    expect(body).not.toHaveProperty('composition_id');
    expect(body).toMatchObject({ plan_id: 'plan-1', access_token: 'mock_access_token' });
    return HttpResponse.json({ data: '', success: true });
  }),
  http.get('https://open.zhihu.com/alliance/api/popularize_compositions', ({ request }) => {
    recordUpstream(request);
    const url = new URL(request.url);
    expect(url.searchParams.get('channel_id')).toBe('channel-1');
    expect(url.searchParams.get('keyword')).toBe('关键词');
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('access_token')).toBe('mock_access_token');
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.has('pageSize')).toBe(false);
    expect(url.searchParams.get('signature')).toMatch(/^[a-f0-9]{64}$/u);
    return HttpResponse.json({
      data: [
        {
          composition_id: '2071266138193975100',
          composition_url: 'https://example.com/composition',
          submit_time: '2026-08-17 10:00:00',
          composition_type: 1,
          composition_sub_type: 2,
          keyword: '关键词',
          access_token: 'must-not-leak',
        },
      ],
      pagination: { total: 1, offset: 0, limit: 10 },
      success: true,
    });
  }),
  http.get('https://open.zhihu.com/alliance/api/data_report/real_time_data', ({ request }) => {
    recordUpstream(request);
    const url = new URL(request.url);
    expect(url.searchParams.get('type')).toBe('1');
    expect(url.searchParams.get('time_scale')).toBe('1');
    expect(url.searchParams.get('fields')).toBe('search_num,order_num,created_at');
    expect(url.searchParams.get('access_token')).toBe('mock_access_token');
    expect(url.searchParams.has('timestamp')).toBe(false);
    expect(url.searchParams.has('signature')).toBe(false);
    return HttpResponse.json({
      time_range: '2026-08-17 10:00:00',
      data: [
        {
          keyword: '关键词',
          channel_id: 'channel-1',
          channel_name: '渠道一',
          fields_data: { search_num: 1, order_num: 2, created_at: '2026-08-17', signature: 'must-not-leak' },
        },
      ],
      success: true,
    });
  }),
  http.post('https://second-host.invalid/redirect', () => {
    secondHostRequests += 1;
    return HttpResponse.json({ leaked: true });
  }),
);

beforeAll(() =>
  upstream.listen({
    onUnhandledRequest: (request) => {
      if (new URL(request.url).hostname !== '127.0.0.1') {
        throw new Error(`unexpected upstream request: ${request.method} ${request.url}`);
      }
    },
  }),
);
afterEach(async () => {
  auditSink?.reset();
  await resetAllianceQuotaManager();
  upstream.resetHandlers();
  outboundRequests.length = 0;
  secondHostRequests = 0;
  multerMock.single.mockClear();
  signMock.inject.mockClear();
  signMock.build.mockClear();
});
afterAll(() => upstream.close());

async function bossToken(): Promise<string> {
  return signToken({ id: '1', role: 'admin', parentId: null, username: 'admin', displayName: 'Boss' });
}

async function roleToken(role: 'admin' | 'leader' | 'creator'): Promise<string> {
  return signToken({ id: role, role, parentId: null, username: role, displayName: role });
}

async function rawRequest(app: ReturnType<typeof createApp>, method: string, path: string) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP address');
  try {
    return await new Promise<{ status: number; body: Record<string, unknown>; requestId?: string }>(
      (resolve, reject) => {
        const client = nodeRequest({ hostname: '127.0.0.1', port: address.port, method, path }, (response) => {
          let responseBody = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            responseBody += chunk;
          });
          response.once('end', () => {
            try {
              resolve({
                status: response.statusCode ?? 0,
                body: JSON.parse(responseBody) as Record<string, unknown>,
                requestId: Array.isArray(response.headers['x-request-id'])
                  ? response.headers['x-request-id'][0]
                  : response.headers['x-request-id'],
              });
            } catch (error) {
              reject(error);
            }
          });
        });
        client.once('error', reject);
        client.end();
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition was not observed before the deadline');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

async function installConfirmFailureManager(mode: ConfirmFailureMode) {
  await resetAllianceQuotaManager();
  let now = Date.parse('2026-08-18T12:00:00.000Z');
  const client = new ConfirmFailureRedisClient(mode);
  const decisions: AllianceQuotaDecision[] = [];
  const manager = new AllianceQuotaManager({
    policy: TEST_ALLIANCE_QUOTA_POLICY,
    store: new RedisAllianceQuotaStore({ client }),
    accountToken: 'confirm-failure-account-token',
    clock: () => now,
    leaseTtlMs: 1_000,
    decisionHook: (decision) => decisions.push(decision),
  });
  installAllianceQuotaManager(manager);
  return {
    client,
    decisions,
    expire: () => {
      now += 1_001;
    },
  };
}

function expectErrorEnvelope(
  response: { status: number; body: Record<string, unknown>; headers?: Record<string, string | string[] | undefined> },
  status: number,
  code: number,
  message: string,
): void {
  expect(response.status).toBe(status);
  expect(response.body).toMatchObject({ code, message });
  expect(response.body).not.toHaveProperty('data');
  expect(response.body.requestId).toEqual(expect.any(String));
  expect((response.body.requestId as string).length).toBeGreaterThan(0);
  expect(Number.isSafeInteger(response.body.timestamp)).toBe(true);
  if (response.headers) expect(response.headers['x-request-id']).toBe(response.body.requestId);
}

const validPlan = {
  taskId: 'task-1',
  channelId: 'channel-1',
  contentUrl: 'https://example.com/landing',
  popularizeType: 0,
  keyword: '关键词',
};
const validComposition = {
  planId: 'plan-1',
  channelId: 'channel-1',
  mediaType: 'KOC抖音',
  mediaAccount: 'account-1',
  compositionType: 1,
  compositionSubType: 2,
  compositionUrl: 'https://example.com/composition',
  releaseTime: '2026-08-17T10:00:00+08:00',
};

describe('知乎联盟严格代理', () => {
  let app: ReturnType<typeof createApp>;
  let quota: AllianceQuotaTestFixture;

  beforeEach(async () => {
    await resetAllianceQuotaManager();
    quota = installAllianceQuotaTestFixture();
    auditSink = installAllianceAuditTestSink();
    app = createApp();
  });

  it('P0007-R6-AUDIT-001 / P0007-R6-REDACT-001 audits an allowlist rejection once without sensitive input', async () => {
    const response = await request(app)
      .post('/api/alliance/api/not-registered?secret=query-sentinel')
      .set('Authorization', 'Bearer token-sentinel')
      .set('Cookie', 'secret=cookie-sentinel')
      .send({ secret: 'body-sentinel', signature: 'signature-sentinel' });
    expectErrorEnvelope(response, 404, 40400, '接口不存在');
    expect(auditSink.calls).toBe(1);
    expect(auditSink.events[0]).toMatchObject({
      requestId: response.body.requestId,
      operationKey: null,
      method: 'POST',
      stage: 'allowlist',
      outcome: 'rejected',
      httpStatus: 404,
      code: 40400,
    });
    expect(JSON.stringify(auditSink.events)).not.toMatch(/sentinel|token|signature|cookie|query/iu);
  });

  it('P0007-R6-ONCE-001 maps audit sink failure to 50000 without retrying', async () => {
    auditSink.failWith(new Error('db-sentinel'));
    const response = await request(app).get('/api/alliance/api/not-registered');
    expectErrorEnvelope(response, 500, 50000, '服务器内部错误');
    expect(auditSink.calls).toBe(1);
    expect(quota.decisions).toEqual([]);
    expect(multerMock.single).not.toHaveBeenCalled();
    expect(signMock.inject).not.toHaveBeenCalled();
    expect(signMock.build).not.toHaveBeenCalled();
    expect(outboundRequests).toEqual([]);
    expect(JSON.stringify(response.body)).not.toMatch(/db-sentinel|sql|audit/iu);
  });

  it('P0007-R6-REDACT-001 maps upstream sentinel failures to fixed transport output', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    upstream.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', () =>
        HttpResponse.json({ error: { message: 'secret-sentinel' } }, { status: 503 }),
      ),
    );
    try {
      const response = await request(app)
        .post('/api/alliance/api/popularize_plan')
        .set('Authorization', `Bearer ${await bossToken()}`)
        .send(validPlan);
      expectErrorEnvelope(response, 502, 50200, '知乎服务暂时不可用，请稍后重试');
      expect(auditSink.calls).toBe(1);
      expect(JSON.stringify(response.body)).not.toContain('secret-sentinel');
      expect(JSON.stringify(auditSink.events)).not.toContain('secret-sentinel');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      upstream.resetHandlers();
    }
  });

  it('P0007-R6-REDACT-001 maps an internal ingress exception to fixed 500 without logging', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const original = contracts.prepareAllianceRequest;
    vi.spyOn(contracts, 'prepareAllianceRequest').mockImplementationOnce(() => {
      throw new Error('secret-internal-sentinel');
    });
    try {
      const response = await request(app)
        .post('/api/alliance/api/popularize_plan')
        .set('Authorization', `Bearer ${await bossToken()}`)
        .send(validPlan);
      expectErrorEnvelope(response, 500, 50000, '服务器内部错误');
      expect(auditSink.calls).toBe(1);
      expect(JSON.stringify(response.body)).not.toContain('secret-internal-sentinel');
      expect(JSON.stringify(auditSink.events)).not.toContain('secret-internal-sentinel');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      vi.mocked(contracts.prepareAllianceRequest).mockRestore();
      void original;
      consoleError.mockRestore();
    }
  });

  it('P0007-R6-ONCE-001 does not rerun executed upstream work when audit sink fails', async () => {
    const token = await bossToken();
    auditSink.failWith(new Error('sink-upstream-sentinel'));
    upstream.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', ({ request }) => {
        recordUpstream(request);
        return HttpResponse.json({ error: { message: 'upstream-business-sentinel' } });
      }),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await request(app)
        .post('/api/alliance/api/popularize_plan')
        .set('Authorization', `Bearer ${token}`)
        .send(validPlan);
      expectErrorEnvelope(response, 500, 50000, '服务器内部错误');
      expect(auditSink.calls).toBe(1);
      expect(quota.decisions.map((decision) => decision.action)).toEqual(['reserve', 'release']);
      expect(signMock.inject).toHaveBeenCalledTimes(1);
      expect(outboundRequests).toHaveLength(1);
      expect(multerMock.single).not.toHaveBeenCalled();
      expect(JSON.stringify(response.body)).not.toMatch(/sink-upstream-sentinel|upstream-business-sentinel/iu);
      expect(JSON.stringify(auditSink.events)).not.toMatch(/sink-upstream-sentinel|upstream-business-sentinel/iu);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      upstream.resetHandlers();
    }
  });

  it('P0007-R6-AUDIT-001 records auth and permission rejection with the response requestId', async () => {
    const unauthenticated = await request(app).get('/api/alliance/api/popularize_compositions');
    expectErrorEnvelope(unauthenticated, 401, 40100, '请先登录');
    expect(auditSink.events.at(-1)).toMatchObject({
      requestId: unauthenticated.body.requestId,
      operationKey: 'GET /popularize_compositions',
      stage: 'auth',
      code: 40100,
    });
    const leader = await roleToken('leader');
    const forbidden = await request(app)
      .get('/api/alliance/api/data_report/real_time_data?type=1&timeScale=1&fields=search_num,order_num,created_at')
      .set('Authorization', `Bearer ${leader}`);
    expectErrorEnvelope(forbidden, 403, 40301, '无权执行此操作');
    expect(auditSink.events.at(-1)).toMatchObject({
      requestId: forbidden.body.requestId,
      operationKey: 'GET /data_report/real_time_data',
      stage: 'permission',
      code: 40301,
    });
  });

  it('P0007-R6-AUDIT-001 records quota failures as quota exactly once', async () => {
    await resetAllianceQuotaManager();
    installAllianceQuotaTestFixture({
      policy: {
        dailyBudget: 1,
        costs: Object.fromEntries(
          Object.keys(TEST_ALLIANCE_QUOTA_POLICY.costs).map((key) => [key, 2]),
        ) as typeof TEST_ALLIANCE_QUOTA_POLICY.costs,
      },
    });
    const response = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', `Bearer ${await bossToken()}`)
      .send(validPlan);
    expectErrorEnvelope(response, 429, 42910, '今日请求配额已用尽，请稍后重试');
    expect(auditSink.calls).toBe(1);
    expect(auditSink.events[0]).toMatchObject({ code: 42910, stage: 'quota' });
    expect(signMock.inject).not.toHaveBeenCalled();
    expect(outboundRequests).toEqual([]);
  });

  it('P0007-R6-REDACT-001 redacts a fake Redis reservation sentinel on quota failure', async () => {
    await resetAllianceQuotaManager();
    const manager = new AllianceQuotaManager({
      policy: TEST_ALLIANCE_QUOTA_POLICY,
      store: new RedisAllianceQuotaStore({ client: new SentinelRedisClient() }),
      accountToken: 'redis-reservation-sentinel',
      decisionHook: (decision) => quota.decisions.push(decision),
    });
    installAllianceQuotaManager(manager);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await request(app)
        .post('/api/alliance/api/popularize_plan')
        .set('Authorization', `Bearer ${await bossToken()}`)
        .send(validPlan);
      expectErrorEnvelope(response, 503, 50320, '知乎配额服务暂不可用');
      expect(auditSink.calls).toBe(1);
      expect(auditSink.events[0]).toMatchObject({ code: 50320, stage: 'quota', requestId: response.body.requestId });
      expect(JSON.stringify(response.body)).not.toContain('redis-reservation-sentinel');
      expect(JSON.stringify(auditSink.events)).not.toContain('redis-reservation-sentinel');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('P0007-R6-CANON-001 records dynamic PUT using the template operation key', async () => {
    const token = await bossToken();
    const response = await request(app)
      .put('/api/alliance/api/popularize_composition/v2/2071266138193975100')
      .set('Authorization', `Bearer ${token}`)
      .send({ planId: 'bad' });
    expectErrorEnvelope(response, 422, 42200, '请求参数不正确');
    expect(auditSink.events.at(-1)).toMatchObject({
      operationKey: 'PUT /popularize_composition/v2/{composition_id}',
      stage: 'schema',
      outcome: 'rejected',
    });
    expect(JSON.stringify(auditSink.events.at(-1))).not.toContain('2071266138193975100');
  });

  it('P0007-R6-REDACT-001 records encoded and traversal paths as unknown without raw identifiers', async () => {
    for (const path of [
      '/api/alliance/api/%70opularize_compositions?sentinel=encoded',
      '/api/alliance/api/%2e%2e/popularize_compositions?sentinel=traversal',
    ]) {
      const callsBefore = auditSink.calls;
      const response = await rawRequest(app, 'GET', path);
      expect(response.status).toBe(404);
      expect(auditSink.calls).toBe(callsBefore + 1);
      const event = auditSink.events.at(-1);
      expect(event).toMatchObject({
        operationKey: null,
        code: 40400,
        stage: 'allowlist',
        requestId: response.requestId,
      });
      expect(JSON.stringify(event)).not.toMatch(/encoded|traversal|sentinel|popularize_compositions/iu);
    }
  });

  it('P0007-R1-DENY-001 rejects unknown, malformed, and wrong-method paths before auth and egress', async () => {
    const denied = await Promise.all([
      request(app).post('/api/alliance/api/popularize_composition/v1').send({}),
      request(app).get('/api/alliance/api/popularize_compositions/v2'),
      request(app).put('/api/alliance/api/popularize_composition/v2/01').send({}),
      request(app).get('/api/alliance/api/api/alliance/api/popularize_compositions'),
      request(app)
        .post('/api/alliance/api/popularize_plans/')
        .field('taskId', 'task-1')
        .attach('file', Buffer.from('not-read'), 'plans.csv'),
      request(app)
        .post('/api/alliance/api/api/alliance/api/popularize_plans')
        .field('taskId', 'task-1')
        .attach('file', Buffer.from('not-read'), 'plans.csv'),
    ]);
    const rawSemicolon = await rawRequest(app, 'GET', '/api/alliance/api/get_agent_channels;foo');
    const rawEncoded = await rawRequest(app, 'GET', '/api/alliance/api/%70opularize_composition/v1');
    const rawDoubleEncoded = await rawRequest(app, 'GET', '/api/alliance/api/%2570opularize_composition/v1');
    const head = await request(app).head('/api/alliance/api/popularize_compositions');

    for (const response of denied) expectErrorEnvelope(response, 404, 40400, '接口不存在');
    expectErrorEnvelope(rawSemicolon, 404, 40400, '接口不存在');
    expectErrorEnvelope(rawEncoded, 404, 40400, '接口不存在');
    expectErrorEnvelope(rawDoubleEncoded, 404, 40400, '接口不存在');
    expect(head.status).toBe(404);
    expect(head.headers['x-request-id']).toMatch(/.+/u);
    expect(outboundRequests).toEqual([]);
    expect(multerMock.single).not.toHaveBeenCalled();
    expect(signMock.inject).not.toHaveBeenCalled();
    expect(signMock.build).not.toHaveBeenCalled();
  });

  it('P0007-R5-PERM-001 / P0007-R5-NEG-001 / P0007-R5-ORDER-001 enforces the seven-endpoint role matrix before quota and side effects', async () => {
    const endpoints = [
      {
        method: 'post',
        path: '/api/alliance/api/popularize_plan',
        body: validPlan,
        permission: 'write',
        expectedStatus: 200,
      },
      {
        method: 'post',
        path: '/api/alliance/api/popularize_plans',
        body: undefined,
        permission: 'write',
        expectedStatus: 415,
      },
      {
        method: 'post',
        path: '/api/alliance/api/popularize_composition/v2',
        body: { ...validComposition, compositionType: 1, compositionSubType: 2 },
        permission: 'write',
        expectedStatus: 200,
      },
      {
        method: 'post',
        path: '/api/alliance/api/popularize_compositions/v2',
        body: undefined,
        permission: 'write',
        expectedStatus: 415,
      },
      {
        method: 'put',
        path: '/api/alliance/api/popularize_composition/v2/2071266138193975100',
        body: { ...validComposition, compositionType: 1, compositionSubType: 2 },
        permission: 'write',
        expectedStatus: 200,
      },
      {
        method: 'get',
        path: '/api/alliance/api/popularize_compositions?channelId=channel-1&keyword=%E5%85%B3%E9%94%AE%E8%AF%8D&page=1&pageSize=10',
        body: undefined,
        permission: 'project',
        expectedStatus: 200,
      },
      {
        method: 'get',
        path: '/api/alliance/api/data_report/real_time_data?type=1&timeScale=1&fields=search_num,order_num,created_at',
        body: undefined,
        permission: 'earning',
        expectedStatus: 200,
      },
    ] as const;
    const expectedForbidden = new Set(['leader:project', 'leader:earning', 'creator:project', 'creator:earning']);

    for (const role of ['admin', 'leader', 'creator'] as const) {
      for (const endpoint of endpoints) {
        quota.decisions.length = 0;
        multerMock.single.mockClear();
        signMock.inject.mockClear();
        signMock.build.mockClear();
        outboundRequests.length = 0;
        const token = await roleToken(role);
        const builder = request(app)[endpoint.method](endpoint.path).set('Authorization', `Bearer ${token}`);
        const response = endpoint.body === undefined ? await builder : await builder.send(endpoint.body);
        const key = `${role}:${endpoint.permission}`;
        if (expectedForbidden.has(key)) {
          expectErrorEnvelope(response, 403, 40301, '无权执行此操作');
          expect(quota.decisions).toEqual([]);
          expect(multerMock.single).not.toHaveBeenCalled();
          expect(signMock.inject).not.toHaveBeenCalled();
          expect(signMock.build).not.toHaveBeenCalled();
          expect(outboundRequests).toEqual([]);
        } else {
          expect(response.status, `${role} ${endpoint.method} ${endpoint.path}`).toBe(endpoint.expectedStatus);
          expect(quota.decisions.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('P0007-R5-NOSCOPE-001 ignores permission values supplied by clients', async () => {
    for (const role of ['leader', 'creator'] as const) {
      quota.decisions.length = 0;
      multerMock.single.mockClear();
      signMock.inject.mockClear();
      signMock.build.mockClear();
      outboundRequests.length = 0;
      const token = await roleToken(role);
      const response = await request(app)
        .get('/api/alliance/api/data_report/real_time_data')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Permission', 'earning.view_all')
        .set('X-Project-Id', 'project-forged')
        .query({ type: 1, timeScale: 1, fields: 'search_num', permission: 'earning.view_all' });
      expectErrorEnvelope(response, 403, 40301, '无权执行此操作');
      expect(quota.decisions).toEqual([]);
      expect(multerMock.single).not.toHaveBeenCalled();
      expect(signMock.inject).not.toHaveBeenCalled();
      expect(signMock.build).not.toHaveBeenCalled();
      expect(outboundRequests).toEqual([]);
    }
  });

  it('P0007-R1-BODY-001 preserves raw Registry, auth, and JSON parser ordering', async () => {
    const token = await bossToken();
    const unknown = await request(app)
      .post('/api/alliance/api/not-registered')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    const unauthenticated = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    const authenticated = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expectErrorEnvelope(unknown, 404, 40400, '接口不存在');
    expectErrorEnvelope(unauthenticated, 401, 40100, '请先登录');
    expectErrorEnvelope(authenticated, 400, 40000, '请求体不是有效 JSON');
    expect(outboundRequests).toEqual([]);
    expect(signMock.inject).not.toHaveBeenCalled();
  });

  it('P0007-R2A-SCHEMA-001 rejects five runtime ingress classes before signing or egress', async () => {
    const token = await bossToken();
    const responses = await Promise.all([
      request(app)
        .post('/api/alliance/api/popularize_plan')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validPlan, task_id: 'bad' }),
      request(app)
        .post('/api/alliance/api/popularize_composition/v2')
        .set('Authorization', `Bearer ${token}`)
        .send({ planId: 'missing' }),
      request(app)
        .put('/api/alliance/api/popularize_composition/v2/2071266138193975100')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validComposition, signature: 'client-forged' }),
      request(app)
        .get(
          '/api/alliance/api/popularize_compositions?channelId=channel-1&keyword=%E5%85%B3%E9%94%AE%E8%AF%8D&pageSize=101',
        )
        .set('Authorization', `Bearer ${token}`),
      request(app)
        .get('/api/alliance/api/data_report/real_time_data?type=1&timeScale=1&fields=search_num&timestamp=forged')
        .set('Authorization', `Bearer ${token}`),
    ]);

    for (const response of responses) expectErrorEnvelope(response, 422, 42200, '请求参数不正确');
    expect(outboundRequests).toEqual([]);
    expect(signMock.inject).not.toHaveBeenCalled();
    expect(multerMock.single).not.toHaveBeenCalled();
  });

  it('P0007-R3-BATCH-001 submits both safe XLSX batches and projects canonical task IDs', async () => {
    const token = await bossToken();
    const fixture = buildMinimalXlsxFixture();
    const planBatch = await request(app)
      .post('/api/alliance/api/popularize_plans')
      .set('Authorization', `Bearer ${token}`)
      .field('taskId', 'task-1')
      .field('channelId', 'channel-1')
      .field('popularizeType', '0')
      .attach('file', fixture, { filename: 'plans.xlsx', contentType: XLSX_MIME });
    const compositionBatch = await request(app)
      .post('/api/alliance/api/popularize_compositions/v2')
      .set('Authorization', `Bearer ${token}`)
      .field('bindType', '1')
      .field('channelId', 'channel-1')
      .attach('file', buildMinimalXlsxFixture(), { filename: 'compositions.xlsx', contentType: XLSX_MIME });

    expect(planBatch.status).toBe(200);
    expect(planBatch.body.data).toEqual({ batchTaskId: '2071267000000000001' });
    expect(compositionBatch.status).toBe(200);
    expect(compositionBatch.body.data).toEqual({ batchTaskId: '2071267000000000002' });
    expect(outboundRequests).toEqual([
      'POST /alliance/api/popularize_plans',
      'POST /alliance/api/popularize_compositions/v2',
    ]);
    expect(multerMock.single).toHaveBeenCalledTimes(2);
    expect(signMock.inject).toHaveBeenCalledTimes(2);
  });

  it('P0007-R2A-ROUTE-001 serves the five non-batch exact operations with canonical envelopes', async () => {
    const token = await bossToken();
    const plan = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', `Bearer ${token}`)
      .send(validPlan);
    const create = await request(app)
      .post('/api/alliance/api/popularize_composition/v2')
      .set('Authorization', `Bearer ${token}`)
      .send(validComposition);
    const update = await request(app)
      .put('/api/alliance/api/popularize_composition/v2/2071266138193975100')
      .set('Authorization', `Bearer ${token}`)
      .send(validComposition);
    const list = await request(app)
      .get('/api/alliance/api/popularize_compositions?channelId=channel-1&keyword=%E5%85%B3%E9%94%AE%E8%AF%8D')
      .set('Authorization', `Bearer ${token}`);
    const realtime = await request(app)
      .get('/api/alliance/api/data_report/real_time_data?type=1&timeScale=1&fields=search_num,order_num,created_at')
      .set('Authorization', `Bearer ${token}`);

    expect([plan.status, create.status, update.status, list.status, realtime.status]).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(plan.body).toMatchObject({ code: 0, data: { planId: '2071265453767405652' } });
    expect(create.body).toMatchObject({ code: 0, data: { compositionId: '2071266138193975100' } });
    expect(update.body).toMatchObject({ code: 0, data: null });
    expect(list.body).toMatchObject({
      code: 0,
      data: [{ compositionId: '2071266138193975100', compositionUrl: 'https://example.com/composition' }],
      meta: { page: 1, pageSize: 10, total: 1 },
    });
    expect(realtime.body).toMatchObject({
      code: 0,
      data: { timeRange: '2026-08-17 10:00:00', items: [{ channelId: 'channel-1', fieldsData: { searchNum: 1 } }] },
    });
    for (const response of [plan, create, update, list, realtime]) {
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
      expect(Number.isSafeInteger(response.body.timestamp)).toBe(true);
      expect(JSON.stringify(response.body)).not.toMatch(/success|access_token|signature|secret/u);
    }
    expect(
      new Set([
        plan.body.requestId,
        create.body.requestId,
        update.body.requestId,
        list.body.requestId,
        realtime.body.requestId,
      ]).size,
    ).toBe(5);
    expect(outboundRequests).toEqual([
      'POST /alliance/api/popularize_plan',
      'POST /alliance/api/popularize_composition/v2',
      'PUT /alliance/api/popularize_composition/v2/2071266138193975100',
      'GET /alliance/api/popularize_compositions',
      'GET /alliance/api/data_report/real_time_data',
    ]);
    expect(signMock.inject).toHaveBeenCalledTimes(4);
    expect(multerMock.single).not.toHaveBeenCalled();
  });

  it('P0007-R1-REDIRECT-001 maps every redirect to a safe canonical transport failure', async () => {
    const token = await bossToken();
    for (const status of [301, 302, 303, 307, 308]) {
      upstream.use(
        http.post(
          'https://open.zhihu.com/alliance/api/popularize_plan',
          () =>
            new HttpResponse(null, {
              status,
              headers: { Location: 'https://second-host.invalid/redirect?access_token=secret' },
            }),
        ),
      );
      const response = await request(app)
        .post('/api/alliance/api/popularize_plan')
        .set('Authorization', `Bearer ${token}`)
        .send(validPlan);
      expectErrorEnvelope(response, 502, 50200, '知乎服务暂时不可用，请稍后重试');
      expect(response.headers.location).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('secret');
      expect(secondHostRequests).toBe(0);
      upstream.resetHandlers();
    }
  });

  it('P0007-R2A-RESP-002 maps upstream rejection and malformed success safely', async () => {
    const token = await bossToken();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const assertFailure = (
      response: request.Response,
      index: number,
      stage: 'upstream',
      upstreamFailure: 'business' | 'protocol' | 'transport',
      sentinel: string,
    ) => {
      expectErrorEnvelope(
        response,
        503 - (upstreamFailure === 'business' ? 0 : 1),
        upstreamFailure === 'business' ? 50300 : 50200,
        upstreamFailure === 'business' ? '知乎请求被拒绝，请稍后重试' : '知乎服务暂时不可用，请稍后重试',
      );
      expect(auditSink.events[index]).toMatchObject({
        requestId: response.body.requestId,
        stage,
        upstreamFailure,
      });
      expect(JSON.stringify(response.body)).not.toContain(sentinel);
      expect(JSON.stringify(auditSink.events[index])).not.toContain(sentinel);
    };
    upstream.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', () =>
        HttpResponse.json({ error: { code: 49002, message: 'access_token=secret signature=secret' } }),
      ),
    );
    const business = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', `Bearer ${token}`)
      .send(validPlan);
    assertFailure(business, 0, 'upstream', 'business', 'secret');

    upstream.resetHandlers();
    upstream.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', () =>
        HttpResponse.json({ data: { plan_name: 'missing id access_token=secret' }, success: true }),
      ),
    );
    const malformed = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', `Bearer ${token}`)
      .send(validPlan);
    assertFailure(malformed, 1, 'upstream', 'protocol', 'secret');

    upstream.resetHandlers();
    upstream.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', () =>
        HttpResponse.json({ error: { message: 'upstream failure access_token=secret' } }, { status: 503 }),
      ),
    );
    const httpFailure = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', `Bearer ${token}`)
      .send(validPlan);
    assertFailure(httpFailure, 2, 'upstream', 'transport', 'secret');
    expect(auditSink.calls).toBe(3);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('P0007-R4-LIFECYCLE-001 confirms projected success and releases every validation/business/protocol failure', async () => {
    const token = await bossToken();
    const successful = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', `Bearer ${token}`)
      .send(validPlan);
    expect(successful.status).toBe(200);
    expect(quota.decisions.map((decision) => decision.action)).toEqual(['reserve', 'confirm']);

    quota.decisions.length = 0;
    const invalid = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validPlan, signature: 'forged' });
    expectErrorEnvelope(invalid, 422, 42200, '请求参数不正确');
    expect(quota.decisions.map((decision) => decision.action)).toEqual(['reserve', 'release']);

    quota.decisions.length = 0;
    upstream.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', () =>
        HttpResponse.json({ error: { code: 49002, message: 'rejected' } }),
      ),
    );
    const business = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', `Bearer ${token}`)
      .send(validPlan);
    expectErrorEnvelope(business, 503, 50300, '知乎请求被拒绝，请稍后重试');
    expect(quota.decisions.map((decision) => decision.action)).toEqual(['reserve', 'release']);

    quota.decisions.length = 0;
    upstream.resetHandlers();
    upstream.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', () =>
        HttpResponse.json({ data: { plan_name: 'missing id' }, success: true }),
      ),
    );
    const protocol = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', `Bearer ${token}`)
      .send(validPlan);
    expectErrorEnvelope(protocol, 502, 50200, '知乎服务暂时不可用，请稍后重试');
    expect(quota.decisions.map((decision) => decision.action)).toEqual(['reserve', 'release']);

    quota.decisions.length = 0;
    upstream.resetHandlers();
    upstream.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', () =>
        HttpResponse.json({ error: { message: 'transport failure' } }, { status: 503 }),
      ),
    );
    const transport = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', `Bearer ${token}`)
      .send(validPlan);
    expectErrorEnvelope(transport, 502, 50200, '知乎服务暂时不可用，请稍后重试');
    expect(quota.decisions.map((decision) => decision.action)).toEqual(['reserve', 'release']);
  });

  it.each([
    { mode: 'zero' as const, label: 'Lua confirm 返回 0' },
    { mode: 'missing' as const, label: 'reservation 缺失' },
    { mode: 'expired' as const, label: 'reservation 已过期' },
  ])('P0007-R4-CONFIG-001 fails closed when $label', async ({ mode }) => {
    const fixture = await installConfirmFailureManager(mode);
    const token = await bossToken();
    upstream.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', ({ request }) => {
        recordUpstream(request);
        if (mode === 'expired') fixture.expire();
        return HttpResponse.json({ data: { plan_id: '2071265453767405652' }, success: true });
      }),
    );

    const response = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', `Bearer ${token}`)
      .send(validPlan);

    expectErrorEnvelope(response, 503, 50320, '知乎配额服务暂不可用');
    expect(response.body).not.toHaveProperty('data');
    expect(outboundRequests).toEqual(['POST /alliance/api/popularize_plan']);
    expect(signMock.inject).toHaveBeenCalledTimes(1);
    expect(fixture.client.calls.map((call) => call.script)).toEqual([
      ALLIANCE_QUOTA_RESERVE_SCRIPT,
      ALLIANCE_QUOTA_CONFIRM_SCRIPT,
      ALLIANCE_QUOTA_RELEASE_SCRIPT,
    ]);
    expect(fixture.decisions.map((decision) => [decision.action, decision.result])).toEqual([
      ['reserve', 'allowed'],
      ['confirm', 'failed'],
      ['release', 'released'],
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/reservation|redis|budget|confirm-failure|50310/iu);
  });

  it('P0007-R4-LIFECYCLE-001 releases the lease when the client disconnects before upstream completion', async () => {
    const token = await bossToken();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let completeUpstream!: () => void;
    const upstreamGate = new Promise<void>((resolve) => {
      completeUpstream = resolve;
    });
    upstream.use(
      http.post('https://open.zhihu.com/alliance/api/popularize_plan', async ({ request }) => {
        recordUpstream(request);
        await upstreamGate;
        return HttpResponse.json({ error: { message: 'close-upstream-sentinel' } }, { status: 503 });
      }),
    );

    const listeningServer = app.listen(0);
    await new Promise<void>((resolve) => listeningServer.once('listening', resolve));
    const address = listeningServer.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP address');
    const body = JSON.stringify(validPlan);
    const client = nodeRequest({
      hostname: '127.0.0.1',
      port: address.port,
      method: 'POST',
      path: '/api/alliance/api/popularize_plan',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    });
    client.on('error', () => undefined);
    client.end(body);

    try {
      await waitForCondition(
        () => quota.decisions.some((decision) => decision.action === 'reserve') && outboundRequests.length === 1,
      );
      client.destroy();
      await waitForCondition(() => quota.decisions.some((decision) => decision.action === 'release'));
      expect(quota.decisions.map((decision) => decision.action)).toEqual(['reserve', 'release']);
      completeUpstream();
      await waitForCondition(() => auditSink.calls === 1);
      expect(auditSink.calls).toBe(1);
      expect(auditSink.events[0]).toMatchObject({ stage: 'upstream', code: 50200, upstreamFailure: 'transport' });
      expect(JSON.stringify(auditSink.events)).not.toContain('close-upstream-sentinel');
      expect(consoleError).not.toHaveBeenCalled();
      expect(signMock.inject).toHaveBeenCalledTimes(1);
      expect(outboundRequests).toHaveLength(1);
    } finally {
      completeUpstream();
      consoleError.mockRestore();
      await new Promise<void>((resolve, reject) =>
        listeningServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
