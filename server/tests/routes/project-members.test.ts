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

describe('MCN 账户与项目成员：跨角色权限边界', () => {
  let app: Express;

  beforeEach(() => {
    dbMocks.query.mockReset();
    dbMocks.rows.mockReset().mockResolvedValue([]);
    dbMocks.connectionQuery.mockReset().mockResolvedValue([{ insertId: 1, affectedRows: 1 }]);
    dbMocks.withTransaction.mockReset().mockImplementation(async (work: (c: unknown) => Promise<unknown>) => {
      return work({ query: dbMocks.connectionQuery });
    });
    process.env.QUEUE_DRIVER = 'memory';
    app = createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creator 创建 MCN 账户被拒绝（403），且不触达数据库', async () => {
    const res = await request(app)
      .post('/api/v1/mcn-accounts')
      .set('Authorization', `Bearer ${await token('creator', '3')}`)
      .send({ accountKey: 'mcn-a', accountName: 'MCN A' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40301);
    expect(dbMocks.rows).not.toHaveBeenCalled();
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('leader 添加项目成员被拒绝（403）', async () => {
    const res = await request(app)
      .post('/api/v1/projects/1/members')
      .set('Authorization', `Bearer ${await token('leader', '2')}`)
      .send({ userId: '3' });
    expect(res.status).toBe(403);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('creator 未在项目成员表中时列表 fail closed（40304）', async () => {
    dbMocks.rows.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM projects')) return [{ id: '1' }];
      if (sql.includes('FROM project_members')) return [];
      return [];
    });
    const res = await request(app)
      .get('/api/v1/projects/1/members')
      .set('Authorization', `Bearer ${await token('creator', '3')}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40304);
  });

  it('creator 是项目成员时可查看成员列表', async () => {
    dbMocks.rows.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM projects')) return [{ id: '1' }];
      if (sql.includes('JOIN users')) {
        return [
          {
            id: '5',
            project_id: '1',
            user_id: '3',
            member_role: 'member',
            joined_at: new Date('2026-08-18T00:00:00Z'),
            left_at: null,
            username: 'creator-user',
            display_name: '达人',
          },
        ];
      }
      if (sql.includes('FROM project_members')) return [{ id: '5' }];
      return [];
    });
    const res = await request(app)
      .get('/api/v1/projects/1/members')
      .set('Authorization', `Bearer ${await token('creator', '3')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].userId).toBe('3');
  });

  it('admin 添加项目成员成功并写审计', async () => {
    dbMocks.rows.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM projects')) return [{ id: '1' }];
      if (sql.includes('FROM users WHERE id')) return [{ id: '3', is_active: 1 }];
      if (sql.includes('JOIN users')) {
        return [
          {
            id: '5',
            project_id: '1',
            user_id: '3',
            member_role: 'member',
            joined_at: new Date('2026-08-18T00:00:00Z'),
            left_at: null,
            username: 'creator-user',
            display_name: '达人',
          },
        ];
      }
      return [];
    });
    dbMocks.connectionQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM project_members')) return [[]];
      return [{ insertId: 5, affectedRows: 1 }];
    });
    const res = await request(app)
      .post('/api/v1/projects/1/members')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ userId: '3' });
    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe('3');
    const audit = dbMocks.connectionQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_logs'));
    expect(audit).toBeDefined();
  });

  it('admin 移除不存在的成员返回 404', async () => {
    dbMocks.rows.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM projects')) return [{ id: '1' }];
      return [];
    });
    dbMocks.connectionQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SET left_at')) return [{ affectedRows: 0 }];
      return [{ affectedRows: 1 }];
    });
    const res = await request(app)
      .delete('/api/v1/projects/1/members/9')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(40403);
  });

  it('admin 项目列表返回全量，不带成员角色', async () => {
    dbMocks.rows.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM projects p')) {
        expect(sql).not.toContain('JOIN project_members');
        return [
          { id: '1', name: '知乎', slug: 'zhihu', is_enabled: 1, created_at: new Date(), member_role: null },
        ];
      }
      return [];
    });
    const res = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: '1', slug: 'zhihu', isEnabled: true, memberRole: null });
  });

  it('creator 项目列表只查成员表关联的行，SQL 绑定 user_id', async () => {
    dbMocks.rows.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM projects p')) {
        expect(sql).toContain('JOIN project_members');
        expect(sql).toContain('left_at IS NULL');
        expect(params).toEqual(['3']);
        return [
          { id: '1', name: '知乎', slug: 'zhihu', is_enabled: 1, created_at: new Date(), member_role: 'member' },
        ];
      }
      return [];
    });
    const res = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${await token('creator', '3')}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].memberRole).toBe('member');
  });
});
