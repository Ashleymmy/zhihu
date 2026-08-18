import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwt from '../../src/auth/jwt';
import * as revocation from '../../src/auth/revocation';
import { errorHandler } from '../../src/middleware/errors';
import { withdrawalsRouter } from '../../src/routes/withdrawals';
import type { AuthUser } from '../../src/types';

const serviceMocks = vi.hoisted(() => ({
  listWithdrawals: vi.fn(),
  createWithdrawal: vi.fn(),
  approveWithdrawal: vi.fn(),
  rejectWithdrawal: vi.fn(),
}));

vi.mock('../../src/services/earnings.service', () => ({
  listWithdrawals: serviceMocks.listWithdrawals,
  createWithdrawal: serviceMocks.createWithdrawal,
  approveWithdrawal: serviceMocks.approveWithdrawal,
  rejectWithdrawal: serviceMocks.rejectWithdrawal,
}));

const users: Record<string, AuthUser> = {
  member: {
    sub: '4',
    role: 'member',
    parentId: '2',
    username: 'member-a',
    displayName: 'Member A',
    jti: 'member-jti',
  },
  leader: {
    sub: '2',
    role: 'leader',
    parentId: '1',
    username: 'leader-a',
    displayName: 'Leader A',
    jti: 'leader-jti',
  },
  boss: {
    sub: '1',
    role: 'boss',
    parentId: null,
    username: 'boss',
    displayName: 'Boss',
    jti: 'boss-jti',
  },
};

const gateResponse = { code: 50310, data: null, message: '资金链启动 Gate 未关闭' };

function createWithdrawalsApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/withdrawals', withdrawalsRouter);
  app.use(errorHandler);
  return app;
}

function authorization(token: keyof typeof users) {
  return `Bearer ${token}`;
}

function expectNoWriteServices() {
  expect(serviceMocks.createWithdrawal).not.toHaveBeenCalled();
  expect(serviceMocks.approveWithdrawal).not.toHaveBeenCalled();
  expect(serviceMocks.rejectWithdrawal).not.toHaveBeenCalled();
}

describe('legacy 提现写路径 Gate', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createWithdrawalsApp();
    serviceMocks.listWithdrawals.mockResolvedValue({ list: [], total: 0, page: 1, pageSize: 20 });
    vi.spyOn(jwt, 'verifyToken').mockImplementation((token) => {
      const user = users[token];
      if (!user) throw new Error('unknown test token');
      return user;
    });
    vi.spyOn(revocation.revocationStore, 'isRevoked').mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('三个 POST 无 Token 时保持 40100 且不调用写 Service', async () => {
    const responses = await Promise.all([
      request(app).post('/api/v1/withdrawals').send({ amount: 10, payMethod: 'alipay', payAccount: 'a@example.com' }),
      request(app).post('/api/v1/withdrawals/1/approve').send({}),
      request(app).post('/api/v1/withdrawals/1/reject').send({ remark: '拒绝原因' }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.code).toBe(40100);
    }
    expectNoWriteServices();
  });

  it('member 和 leader 对 approve/reject 保持 40301 且不调用写 Service', async () => {
    for (const token of ['member', 'leader'] as const) {
      for (const path of ['/api/v1/withdrawals/1/approve', '/api/v1/withdrawals/1/reject']) {
        const response = await request(app)
          .post(path)
          .set('Authorization', authorization(token))
          .send({ remark: '拒绝原因' });
        expect(response.status).toBe(403);
        expect(response.body.code).toBe(40301);
      }
    }
    expectNoWriteServices();
  });

  it('合法 member/leader 申请稳定返回 50310 且不调用 Service', async () => {
    for (const token of ['member', 'leader'] as const) {
      const response = await request(app)
        .post('/api/v1/withdrawals')
        .set('Authorization', authorization(token))
        .send({ amount: 10, payMethod: 'alipay', payAccount: 'a@example.com' });
      expect(response.status).toBe(503);
      expect(response.body).toEqual(gateResponse);
    }
    expectNoWriteServices();
  });

  it('合法 boss approve/reject 稳定返回 50310 且不调用 Service', async () => {
    const responses = await Promise.all([
      request(app).post('/api/v1/withdrawals/1/approve').set('Authorization', authorization('boss')).send({}),
      request(app)
        .post('/api/v1/withdrawals/1/reject')
        .set('Authorization', authorization('boss'))
        .send({ remark: '拒绝原因' }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.body).toEqual(gateResponse);
    }
    expectNoWriteServices();
  });

  it('三个 POST 忽略 query、body、Header 和 Cookie 中的伪造开关', async () => {
    const bypass = { d001Approved: true, p0008Approved: true, financeGate: 'open' };
    const responses = await Promise.all([
      request(app)
        .post('/api/v1/withdrawals')
        .query(bypass)
        .set('Authorization', authorization('member'))
        .set('x-finance-gate', 'open')
        .set('Cookie', 'financeGate=open')
        .send({ amount: 0, payMethod: 'alipay', payAccount: '', ...bypass }),
      request(app)
        .post('/api/v1/withdrawals/1/approve')
        .query(bypass)
        .set('Authorization', authorization('boss'))
        .set('x-finance-gate', 'open')
        .set('Cookie', 'financeGate=open')
        .send(bypass),
      request(app)
        .post('/api/v1/withdrawals/1/reject')
        .query(bypass)
        .set('Authorization', authorization('boss'))
        .set('x-finance-gate', 'open')
        .set('Cookie', 'financeGate=open')
        .send({ remark: '', ...bypass }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.body).toEqual(gateResponse);
    }
    expectNoWriteServices();
  });

  it('合法 JSON 的非法业务字段或 id 仍先返回 50310，Malformed JSON 保持 40000', async () => {
    const gatedResponses = await Promise.all([
      request(app)
        .post('/api/v1/withdrawals')
        .set('Authorization', authorization('member'))
        .send({ amount: 0, payMethod: 'alipay', payAccount: '' }),
      request(app)
        .post('/api/v1/withdrawals/not-a-number/approve')
        .set('Authorization', authorization('boss'))
        .send({}),
      request(app)
        .post('/api/v1/withdrawals/not-a-number/reject')
        .set('Authorization', authorization('boss'))
        .send({ remark: '' }),
    ]);

    for (const response of gatedResponses) {
      expect(response.status).toBe(503);
      expect(response.body).toEqual(gateResponse);
    }

    const malformed = await request(app)
      .post('/api/v1/withdrawals')
      .set('Authorization', authorization('member'))
      .set('Content-Type', 'application/json')
      .send('{"amount":');
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ code: 40000, data: null, message: '请求体不是有效 JSON' });
    expectNoWriteServices();
  });

  it('GET /withdrawals 保持读行为且三个写 Service 均为 0 次', async () => {
    serviceMocks.listWithdrawals.mockResolvedValue({
      list: [{ id: '1', amount: 10, pay_account: '13****00' }],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const response = await request(app)
      .get('/api/v1/withdrawals?page=1&pageSize=20')
      .set('Authorization', authorization('member'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      code: 0,
      data: { list: [{ id: '1', amount: 10, payAccount: '13****00' }], total: 1, page: 1, pageSize: 20 },
      message: 'ok',
    });
    expect(serviceMocks.listWithdrawals).toHaveBeenCalledTimes(1);
    expectNoWriteServices();
  });
});
