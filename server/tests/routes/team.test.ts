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

const memberRow = (overrides: object = {}) => ({
  id: '5',
  username: 'new-user',
  role: 'creator',
  parent_id: '1',
  display_name: '新成员',
  phone: null,
  is_active: 1,
  must_change_pwd: 1,
  last_login_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('团队成员路由：权限边界与业务逻辑', () => {
  let app: Express;

  beforeEach(() => {
    dbMocks.query.mockReset();
    dbMocks.rows.mockReset().mockResolvedValue([]);
    dbMocks.connectionQuery.mockReset().mockResolvedValue([{ insertId: 5, affectedRows: 1 }]);
    dbMocks.withTransaction.mockReset().mockImplementation(async (work: (c: unknown) => Promise<unknown>) =>
      work({ query: dbMocks.connectionQuery }),
    );
    process.env.QUEUE_DRIVER = 'memory';
    app = createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── GET /team/members ─────────────────────────────────────────

  it('creator 无 team.view 权限，返回 403', async () => {
    const res = await request(app)
      .get('/api/v1/team/members')
      .set('Authorization', `Bearer ${await token('creator', '3')}`);
    expect(res.status).toBe(403);
    expect(dbMocks.rows).not.toHaveBeenCalled();
  });

  it('admin 列表返回全量（无 WHERE 过滤）', async () => {
    dbMocks.rows.mockResolvedValue([memberRow()]);
    const res = await request(app)
      .get('/api/v1/team/members')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const [sql] = dbMocks.rows.mock.calls[0] as [string];
    expect(sql).not.toContain('WHERE');
  });

  it('leader 列表 SQL 绑定自身 id', async () => {
    dbMocks.rows.mockResolvedValue([memberRow({ id: '2', role: 'leader' }), memberRow()]);
    const res = await request(app)
      .get('/api/v1/team/members')
      .set('Authorization', `Bearer ${await token('leader', '2')}`);
    expect(res.status).toBe(200);
    const [, params] = dbMocks.rows.mock.calls[0] as [string, string[]];
    expect(params).toEqual(['2', '2']);
  });

  // ── POST /team/members ────────────────────────────────────────

  it('creator 创建成员被拒绝（403）', async () => {
    const res = await request(app)
      .post('/api/v1/team/members')
      .set('Authorization', `Bearer ${await token('creator', '3')}`)
      .send({ username: 'x', displayName: 'X' });
    expect(res.status).toBe(403);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('admin 创建 creator 成功，返回 201 + 临时密码', async () => {
    dbMocks.rows.mockResolvedValue([{ id: '1', role: 'admin', parent_id: null, is_active: 1 }]);
    const res = await request(app)
      .post('/api/v1/team/members')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ username: 'new-creator', displayName: '新达人', role: 'creator' });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('temporaryPassword');
    const audit = dbMocks.connectionQuery.mock.calls.find(([s]) => String(s).includes('INSERT INTO audit_logs'));
    expect(audit).toBeDefined();
  });

  it('创建成员 body 校验：缺 username 返回 422', async () => {
    const res = await request(app)
      .post('/api/v1/team/members')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ displayName: '仅名称' });
    expect(res.status).toBe(422);
  });

  // ── PATCH /team/members/:id ───────────────────────────────────

  it('leader 更新不在自己团队下的成员返回 403', async () => {
    dbMocks.rows.mockResolvedValue([memberRow({ parent_id: '99' })]);
    const res = await request(app)
      .patch('/api/v1/team/members/5')
      .set('Authorization', `Bearer ${await token('leader', '2')}`)
      .send({ displayName: '改名' });
    expect(res.status).toBe(403);
  });

  it('admin 更新成员成功（返回 data:null）', async () => {
    dbMocks.rows.mockResolvedValue([memberRow({ parent_id: '1' })]);
    const res = await request(app)
      .patch('/api/v1/team/members/5')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ displayName: '改名后' });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    const update = dbMocks.connectionQuery.mock.calls.find(([s]) => String(s).includes('UPDATE users'));
    expect(update).toBeDefined();
  });

  // ── POST /team/members/:id/reset-password ─────────────────────

  it('creator 重置密码被拒绝（403）', async () => {
    const res = await request(app)
      .post('/api/v1/team/members/5/reset-password')
      .set('Authorization', `Bearer ${await token('creator', '3')}`);
    expect(res.status).toBe(403);
  });

  it('admin 重置密码返回临时密码', async () => {
    dbMocks.rows.mockResolvedValue([memberRow()]);
    const res = await request(app)
      .post('/api/v1/team/members/5/reset-password')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('temporaryPassword');
  });

  // ── POST /team/members/:id/disable ───────────────────────────

  it('creator 禁用成员被拒绝（403）', async () => {
    const res = await request(app)
      .post('/api/v1/team/members/5/disable')
      .set('Authorization', `Bearer ${await token('creator', '3')}`);
    expect(res.status).toBe(403);
  });

  it('admin 禁用成员成功', async () => {
    dbMocks.rows.mockResolvedValue([memberRow()]);
    const res = await request(app)
      .post('/api/v1/team/members/5/disable')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});
