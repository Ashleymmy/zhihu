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

const projectRow = (overrides: object = {}) => ({
  id: '1',
  name: '知乎',
  slug: 'zhihu',
  api_base_url: 'https://open.zhihu.com',
  sign_method: 'hmac_sha256',
  is_enabled: 1,
  config_json: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('projects CRUD：权限与业务逻辑', () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── POST /projects ──────────────────────────────────────────────

  it('creator 创建项目被拒绝（403）', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${await token('creator', '3')}`)
      .send({ name: 'X', slug: 'x', apiBaseUrl: 'https://x.com' });
    expect(res.status).toBe(403);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('leader 创建项目被拒绝（403）', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${await token('leader', '2')}`)
      .send({ name: 'X', slug: 'x', apiBaseUrl: 'https://x.com' });
    expect(res.status).toBe(403);
  });

  it('admin 创建项目，slug 冲突返回 409', async () => {
    dbMocks.rows.mockResolvedValue([{ id: '1' }]); // slug 已存在
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ name: '知乎2', slug: 'zhihu', apiBaseUrl: 'https://open.zhihu.com' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(40901);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('admin 创建项目成功，返回 201 并写审计', async () => {
    dbMocks.rows
      .mockResolvedValueOnce([])                     // slug 未占用
      .mockResolvedValueOnce([projectRow()]);         // SELECT 回写
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ name: '知乎', slug: 'zhihu', apiBaseUrl: 'https://open.zhihu.com' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: '1', slug: 'zhihu', isEnabled: true });
    const audit = dbMocks.connectionQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO audit_logs'),
    );
    expect(audit).toBeDefined();
  });

  it('创建项目 body 校验：缺少 name 返回 422', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ slug: 'x', apiBaseUrl: 'https://x.com' });
    expect(res.status).toBe(422);
  });

  it('创建项目 body 校验：slug 含大写字母返回 422', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ name: 'X', slug: 'MyProject', apiBaseUrl: 'https://x.com' });
    expect(res.status).toBe(422);
  });

  // ── PATCH /projects/:id ─────────────────────────────────────────

  it('creator 更新项目被拒绝（403）', async () => {
    const res = await request(app)
      .patch('/api/v1/projects/1')
      .set('Authorization', `Bearer ${await token('creator', '3')}`)
      .send({ name: 'New' });
    expect(res.status).toBe(403);
  });

  it('admin 更新不存在的项目返回 404', async () => {
    dbMocks.rows.mockResolvedValue([]); // 项目不存在
    const res = await request(app)
      .patch('/api/v1/projects/99')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ name: 'New' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(40402);
  });

  it('admin 更新项目名称成功，写审计', async () => {
    dbMocks.rows
      .mockResolvedValueOnce([projectRow()])                           // 先查
      .mockResolvedValueOnce([projectRow({ name: '知乎V2' })]);        // 更新后查
    const res = await request(app)
      .patch('/api/v1/projects/1')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ name: '知乎V2' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('知乎V2');
    const audit = dbMocks.connectionQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO audit_logs'),
    );
    expect(audit).toBeDefined();
  });

  it('admin 发送空 body 不执行 UPDATE，直接返回现有数据', async () => {
    dbMocks.rows.mockResolvedValueOnce([projectRow()]);
    const res = await request(app)
      .patch('/api/v1/projects/1')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({});
    expect(res.status).toBe(200);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  // ── DELETE /projects/:id ────────────────────────────────────────

  it('creator 禁用项目被拒绝（403）', async () => {
    const res = await request(app)
      .delete('/api/v1/projects/1')
      .set('Authorization', `Bearer ${await token('creator', '3')}`);
    expect(res.status).toBe(403);
  });

  it('admin 禁用不存在的项目返回 404', async () => {
    dbMocks.rows.mockResolvedValue([]);
    const res = await request(app)
      .delete('/api/v1/projects/99')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(40402);
  });

  it('admin 禁用已禁用项目返回 409', async () => {
    dbMocks.rows.mockResolvedValueOnce([projectRow({ is_enabled: 0 })]);
    const res = await request(app)
      .delete('/api/v1/projects/1')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(40902);
  });

  it('admin 禁用项目成功，返回 data:null 并写审计', async () => {
    dbMocks.rows.mockResolvedValueOnce([projectRow()]);
    const res = await request(app)
      .delete('/api/v1/projects/1')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    const audit = dbMocks.connectionQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO audit_logs'),
    );
    expect(audit).toBeDefined();
  });
});
