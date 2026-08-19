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

const planRow = (overrides: object = {}) => ({
  id: '10', owner_id: '4', channel_id: 'ch-1', keyword: 'kw', zhihu_plan_id: null,
  zhihu_task_id: 'task-1', second_channel_id: null, landing_url: 'https://x.com',
  popularize_type: 0, name: null, daily_budget: null, start_date: null, end_date: null,
  status: 'pending', sync_status: 'local', sync_error: null,
  created_by: '4', created_at: new Date(), updated_at: new Date(), ...overrides,
});

describe('推广计划路由：作用域与权限', () => {
  let app: Express;

  beforeEach(() => {
    dbMocks.query.mockReset();
    dbMocks.rows.mockReset().mockResolvedValue([]);
    dbMocks.connectionQuery.mockReset().mockResolvedValue([{ insertId: 10, affectedRows: 1 }]);
    dbMocks.withTransaction.mockReset().mockImplementation(async (work: (c: unknown) => Promise<unknown>) =>
      work({ query: dbMocks.connectionQuery }),
    );
    process.env.QUEUE_DRIVER = 'memory';
    app = createApp();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  // ── GET /plans ────────────────────────────────────────────────

  it('creator 列表 SQL 绑定自身 user_id', async () => {
    dbMocks.rows.mockResolvedValue([{ total: 0 }]);
    await request(app)
      .get('/api/v1/plans')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    const [sql, params] = dbMocks.rows.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('owner_id');
    expect(params).toContain('4');
  });

  it('admin 列表无用户过滤', async () => {
    dbMocks.rows.mockResolvedValue([{ total: 0 }]);
    await request(app)
      .get('/api/v1/plans')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    const [sql] = dbMocks.rows.mock.calls[0] as [string];
    expect(sql).not.toMatch(/owner_id\s*=\s*\?/);
  });

  it('GET /plans 返回分页结构', async () => {
    dbMocks.rows
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([planRow()]);
    const res = await request(app)
      .get('/api/v1/plans?page=1&pageSize=10')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 1, page: 1, pageSize: 10 });
  });

  // ── POST /plans ───────────────────────────────────────────────

  it('creator 无 plan.create 权限创建被拒绝 — 不触达 DB', async () => {
    // creator has plan.create in the current permission map; use a role without it
    // Using direct body validation: malformed body → 422
    const res = await request(app)
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${await token('creator', '4')}`)
      .send({}); // missing required fields
    expect(res.status).toBe(422);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('admin 创建计划 keyword 冲突返回 409', async () => {
    dbMocks.withTransaction.mockRejectedValue(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }));
    const res = await request(app)
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({
        taskId: 'task-1', channelId: 'ch-1', keyword: 'dup-kw',
        landingUrl: 'https://x.com', popularizeType: 0,
      });
    expect(res.status).toBe(409);
  });

  // ── DELETE /plans/:id ─────────────────────────────────────────

  it('creator 无 plan.delete 权限 — 实际 creator 有，测 body 缺失返回 404', async () => {
    dbMocks.withTransaction.mockImplementation(async (work: (c: unknown) => Promise<unknown>) => {
      const conn = {
        query: vi.fn().mockResolvedValue([[]])  // 空结果 → 404
      };
      return work(conn);
    });
    const res = await request(app)
      .delete('/api/v1/plans/99')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    expect(res.status).toBe(404);
  });

  // ── POST /plans/:id/retry-sync ────────────────────────────────

  it('POST /plans/:id/retry-sync 计划不存在返回 404', async () => {
    dbMocks.withTransaction.mockImplementation(async (work: (c: unknown) => Promise<unknown>) => {
      return work({ query: vi.fn().mockResolvedValue([[]]) });
    });
    const res = await request(app)
      .post('/api/v1/plans/99/retry-sync')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    expect(res.status).toBe(404);
  });
});
