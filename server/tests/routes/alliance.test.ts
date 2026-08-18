import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request, { type Response as SupertestResponse } from 'supertest';
import { setupServer } from 'msw/node';
import type { RequestHandler } from 'express';
import { createApp } from '../../src/app';
import type { Express } from 'express';
import * as jwt from '../../src/auth/jwt';
import * as revocation from '../../src/auth/revocation';
import { XLSX_MAX_BYTES, XLSX_MIME } from '../../src/zhihu/allianceXlsx';
import { resetAllianceQuotaManager } from '../../src/zhihu/allianceQuota';
import { installAllianceQuotaTestFixture, TEST_ALLIANCE_QUOTA_POLICY } from '../support/allianceQuotaFixture';
import { buildMinimalXlsxFixture } from '../support/allianceXlsxFixture';
import { installAllianceAuditTestSink } from '../support/allianceAuditFixture';

const multerMock = vi.hoisted(() => ({ single: vi.fn() }));
const signMock = vi.hoisted(() => ({ inject: vi.fn(), build: vi.fn() }));
const egressMock = vi.hoisted(() => ({ request: vi.fn(), response: vi.fn() }));

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

vi.mock('../../src/zhihu/allianceEgress', async () => {
  const actual = await vi.importActual<typeof import('../../src/zhihu/allianceEgress')>(
    '../../src/zhihu/allianceEgress',
  );
  return {
    ...actual,
    requestAlliance: (...args: Parameters<typeof actual.requestAlliance>) => {
      const request = args[0];
      egressMock.request({
        endpoint: request.endpoint,
        data:
          request.data instanceof FormData
            ? {
                keys: [...request.data.keys()],
                file: request.data.get('file') instanceof Blob,
              }
            : request.data,
      });
      return egressMock.response(...args);
    },
  };
});

const server = setupServer();

beforeAll(() =>
  server.listen({
    onUnhandledRequest: (request) => {
      if (new URL(request.url).hostname !== '127.0.0.1') {
        throw new Error(`unexpected external request: ${request.method} ${request.url}`);
      }
    },
  }),
);
afterAll(() => server.close());

function expectUploadInvalid(response: SupertestResponse): void {
  expect(response.status).toBe(422);
  expect(response.body).toMatchObject({ code: 42200, message: '上传文件不符合要求' });
  expect(response.body).not.toHaveProperty('data');
  expect(response.body.requestId).toBe(response.headers['x-request-id']);
  expect(Number.isSafeInteger(response.body.timestamp)).toBe(true);
}

