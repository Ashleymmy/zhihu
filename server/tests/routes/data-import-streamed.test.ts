import { describe, expect, it, vi } from 'vitest';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { buildOfficialOrderXlsxFixture } from '../support/allianceXlsxFixture';

// Exercise the real multipart/validation/parsing pipeline with isolated identity
// and in-memory previews. No real sessions, DB writes or income confirmation.
vi.mock('../../src/auth/middleware', () => ({
  requireAuth: ((req, _res, next) => {
    req.user = {
      sub: 'xlsx-test-admin',
      role: 'admin',
      parentId: null,
      adminDuty: 'all',
      username: 'xlsx-test-admin',
      displayName: 'XLSX test',
      jti: 'isolated-xlsx-test',
    };
    next();
  }) satisfies RequestHandler,
}));
vi.mock('../../src/modules/zhihu/dev-demo', () => ({ isDevDemoAuthUser: () => true }));
vi.mock('../../src/db', () => ({
  db: {
    query: () => {
      throw new Error('unexpected DB query');
    },
  },
  rows: () => {
    throw new Error('unexpected DB read');
  },
  withTransaction: () => {
    throw new Error('unexpected DB transaction');
  },
}));

import { dataImportRouter } from '../../src/modules/zhihu/routes/data-import';
import { errorHandler } from '../../src/middleware/errors';
import { XLSX_MIME } from '../../src/modules/zhihu/zhihu/allianceXlsx';

function app() {
  const server = express();
  server.use('/data-import', dataImportRouter);
  server.use(errorHandler);
  return server;
}

describe('official streamed XLSX multipart upload', () => {
  it.each(['email_attachment', 'manual_excel'])('previews %s with a Chinese filename', async (sourceType) => {
    const buffer = buildOfficialOrderXlsxFixture(sourceType === 'email_attachment' ? '2026-09-27' : '2026-09-28');
    const response = await request(app())
      .post('/data-import/parse')
      .field('sourceType', sourceType)
      .attach('file', buffer, { filename: '知乎_OrderData_测试.xlsx', contentType: XLSX_MIME });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      fileName: '知乎_OrderData_测试.xlsx',
      sourceType,
      status: 'preview',
      reportType: 'order',
      totalRows: 1,
      validRows: 1,
      errorRows: 0,
      confirmedAt: null,
    });
  });

  it('still rejects a corrupted streamed workbook', async () => {
    const buffer = buildOfficialOrderXlsxFixture();
    const descriptor = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]));
    expect(descriptor).toBeGreaterThan(0);
    buffer[descriptor + 4] ^= 1;
    const response = await request(app())
      .post('/data-import/parse')
      .field('sourceType', 'email_attachment')
      .attach('file', buffer, { filename: '知乎_OrderData_测试.xlsx', contentType: XLSX_MIME });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe(42216);
  });
});
