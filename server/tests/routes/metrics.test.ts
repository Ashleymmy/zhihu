import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
  rows: vi.fn(),
  withTransaction: vi.fn(),
  connectionQuery: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: { query: dbMocks.query },
  rows: dbMocks.rows,
  withTransaction: dbMocks.withTransaction,
}));

import { createApp } from '../../src/app';
import { signToken } from '../../src/auth/jwt';
import type { Role } from '../../src/types';

const token = (role: Role, id: string) =>
  signToken({ id, role, parentId: null, username: `${role}-user`, displayName: role });

describe('指标路由：作用域与权限', () => {
  let app: Express;

  beforeEach(() => {
    dbMocks.query.mockReset();
    dbMocks.rows.mockReset().mockResolvedValue([]);
    dbMocks.connectionQuery.mockReset().mockResolvedValue([{ insertId: 1, affectedRows: 1 }]);
    dbMocks.withTransaction.mockReset().mockImplementation(async (work: (c: unknown) => Promise<unknown>) =>
      work({ query: dbMocks.connectionQuery }),
    );
    process.env.QUEUE_DRIVER = 'memory';
    app = createApp();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('GET /metrics/overview creator 返回 200', async () => {
    dbMocks.rows.mockResolvedValue([{ today_impressions: 0, today_clicks: 0, today_conversions: 0, today_earning: 0, total_impressions: 0, total_clicks: 0, total_conversions: 0, total_earning: 0 }]);
    const res = await request(app)
      .get('/api/v1/metrics/overview')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    expect(res.status).toBe(200);
  });

  it('GET /metrics/overview SQL 按 creator 作用域过滤', async () => {
    dbMocks.rows.mockResolvedValue([{}]);
    await request(app)
      .get('/api/v1/metrics/overview')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    const [sql, params] = dbMocks.rows.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('owner_id');
    expect(params).toContain('4');
  });

  it('GET /metrics/overview admin 无用户过滤', async () => {
    dbMocks.rows.mockResolvedValue([{}]);
    await request(app)
      .get('/api/v1/metrics/overview')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    const [sql] = dbMocks.rows.mock.calls[0] as [string];
    expect(sql).not.toMatch(/owner_id\s*=\s*\?/);
  });

  it('GET /metrics/trend 返回 200', async () => {
    dbMocks.rows.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/v1/metrics/trend')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    expect(res.status).toBe(200);
  });

  it('GET /metrics/by-member creator 无 earning.view_team 权限，返回 403', async () => {
    const res = await request(app)
      .get('/api/v1/metrics/by-member')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    expect(res.status).toBe(403);
  });

  it('GET /metrics/by-member leader 有权限，返回 200', async () => {
    dbMocks.rows.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/v1/metrics/by-member')
      .set('Authorization', `Bearer ${await token('leader', '2')}`);
    expect(res.status).toBe(200);
  });

  it('POST /metrics/sync creator 被拒绝（403）', async () => {
    const res = await request(app)
      .post('/api/v1/metrics/sync')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    expect(res.status).toBe(403);
  });
});