describe('知乎联盟批量上传 Gate', () => {
  let app: Express;
  let auditSink: ReturnType<typeof installAllianceAuditTestSink>;

  beforeEach(async () => {
    await resetAllianceQuotaManager();
    installAllianceQuotaTestFixture();
    auditSink = installAllianceAuditTestSink();
    server.resetHandlers();
    multerMock.single.mockClear();
    signMock.inject.mockClear();
    signMock.build.mockClear();
    egressMock.request.mockClear();
    egressMock.response.mockReset();
    egressMock.response.mockImplementation((request: { endpoint: { definitionKey: string } }) => {
      const isPlan = request.endpoint.definitionKey === 'POST /popularize_plans';
      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: {
          data: { batch_task_id: isPlan ? '2071267000000000001' : '2071267000000000002' },
          success: true,
        },
      });
    });
    vi.spyOn(jwt, 'verifyToken').mockReturnValue({
      sub: 'test-user-id',
      role: 'boss' as const,
      parentId: null,
      username: 'testuser',
      displayName: 'Test User',
      jti: 'test-jti',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    vi.spyOn(revocation.revocationStore, 'isRevoked').mockResolvedValue(false);
    app = createApp();
  });

  afterEach(async () => {
    await resetAllianceQuotaManager();
    auditSink?.reset();
  });

  it('P0007-R1-DENY-001 rejects removed legacy multipart paths before Multer, signing, and egress', async () => {
    const responses = await Promise.all([
      request(app)
        .post('/api/alliance/api/upload_image')
        .set('Authorization', 'Bearer fake-token')
        .attach('image', Buffer.from('not-read'), 'image.png'),
      request(app).get('/api/alliance/api/get_batch_task_result').set('Authorization', 'Bearer fake-token'),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 40400, message: '接口不存在' });
      expect(response.body).not.toHaveProperty('data');
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
      expect(Number.isSafeInteger(response.body.timestamp)).toBe(true);
    }
    expect(multerMock.single).not.toHaveBeenCalled();
    expect(signMock.inject).not.toHaveBeenCalled();
    expect(signMock.build).not.toHaveBeenCalled();
    expect(egressMock.request).not.toHaveBeenCalled();
  });

  it('P0007-R5-REGRESSION-001 / P0007-R3-MIME-001 rejects invalid files before signing or egress', async () => {
    const planBatch = await request(app)
      .post('/api/alliance/api/popularize_plans')
      .set('Authorization', 'Bearer fake-token')
      .field('taskId', 'task-1')
      .field('channelId', 'channel-1')
      .field('popularizeType', '0')
      .attach('file', Buffer.from('plan-bytes'), 'plans.csv');
    const compositionBatch = await request(app)
      .post('/api/alliance/api/popularize_compositions/v2')
      .set('Authorization', 'Bearer fake-token')
      .field('bindType', '1')
      .field('channelId', 'channel-1')
      .attach('file', Buffer.from('composition-bytes'), 'compositions.csv');

    expectUploadInvalid(planBatch);
    expectUploadInvalid(compositionBatch);
    expect(multerMock.single).toHaveBeenCalledTimes(2);
    expect(signMock.inject).not.toHaveBeenCalled();
    expect(signMock.build).not.toHaveBeenCalled();
    expect(egressMock.request).not.toHaveBeenCalled();
  });

  it('P0007-R3-ORDER-001 rejects malformed Content-Type before endpoint Multer', async () => {
    const response = await request(app)
      .post('/api/alliance/api/popularize_plans')
      .set('Authorization', 'Bearer fake-token')
      .set('Content-Type', 'multipart/form-data')
      .send('ignored');

    expect(response.status).toBe(415);
    expect(response.body).toMatchObject({ code: 41500, message: '上传请求格式不正确' });
    expect(response.body).not.toHaveProperty('data');
    expect(multerMock.single).not.toHaveBeenCalled();
    expect(signMock.inject).not.toHaveBeenCalled();
    expect(egressMock.request).not.toHaveBeenCalled();
    expect(auditSink.events.at(-1)).toMatchObject({ code: 41500, stage: 'parser' });
    expect(auditSink.calls).toBe(1);
  });

  it('P0007-R3-ORDER-001 maps missing, duplicate, and unknown multipart fields to a safe 422', async () => {
    const fixture = buildMinimalXlsxFixture();
    const missingFile = await request(app)
      .post('/api/alliance/api/popularize_plans')
      .set('Authorization', 'Bearer fake-token')
      .field('taskId', 'task-1')
      .field('channelId', 'channel-1')
      .field('popularizeType', '0');
    const duplicate = await request(app)
      .post('/api/alliance/api/popularize_plans')
      .set('Authorization', 'Bearer fake-token')
      .field('taskId', 'task-1')
      .field('taskId', 'task-2')
      .field('channelId', 'channel-1')
      .field('popularizeType', '0')
      .attach('file', fixture, { filename: 'client.xlsx', contentType: XLSX_MIME });
    const unknown = await request(app)
      .post('/api/alliance/api/popularize_plans')
      .set('Authorization', 'Bearer fake-token')
      .field('taskId', 'task-1')
      .field('channelId', 'channel-1')
      .field('popularizeType', '0')
      .field('unexpected', 'do-not-forward')
      .attach('file', buildMinimalXlsxFixture(), { filename: 'client.xlsx', contentType: XLSX_MIME });

    for (const response of [missingFile, duplicate, unknown]) {
      expectUploadInvalid(response);
      expect(JSON.stringify(response.body)).not.toContain('unexpected');
      expect(JSON.stringify(response.body)).not.toContain('client.xlsx');
    }
    expect(auditSink.events.filter((event) => event.code === 42200)).toHaveLength(3);
    expect(auditSink.events.filter((event) => event.stage === 'schema')).toHaveLength(3);
    expect(JSON.stringify(auditSink.events)).not.toMatch(/client\.xlsx|do-not-forward|redis|reservation/iu);
    expect(egressMock.request).not.toHaveBeenCalled();
  });

  it('P0007-R6-REDACT-001 rejects multipart filename and file-content sentinels', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const filenameSentinel = 'filename-sentinel.xlsx';
    const fileSentinel = 'file-content-sentinel';
    try {
      const response = await request(app)
        .post('/api/alliance/api/popularize_plans')
        .set('Authorization', 'Bearer fake-token')
        .field('taskId', 'task-1')
        .field('channelId', 'channel-1')
        .field('popularizeType', '0')
        .field('unexpected', fileSentinel)
        .attach('file', Buffer.from(fileSentinel), {
          filename: filenameSentinel,
          contentType: XLSX_MIME,
        });
      expectUploadInvalid(response);
      expect(auditSink.calls).toBe(1);
      expect(auditSink.events[0]).toMatchObject({ code: 42200, stage: 'schema', requestId: response.body.requestId });
      expect(JSON.stringify(response.body)).not.toContain(filenameSentinel);
      expect(JSON.stringify(response.body)).not.toContain(fileSentinel);
      expect(JSON.stringify(auditSink.events)).not.toContain(filenameSentinel);
      expect(JSON.stringify(auditSink.events)).not.toContain(fileSentinel);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('P0007-R3-LIMIT-001 accepts the semantic 10 MiB boundary only as a parser input and rejects the next byte', async () => {
    const response = await request(app)
      .post('/api/alliance/api/popularize_plans')
      .set('Authorization', 'Bearer fake-token')
      .field('taskId', 'task-1')
      .field('channelId', 'channel-1')
      .field('popularizeType', '0')
      .attach('file', Buffer.alloc(XLSX_MAX_BYTES + 1, 0x41), {
        filename: 'boundary.xlsx',
        contentType: XLSX_MIME,
      });

    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ code: 41300, message: '上传文件过大' });
    expect(JSON.stringify(response.body)).not.toContain('boundary.xlsx');
    expect(signMock.inject).not.toHaveBeenCalled();
    expect(egressMock.request).not.toHaveBeenCalled();
    expect(auditSink.events.at(-1)).toMatchObject({ code: 41300, stage: 'parser' });
    expect(auditSink.calls).toBe(1);
    expect(JSON.stringify(auditSink.events)).not.toMatch(/boundary\.xlsx|redis|reservation/iu);
  });

  it('P0007-R3-FORM-001 sends native FormData only after strict route validation', async () => {
    const fixture = buildMinimalXlsxFixture();
    const planBatch = await request(app)
      .post('/api/alliance/api/popularize_plans')
      .set('Authorization', 'Bearer fake-token')
      .field('taskId', 'task-1')
      .field('channelId', 'channel-1')
      .field('popularizeType', '0')
      .field('secondChannelId', 'second-1')
      .attach('file', buildMinimalXlsxFixture(), { filename: 'client.xlsx', contentType: XLSX_MIME });
    const compositionBatch = await request(app)
      .post('/api/alliance/api/popularize_compositions/v2')
      .set('Authorization', 'Bearer fake-token')
      .field('bindType', '1')
      .field('channelId', 'channel-1')
      .attach('file', fixture, { filename: 'client.xlsx', contentType: XLSX_MIME });

    expect(planBatch.status).toBe(200);
    expect(planBatch.body.data).toEqual({ batchTaskId: '2071267000000000001' });
    expect(compositionBatch.status).toBe(200);
    expect(compositionBatch.body.data).toEqual({ batchTaskId: '2071267000000000002' });
    expect(egressMock.request).toHaveBeenCalledTimes(2);
    const planRequest = egressMock.request.mock.calls[0]?.[0] as { data: { keys: string[]; file: boolean } };
    const compositionRequest = egressMock.request.mock.calls[1]?.[0] as { data: { keys: string[]; file: boolean } };
    expect(planRequest.data.file).toBe(true);
    expect(compositionRequest.data.file).toBe(true);
    expect(planRequest.data.keys).toEqual([
      'task_id',
      'channel_id',
      'popularize_type',
      'second_channel_id',
      'access_token',
      'timestamp',
      'signature',
      'file',
    ]);
    expect(compositionRequest.data.keys).toEqual([
      'bind_type',
      'channel_id',
      'access_token',
      'timestamp',
      'signature',
      'file',
    ]);
  });

  it('keeps authentication ahead of the R3 upload gate', async () => {
    const response = await request(app)
      .post('/api/alliance/api/popularize_plans')
      .field('taskId', 'task-1')
      .attach('file', Buffer.from('not-read'), 'plans.csv');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 40100, message: '请先登录' });
    expect(response.body).not.toHaveProperty('data');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    expect(multerMock.single).not.toHaveBeenCalled();
  });

  it('P0007-R5-REGRESSION-001 / P0007-R4-QUOTA-001 and P0007-R4-ORDER-001 reject exhausted quota before every parser and egress side effect', async () => {
    await resetAllianceQuotaManager();
    const quota = installAllianceQuotaTestFixture({
      policy: { dailyBudget: 1, costs: TEST_ALLIANCE_QUOTA_POLICY.costs },
      accessToken: 'fixed-account-token',
    });
    const accepted = await request(app)
      .post('/api/alliance/api/popularize_plans')
      .set('Authorization', 'Bearer fake-token')
      .field('taskId', 'task-1')
      .field('channelId', 'channel-1')
      .field('popularizeType', '0')
      .attach('file', buildMinimalXlsxFixture(), { filename: 'accepted.xlsx', contentType: XLSX_MIME });
    expect(accepted.status).toBe(200);
    expect(auditSink.calls).toBe(0);
    expect(auditSink.events).toEqual([]);
    expect(quota.decisions.map((decision) => decision.action)).toEqual(['reserve', 'confirm']);

    multerMock.single.mockClear();
    signMock.inject.mockClear();
    signMock.build.mockClear();
    egressMock.request.mockClear();
    const exhausted = await request(app)
      .post('/api/alliance/api/popularize_plan')
      .set('Authorization', 'Bearer fake-token')
      .set('X-Forwarded-For', '203.0.113.8')
      .set('X-Quota-Scope', 'forged')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(exhausted.status).toBe(429);
    expect(exhausted.body).toMatchObject({ code: 42910, message: '今日请求配额已用尽，请稍后重试' });
    expect(JSON.stringify(exhausted.body)).not.toMatch(/fixed-account|forged|203\.0\.113\.8|budget|redis/iu);
    expect(auditSink.events.at(-1)).toMatchObject({
      requestId: exhausted.body.requestId,
      code: 42910,
      stage: 'quota',
    });
    expect(auditSink.calls).toBe(1);
    expect(multerMock.single).not.toHaveBeenCalled();
    expect(signMock.inject).not.toHaveBeenCalled();
    expect(signMock.build).not.toHaveBeenCalled();
    expect(egressMock.request).not.toHaveBeenCalled();

    const unauthenticated = await request(app).post('/api/alliance/api/popularize_plan').send({});
    vi.mocked(jwt.verifyToken).mockReturnValueOnce({
      sub: 'leader-id',
      role: 'leader',
      parentId: null,
      username: 'leader',
      displayName: 'Leader',
      jti: 'leader-jti',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const forbidden = await request(app)
      .get('/api/alliance/api/data_report/real_time_data')
      .set('Authorization', 'Bearer leader-token')
      .send({});
    const unknown = await request(app)
      .post('/api/alliance/api/not-registered')
      .set('Authorization', 'Bearer fake-token')
      .send({});
    expect(unauthenticated.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(unknown.status).toBe(404);
    expect(quota.decisions.map((decision) => decision.action)).toEqual(['reserve', 'confirm', 'reject']);
  });

  it('P0007-R4-CONFIG-001 keeps the uninjected production path fail closed without contacting Redis or parsers', async () => {
    await resetAllianceQuotaManager();
    for (const key of [
      'ALLIANCE_QUOTA_POLICY_JSON',
      'ALLIANCE_QUOTA_POLICY',
      'ZHIHU_ALLIANCE_QUOTA_POLICY_JSON',
      'ZHIHU_ALLIANCE_QUOTA_POLICY',
    ]) {
      vi.stubEnv(key, '');
    }
    try {
      const response = await request(app)
        .post('/api/alliance/api/popularize_plan')
        .set('Authorization', 'Bearer fake-token')
        .set('Content-Type', 'application/json')
        .send('{"broken":');
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ code: 50320, message: '知乎配额服务暂不可用' });
      expect(auditSink.events.at(-1)).toMatchObject({
        requestId: response.body.requestId,
        code: 50320,
        stage: 'quota',
      });
      expect(JSON.stringify(response.body)).not.toMatch(/policy|redis|token|secret|budget/iu);
      expect(multerMock.single).not.toHaveBeenCalled();
      expect(signMock.inject).not.toHaveBeenCalled();
      expect(signMock.build).not.toHaveBeenCalled();
      expect(egressMock.request).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
