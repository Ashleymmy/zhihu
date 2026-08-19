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

describe('收益与提现路由：作用域 + 财务门禁', () => {
  let app: Express;

  beforeEach(() => {
    dbMocks.query.mockReset().mockResolvedValue([{ affectedRows: 1 }]);
    dbMocks.rows.mockReset().mockResolvedValue([]);
    dbMocks.connectionQuery.mockReset().mockResolvedValue([{ insertId: 1, affectedRows: 1 }]);
    dbMocks.withTransaction.mockReset().mockImplementation(async (work: (c: unknown) => Promise<unknown>) =>
      work({ query: dbMocks.connectionQuery }),
    );
    process.env.QUEUE_DRIVER = 'memory';
    app = createApp();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  // ── GET /earnings ─────────────────────────────────────────────

  it('creator 收益列表只查自身（SQL 绑定 user_id）', async () => {
    dbMocks.rows.mockResolvedValue([{ total: 0 }]);
    await request(app)
      .get('/api/v1/earnings')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    const [sql, params] = dbMocks.rows.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('user_id');
    expect(params).toContain('4');
  });

  it('admin 收益列表无用户过滤', async () => {
    dbMocks.rows.mockResolvedValue([{ total: 0 }]);
    await request(app)
      .get('/api/v1/earnings')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    const [sql] = dbMocks.rows.mock.calls[0] as [string];
    expect(sql).not.toMatch(/user_id\s*=\s*\?/);
  });

  it('GET /earnings/summary 返回 pending/confirmed/paid/withdrawn', async () => {
    dbMocks.rows
      .mockResolvedValueOnce([{ pending: 100, confirmed: 200, paid: 50 }])
      .mockResolvedValueOnce([{ withdrawn: 30 }]);
    const res = await request(app)
      .get('/api/v1/earnings/summary')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ pending: 100, confirmed: 200, paid: 50, withdrawn: 30 });
  });

  // ── POST /withdrawals（财务门禁）────────────────────────────────

  it('creator 申请提现被财务门禁以 50310 拒绝', async () => {
    const res = await request(app)
      .post('/api/v1/withdrawals')
      .set('Authorization', `Bearer ${await token('creator', '4')}`)
      .send({ amount: 100, payMethod: 'alipay', payAccount: '13800000000' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe(50310);
    expect(res.body.failedGates).toContain('D-001-DECISION');
  });

  it('提现门禁写入 finance.gate_rejected 审计（不计入金融快照）', async () => {
    await request(app)
      .post('/api/v1/withdrawals')
      .set('Authorization', `Bearer ${await token('creator', '4')}`)
      .send({ amount: 100, payMethod: 'alipay', payAccount: '13800000000' });
    // 等异步审计写入
    await new Promise((r) => setTimeout(r, 50));
    const auditCall = dbMocks.query.mock.calls.find(([s]) => String(s).includes('INSERT INTO audit_logs'));
    expect(auditCall).toBeDefined();
    const detail = JSON.parse(auditCall![1][4] as string);
    expect(detail.failedGates).toContain('D-001-DECISION');
  });

  it('admin 审批提现被财务门禁拒绝（50310）', async () => {
    const res = await request(app)
      .post('/api/v1/withdrawals/1/approve')
      .set('Authorization', `Bearer ${await token('admin', '1')}`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe(50310);
  });

  it('admin 拒绝提现被财务门禁拒绝（50310）', async () => {
    const res = await request(app)
      .post('/api/v1/withdrawals/1/reject')
      .set('Authorization', `Bearer ${await token('admin', '1')}`)
      .send({ remark: '测试拒绝' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe(50310);
  });

  it('leader 无 withdraw.approve 权限审批被拒绝（403）', async () => {
    const res = await request(app)
      .post('/api/v1/withdrawals/1/approve')
      .set('Authorization', `Bearer ${await token('leader', '2')}`);
    expect(res.status).toBe(403);
  });

  // ── GET /withdrawals ──────────────────────────────────────────

  it('GET /withdrawals 列表不含财务门禁', async () => {
    dbMocks.rows
      .mockResolvedValueOnce([{ total: 0 }])   // COUNT(*)
      .mockResolvedValue([]);                   // list rows
    const res = await request(app)
      .get('/api/v1/withdrawals')
      .set('Authorization', `Bearer ${await token('creator', '4')}`);
    expect(res.status).toBe(200);
  });
});
