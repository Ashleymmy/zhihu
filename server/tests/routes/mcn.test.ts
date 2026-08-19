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

describe('MCN 账户路由：权限与业务', () => {
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

  it('creator 列表 MCN 被拒绝（403）', async () => {
    const res = await request(app)
      .get('/api/v1/mcn-accounts')
      .set('Authorization', `Bearer ${await token('creator', '3')}`);
    expect(res.status).toBe(403);
    expect(dbMocks.rows).not.toHaveBeenCalled();
  });

  it('admin 列表返回全量', async () => {
    dbMocks.rows.mockResolvedValue([
      { id: '1', account_key: 'mcn-a', account_name: 'MCN A', owner_user_id: '1', status: 'active', created_at: new Date(), updated_at: new Date() },
    ]);
    const res = await request(app)
      .get('/api/v1/mcn-accounts')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].accountKey).toBe('mcn-a');
  });

  it('leader 创建 MCN 被拒绝（403）', async () => {
    const res = await request(app)
      .post('/api/v1/mcn-accounts')
      .set('Authorization', `Bearer ${await token('leader', '2')}`)
      .send({ accountKey: 'k', accountName: 'N' });
    expect(res.status).toBe(403);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('admin 创建 MCN，key 冲突返回 409', async () => {
    dbMocks.rows.mockResolvedValue([{ id: '1', is_active: 1 }]); // ownerUser 存在
    dbMocks.connectionQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('SELECT id FROM mcn_accounts')) return [[{ id: '1' }]];
      return [{ insertId: 1, affectedRows: 1 }];
    });
    const res = await request(app)
      .post('/api/v1/mcn-accounts')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ accountKey: 'existing', accountName: 'X' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(40902);
  });

  it('admin 创建 MCN 成功，返回 201 并写审计', async () => {
    dbMocks.rows
      .mockResolvedValueOnce([{ id: '1', is_active: 1 }])
      .mockResolvedValueOnce([
        { id: '2', account_key: 'new-mcn', account_name: 'New MCN', owner_user_id: '1', status: 'active', created_at: new Date(), updated_at: new Date() },
      ]);
    dbMocks.connectionQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('SELECT id FROM mcn_accounts')) return [[]];
      return [{ insertId: 2, affectedRows: 1 }];
    });
    const res = await request(app)
      .post('/api/v1/mcn-accounts')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ accountKey: 'new-mcn', accountName: 'New MCN' });
    expect(res.status).toBe(201);
    expect(res.body.data.accountKey).toBe('new-mcn');
    const audit = dbMocks.connectionQuery.mock.calls.find(([s]) => String(s).includes('INSERT INTO audit_logs'));
    expect(audit).toBeDefined();
  });

  it('accountKey body 校验：含空格返回 422', async () => {
    const res = await request(app)
      .post('/api/v1/mcn-accounts')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ accountKey: 'bad key', accountName: 'X' });
    expect(res.status).toBe(422);
  });
});
