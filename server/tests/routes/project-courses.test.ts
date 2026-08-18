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

const courseRow = (overrides: Record<string, unknown> = {}) => ({
  id: '10',
  project_id: '1',
  course_name: '课程 A',
  course_url: null,
  display_order: 0,
  is_active: 1,
  created_at: new Date('2026-08-18T00:00:00Z'),
  updated_at: new Date('2026-08-18T00:00:00Z'),
  ...overrides,
});

describe('项目课程：行级隔离与跨角色边界', () => {
  let app: Express;

  beforeEach(() => {
    dbMocks.query.mockReset();
    dbMocks.rows.mockReset().mockResolvedValue([]);
    dbMocks.connectionQuery.mockReset().mockResolvedValue([{ insertId: 10, affectedRows: 1 }]);
    dbMocks.withTransaction.mockReset().mockImplementation(async (work: (c: unknown) => Promise<unknown>) => {
      return work({ query: dbMocks.connectionQuery });
    });
    process.env.QUEUE_DRIVER = 'memory';
    app = createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creator 创建课程被拒绝（403），且不触达数据库', async () => {
    const res = await request(app)
      .post('/api/v1/projects/1/courses')
      .set('Authorization', `Bearer ${await token('creator', '3')}`)
      .send({ courseName: '课程 A' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40301);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('leader 创建课程被拒绝（403）——project.manage 仅限 admin', async () => {
    const res = await request(app)
      .post('/api/v1/projects/1/courses')
      .set('Authorization', `Bearer ${await token('leader', '2')}`)
      .send({ courseName: '课程 A' });
    expect(res.status).toBe(403);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('creator 非项目成员时课程列表 fail closed（40304）', async () => {
    dbMocks.rows.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM projects')) return [{ id: '1' }];
      if (sql.includes('FROM project_members')) return [];
      return [];
    });
    const res = await request(app)
      .get('/api/v1/projects/1/courses')
      .set('Authorization', `Bearer ${await token('creator', '3')}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40304);
    expect(dbMocks.rows.mock.calls.some(([sql]) => String(sql).includes('FROM project_courses'))).toBe(false);
  });

  it('creator 是项目成员时可读课程列表，按 display_order 排序', async () => {
    dbMocks.rows.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM projects')) return [{ id: '1' }];
      if (sql.includes('FROM project_members')) return [{ id: '5' }];
      if (sql.includes('FROM project_courses'))
        return [courseRow({ id: '10', display_order: 0 }), courseRow({ id: '11', course_name: '课程 B', display_order: 1 })];
      return [];
    });
    const res = await request(app)
      .get('/api/v1/projects/1/courses')
      .set('Authorization', `Bearer ${await token('creator', '3')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((item: { id: string }) => item.id)).toEqual(['10', '11']);
    const listSql = dbMocks.rows.mock.calls.find(([sql]) => String(sql).includes('FROM project_courses'));
    expect(String(listSql?.[0])).toContain('ORDER BY display_order');
  });

  it('项目不存在时返回 404，且不查课程表', async () => {
    dbMocks.rows.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/v1/projects/999/courses')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(40402);
    expect(dbMocks.rows.mock.calls.some(([sql]) => String(sql).includes('FROM project_courses'))).toBe(false);
  });

  it('admin 创建课程成功并写审计', async () => {
    dbMocks.rows.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM projects')) return [{ id: '1' }];
      if (sql.includes('FROM project_courses')) return [courseRow({ course_url: 'https://example.com/a' })];
      return [];
    });
    const res = await request(app)
      .post('/api/v1/projects/1/courses')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ courseName: '课程 A', courseUrl: 'https://example.com/a' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('10');
    expect(res.body.data.courseUrl).toBe('https://example.com/a');
    const audit = dbMocks.connectionQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_logs'));
    expect(audit).toBeDefined();
  });

  it('课程名为空时 422 拒绝', async () => {
    dbMocks.rows.mockImplementation(async (sql: string) => (sql.includes('FROM projects') ? [{ id: '1' }] : []));
    const res = await request(app)
      .post('/api/v1/projects/1/courses')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ courseName: '   ' });
    expect(res.status).toBe(422);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('admin 删除不存在的课程返回 404', async () => {
    dbMocks.rows.mockImplementation(async (sql: string) => (sql.includes('FROM projects') ? [{ id: '1' }] : []));
    dbMocks.connectionQuery.mockImplementation(async (sql: string) =>
      String(sql).includes('DELETE FROM project_courses') ? [{ affectedRows: 0 }] : [{ affectedRows: 1 }],
    );
    const res = await request(app)
      .delete('/api/v1/projects/1/courses/999')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(40404);
  });

  it('admin 删除课程成功并写审计', async () => {
    dbMocks.rows.mockImplementation(async (sql: string) => (sql.includes('FROM projects') ? [{ id: '1' }] : []));
    const res = await request(app)
      .delete('/api/v1/projects/1/courses/10')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(200);
    const deleteSql = dbMocks.connectionQuery.mock.calls.find(([sql]) =>
      String(sql).includes('DELETE FROM project_courses'),
    );
    expect(String(deleteSql?.[0])).toContain('AND project_id = ?');
    const audit = dbMocks.connectionQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_logs'));
    expect(audit).toBeDefined();
  });
});
