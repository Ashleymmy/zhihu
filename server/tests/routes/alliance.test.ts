import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createApp } from '../../src/app';
import type { Express } from 'express';
import { buildSignature } from '../../src/sign/zhihu';
import * as jwt from '../../src/auth/jwt';
import * as revocation from '../../src/auth/revocation';

const MOCK_SECRET = 'mock_secret_key';
const MOCK_TOKEN = 'mock_access_token';

describe('POST /api/alliance/api - multipart/form-data 透传', () => {
  let app: Express;
  const handlers = [
    http.post('https://open.zhihu.com/alliance/api/upload_image', async ({ request }) => {
      const formData = await request.formData();
      const accessToken = formData.get('access_token');
      const timestamp = formData.get('timestamp');
      const signature = formData.get('signature');
      const file = formData.get('image');
      const xRequestedWith = request.headers.get('X-Requested-With');

      // 验证必需字段
      if (!accessToken || !timestamp || !signature) {
        return HttpResponse.json({ success: false, msg: '缺少签名参数', data: null }, { status: 400 });
      }

      // 验证签名 - 构建参数对象时包含所有 formData 中的非文件字段
      const params: Record<string, unknown> = {};
      for (const [key, value] of formData.entries()) {
        if (key !== 'signature' && !(value instanceof File)) {
          params[key] = key === 'timestamp' ? Number(value) : value;
        }
      }

      const expectedSig = buildSignature(params, MOCK_SECRET);
      if (signature !== expectedSig) {
        return HttpResponse.json({ success: false, msg: '签名校验失败', data: null }, { status: 401 });
      }

      // 验证 X-Requested-With 头
      if (xRequestedWith !== 'openApi') {
        return HttpResponse.json({ success: false, msg: '缺少 X-Requested-With 头', data: null }, { status: 400 });
      }

      // 验证文件
      if (!file || !(file instanceof File)) {
        return HttpResponse.json({ success: false, msg: '缺少文件', data: null }, { status: 400 });
      }

      const buffer = await file.arrayBuffer();
      const content = Buffer.from(buffer).toString('utf8');

      return HttpResponse.json({
        success: true,
        msg: '上传成功',
        data: { filename: file.name, size: buffer.byteLength, content },
      });
    }),

    http.get('https://open.zhihu.com/alliance/api/get_batch_task_result', ({ request }) => {
      const url = new URL(request.url);
      const signature = url.searchParams.get('signature');
      const accessToken = url.searchParams.get('access_token');
      const timestamp = url.searchParams.get('timestamp');

      if (!accessToken || !timestamp || !signature) {
        return HttpResponse.json({ success: false, msg: '缺少签名参数', data: null }, { status: 400 });
      }

      const params = { access_token: accessToken, timestamp: Number(timestamp) };
      const expectedSig = buildSignature(params, MOCK_SECRET);
      if (signature !== expectedSig) {
        return HttpResponse.json({ success: false, msg: '签名校验失败', data: null }, { status: 401 });
      }

      // 返回二进制数据
      const binaryData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
      return new HttpResponse(binaryData, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }),
  ];

  const server = setupServer(...handlers);

  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => server.close());
  beforeEach(() => {
    server.resetHandlers();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    process.env.QUEUE_DRIVER = 'memory';
    process.env.ZHIHU_API_BASE = 'https://open.zhihu.com';
    process.env.ZHIHU_ACCESS_TOKEN = MOCK_TOKEN;
    process.env.ZHIHU_SECRET_KEY = MOCK_SECRET;
    app = createApp();

    // Mock JWT 验证，绕过认证
    vi.spyOn(jwt, 'verifyToken').mockReturnValue({
      sub: 'test-user-id',
      role: 'boss' as const,
      parentId: null,
      username: 'testuser',
      displayName: 'Test User',
      jti: 'test-jti',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    // Mock revocation store
    vi.spyOn(revocation.revocationStore, 'isRevoked').mockResolvedValue(false);
  });

  it('multipart/form-data 上传成功并验证签名 + X-Requested-With 头', async () => {
    const res = await request(app)
      .post('/api/alliance/api/upload_image')
      .set('Authorization', 'Bearer fake-token')
      .attach('image', Buffer.from('test image content'), 'test.png');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.filename).toBe('test.png');
    expect(res.body.data.content).toBe('test image content');
  });

  it('二进制下载路径返回 arraybuffer', async () => {
    const res = await request(app)
      .get('/api/alliance/api/get_batch_task_result')
      .set('Authorization', 'Bearer fake-token')
      .buffer()
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(data)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body[0]).toBe(0x89);
    expect(res.body[1]).toBe(0x50);
  });

  it('文件字节完整性校验', async () => {
    const originalBytes = Buffer.from([0x48, 0x65, 0x6C, 0x6C, 0x6F]);
    server.use(
      http.post('https://open.zhihu.com/alliance/api/upload_image', async ({ request }) => {
        const formData = await request.formData();
        const file = formData.get('image') as File;
        const buffer = await file.arrayBuffer();
        const receivedBytes = Buffer.from(buffer);
        return HttpResponse.json({ success: true, data: { bytes: Array.from(receivedBytes) } });
      }),
    );

    const res = await request(app)
      .post('/api/alliance/api/upload_image')
      .set('Authorization', 'Bearer fake-token')
      .attach('image', originalBytes, 'bytes.bin');

    expect(res.status).toBe(200);
    expect(res.body.data.bytes).toEqual(Array.from(originalBytes));
  });
});
