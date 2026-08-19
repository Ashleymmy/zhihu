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

const compRow = (overrides: object = {}) => ({
  id: '20', plan_id: '10', owner_id: '4',
  zhihu_composition_id: null, media_type: 1, media_account: 'acc-a',
  composition_type: 0, composition_sub_type: 1,
  title: null, promo_url: 'https://x.com', release_time: null,
  status: 'pending', reject_reason: null,
  sync_status: 'local', sync_error: null,
  created_at: new Date(), updated_at: new Date(),
  ...overrides,
});

describe('作品路由：作用域与权限', () => {
  let app: Express;

  beforeEach(() => {
    dbMocks.query.mockReset();
    dbMocks.rows.mockReset().mockResolvedValue([]);
    dbMocks.connectionQuery.mockReset().mockResolvedValue([{ insertId: 20, affectedRows: 1 }]);
    dbMocks.withTransaction.mockReset().mockImplementation(async (work: (c: unknown) => Promise<unknown>) =>
      work({ query: dbMocks.connectionQuery }),
    );
    process.env.QUEUE_DRIVER = 'memory';
    app = createApp();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('GET /compositions creator 作用域绑定自身 owner_id', async () => {
    dbMocks.rows.mockResolvedValue([{ total: 0 }]);
    await request(app)
      .get('/api/v1/compositions')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    const [sql, params] = dbMocks.rows.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('owner_id');
    expect(params).toContain('4');
  });

  it('GET /compositions admin 无用户过滤', async () => {
    dbMocks.rows.mockResolvedValue([{ total: 0 }]);
    await request(app)
      .get('/api/v1/compositions')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    const [sql] = dbMocks.rows.mock.calls[0] as [string];
    expect(sql).not.toMatch(/owner_id\s*=\s*\?/);
  });

  it('POST /compositions body 缺 planId 返回 422', async () => {
    const res = await request(app)
      .post('/api/v1/compositions')
      .set('Authorization', `Bearer ${await token('creator', '4')}`)
      .send({});
    expect(res.status).toBe(422);
  });

  it('POST /compositions body mediaType 非法返回 422', async () => {
    const res = await request(app)
      .post('/api/v1/compositions')
      .set('Authorization', `Bearer ${await token('creator', '4')}`)
      .send({
        planId: '10', mediaType: 'invalid', mediaAccount: 'acc',
        compositionType: 0, compositionSubType: 1,
        promoUrl: 'https://x.com',
        releaseTime: '2026-08-19T10:00:00+08:00',
      });
    expect(res.status).toBe(422);
  });

  it('PATCH /compositions/:id 空 body 通过 schema 校验（422 为正常行为 - releaseTime 格式严格）', async () => {
    // patch schema 有 releaseTime refine，空 body 合法（所有字段可选），应通过
    // 但 updateComposition service 会因 mock 返回空而抛 404
    dbMocks.withTransaction.mockImplementation(async (work: (c: unknown) => Promise<unknown>) =>
      work({ query: vi.fn().mockResolvedValue([[]]) }),
    );
    const res = await request(app)
      .patch('/api/v1/compositions/20')
      .set('Authorization', `Bearer ${await token('creator', '4')}`)
      .send({});
    // empty patch → service throws 404 or returns normally
    expect([200, 404]).toContain(res.status);
  });

  it('GET /compositions/:id/audit-status 不存在返回 404', async () => {
    const scope = { clause: 'owner_id = ?', bindings: ['4'] };
    dbMocks.rows.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/v1/compositions/999/audit-status')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    expect(res.status).toBe(404);
  });
});
