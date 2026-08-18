import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/errors';
import { resolveClientEndpoint } from '../../src/zhihu/allianceEndpointRegistry';
import {
  ALLIANCE_EGRESS_BASE,
  ALLIANCE_UPSTREAM_UNAVAILABLE_MESSAGE,
  requestAlliance,
} from '../../src/zhihu/allianceEgress';

const officialRequests: string[] = [];
const multipartSnapshots: Array<{ contentType: string | null; requestedWith: string | null; keys: string[] }> = [];
let secondHostHits = 0;

const upstream = setupServer(
  http.post(`${ALLIANCE_EGRESS_BASE}/popularize_plan`, ({ request }) => {
    officialRequests.push(`${request.method} ${new URL(request.url).pathname}`);
    if (request.headers.has('authorization') || request.headers.has('cookie') || request.headers.has('forwarded')) {
      return HttpResponse.json({ leaked: true }, { status: 400 });
    }
    return HttpResponse.json({ success: true, data: { plan_id: '1' } });
  }),
  http.post(`${ALLIANCE_EGRESS_BASE}/popularize_plans`, async ({ request }) => {
    officialRequests.push(`${request.method} ${new URL(request.url).pathname}`);
    const form = await request.formData();
    multipartSnapshots.push({
      contentType: request.headers.get('content-type'),
      requestedWith: request.headers.get('x-requested-with'),
      keys: [...form.keys()],
    });
    return HttpResponse.json({ success: true, data: { batch_task_id: '2071267000000000001' } });
  }),
  http.get('https://redirect-target.invalid/next', () => {
    secondHostHits += 1;
    return HttpResponse.json({ leaked: true });
  }),
);

beforeAll(() => upstream.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  upstream.resetHandlers();
  officialRequests.length = 0;
  multipartSnapshots.length = 0;
  secondHostHits = 0;
});
afterAll(() => upstream.close());

function planEndpoint() {
  const endpoint = resolveClientEndpoint('POST', '/alliance/api/popularize_plan');
  if (!endpoint) throw new Error('expected registry endpoint');
  return endpoint;
}

function planBatchEndpoint() {
  const endpoint = resolveClientEndpoint('POST', '/alliance/api/popularize_plans');
  if (!endpoint) throw new Error('expected batch registry endpoint');
  return endpoint;
}

describe('Alliance fixed Egress', () => {
  it('P0007-R1-EGRESS-001 sends only a registered relative endpoint to the fixed origin', async () => {
    const response = await requestAlliance({
      endpoint: planEndpoint(),
      data: { callback_url: 'https://attacker.example/value' },
    });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ success: true, data: { plan_id: '1' } });
    expect(officialRequests).toEqual(['POST /alliance/api/popularize_plan']);
    expect(secondHostHits).toBe(0);
  });

  it('P0007-R1-EGRESS-002 rejects forged endpoints before a network request', async () => {
    const forged = {
      ...planEndpoint(),
      upstreamPath: 'https://attacker.example/alliance/api/popularize_plan',
    };

    await expect(requestAlliance({ endpoint: forged })).rejects.toMatchObject({
      httpStatus: 502,
      code: 50002,
      message: ALLIANCE_UPSTREAM_UNAVAILABLE_MESSAGE,
    });
    expect(officialRequests).toEqual([]);
    expect(secondHostHits).toBe(0);
  });

  it('P0007-R1-EGRESS-002 ignores hostile proxy environment variables', async () => {
    const previousHttpProxy = process.env.HTTP_PROXY;
    const previousHttpsProxy = process.env.HTTPS_PROXY;
    process.env.HTTP_PROXY = 'http://127.0.0.1:9';
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9';
    try {
      await expect(requestAlliance({ endpoint: planEndpoint(), data: {} })).resolves.toMatchObject({ status: 200 });
    } finally {
      if (previousHttpProxy === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = previousHttpProxy;
      if (previousHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = previousHttpsProxy;
    }
    expect(officialRequests).toEqual(['POST /alliance/api/popularize_plan']);
    expect(secondHostHits).toBe(0);
  });

  it('P0007-R3-FORM-001 accepts only native multipart FormData and lets Axios create the boundary', async () => {
    const form = new FormData();
    form.append('task_id', 'task-1');
    form.append('file', new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]), 'upload.xlsx');

    await expect(requestAlliance({ endpoint: planBatchEndpoint(), data: form })).resolves.toMatchObject({
      status: 200,
    });
    expect(officialRequests).toEqual(['POST /alliance/api/popularize_plans']);
    expect(multipartSnapshots).toEqual([
      {
        contentType: expect.stringMatching(/^multipart\/form-data;\s*boundary=/iu),
        requestedWith: 'openApi',
        keys: ['task_id', 'file'],
      },
    ]);
  });

  it('P0007-R3-FORM-001 rejects params, plain bodies, forged forms, and FormData on JSON operations', async () => {
    const native = new FormData();
    const forged = Object.create(FormData.prototype) as FormData;
    const invalidRequests = [
      requestAlliance({ endpoint: planBatchEndpoint(), data: {} }),
      requestAlliance({ endpoint: planBatchEndpoint(), data: 'multipart' }),
      requestAlliance({ endpoint: planBatchEndpoint(), data: Buffer.from('multipart') }),
      requestAlliance({ endpoint: planBatchEndpoint(), data: forged }),
      requestAlliance({ endpoint: planBatchEndpoint(), params: {}, data: native }),
      requestAlliance({ endpoint: planEndpoint(), data: native }),
    ];
    for (const result of invalidRequests) {
      await expect(result).rejects.toMatchObject({
        httpStatus: 502,
        code: 50002,
        message: ALLIANCE_UPSTREAM_UNAVAILABLE_MESSAGE,
      });
    }
    expect(officialRequests).toEqual([]);
    expect(multipartSnapshots).toEqual([]);
  });

  it('P0007-R1-REDIRECT-001 maps every redirect status to the safe failure', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      upstream.use(
        http.post(
          `${ALLIANCE_EGRESS_BASE}/popularize_plan`,
          () =>
            new HttpResponse(null, {
              status,
              headers: { Location: 'https://redirect-target.invalid/next?token=secret' },
            }),
        ),
      );

      await expect(requestAlliance({ endpoint: planEndpoint(), data: {} })).rejects.toSatisfy((error: unknown) => {
        return (
          error instanceof AppError &&
          error.httpStatus === 502 &&
          error.code === 50002 &&
          error.message === ALLIANCE_UPSTREAM_UNAVAILABLE_MESSAGE
        );
      });
      expect(secondHostHits, String(status)).toBe(0);
      upstream.resetHandlers();
    }
  });
});
