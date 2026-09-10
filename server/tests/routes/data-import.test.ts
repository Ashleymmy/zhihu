import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
  rows: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: { query: dbMocks.query },
  rows: dbMocks.rows,
  withTransaction: dbMocks.withTransaction,
}));

import { createApp } from '../support/legacyApp';
import { signToken } from '../../src/auth/jwt';
import type { Role } from '../../src/types';

const token = (role: Role, id: string) =>
  signToken({ id, role, parentId: null, username: `${role}-user`, displayName: role });

describe('邮件附件 / Excel 导入路由', () => {
  let app: Express;

  beforeEach(() => {
    dbMocks.query.mockReset();
    dbMocks.rows.mockReset().mockResolvedValue([]);
    dbMocks.withTransaction.mockReset();
    process.env.QUEUE_DRIVER = 'memory';
    app = createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('非管理员不能查看导入批次', async () => {
    const res = await request(app)
      .get('/api/v1/data-import/batches')
      .set('Authorization', `Bearer ${await token('leader', '2')}`);

    expect(res.status).toBe(403);
    expect(dbMocks.rows).not.toHaveBeenCalled();
  });

  it('管理员可以查看导入批次', async () => {
    const res = await request(app)
      .get('/api/v1/data-import/batches')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('管理员可以查看已保存批次的原始行数据', async () => {
    dbMocks.rows
      .mockResolvedValueOnce([
        {
          id: '11',
          source_type: 'email_attachment',
          file_name: '日报.xlsx',
          file_size: 128,
          file_sha256: 'a'.repeat(64),
          sheet_name: 'Sheet1',
          report_type: 'order',
          status: 'confirmed',
          total_rows: 1,
          valid_rows: 1,
          error_rows: 0,
          errors_json: '[]',
          headers_json: '["日期时间","关键词","搜索量"]',
          created_by: '1',
          confirmed_at: '2026-09-04 10:00:00',
          rejected_at: null,
          rejection_reason: null,
          created_at: '2026-09-04 09:00:00',
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([
        {
          row_number: 2,
          occurred_at: '2026-09-03 00:00:00',
          channel_name: '渠道 A',
          keyword: '关键词 A',
          promotion_task: null,
          risk_decision: null,
          search_volume: 10,
          order_count: 1,
          search_conversion_rate: '0.100000',
          revenue_amount: '12.00',
          validation_status: 'valid',
          errors_json: '[]',
          raw_json: '{"关键词":"关键词 A","搜索量":10}',
        },
      ]);

    const res = await request(app)
      .get('/api/v1/data-import/11?page=1&pageSize=100')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: '11',
      total: 1,
      rows: [
        expect.objectContaining({
          rowNumber: 2,
          keyword: '关键词 A',
          raw: { 关键词: '关键词 A', 搜索量: 10 },
        }),
      ],
    });
  });

  it('上传接口拒绝缺少文件和非 XLSX 文件', async () => {
    const authorization = `Bearer ${await token('admin', '1')}`;
    const missing = await request(app)
      .post('/api/v1/data-import/parse')
      .set('Authorization', authorization)
      .field('sourceType', 'email_attachment');
    const invalid = await request(app)
      .post('/api/v1/data-import/parse')
      .set('Authorization', authorization)
      .field('sourceType', 'email_attachment')
      .attach('file', Buffer.from('not-an-xlsx'), 'report.csv');

    expect(missing.status).toBe(422);
    expect(invalid.status).toBe(422);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });
});
