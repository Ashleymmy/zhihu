import { unitClientId, unitSessionId } from '../support/unitAuthSession';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwt from '../../src/auth/jwt';
import * as revocation from '../../src/auth/revocation';
import { errorHandler } from '../../src/middleware/errors';
import { withdrawalsRouter } from '../../src/modules/zhihu/routes/withdrawals';
import type { AuthUser } from '../../src/types';

vi.mock('../../src/db', async (original) => {
  const { unitAuthRows } = await import('../support/unitAuthSession');
  return {
    ...(await original<typeof import('../../src/db')>()),
    rows: vi.fn(
      unitAuthRows({
        '4': { role: 'creator', parent_id: '2' },
        '2': { role: 'leader', parent_id: '1' },
        '1': { role: 'admin' },
      }),
    ),
  };
});

const serviceMocks = vi.hoisted(() => ({
  listWithdrawals: vi.fn(),
  applyWithdrawal: vi.fn(),
  cancelWithdrawal: vi.fn(),
  reviewWithdrawal: vi.fn(),
  decideWithdrawal: vi.fn(),
  uploadInvoice: vi.fn(),
  getInvoice: vi.fn(),
  getStatement: vi.fn(),
}));

vi.mock('../../src/modules/zhihu/services/finance-approvals.service', () => serviceMocks);

const users: Record<string, AuthUser> = {
  creator: {
    sub: '4',
    sessionId: unitSessionId('4'),
    role: 'creator',
    parentId: '2',
    username: 'member-a',
    displayName: 'Member A',
    jti: 'member-jti',
  },
  leader: {
    sub: '2',
    sessionId: unitSessionId('2'),
    role: 'leader',
    parentId: '1',
    username: 'leader-a',
    displayName: 'Leader A',
    jti: 'leader-jti',
  },
  admin: {
    sub: '1',
    sessionId: unitSessionId('1'),
    role: 'admin',
    parentId: null,
    username: 'admin',
    displayName: 'Boss',
    jti: 'boss-jti',
  },
};

/** Historical finance writes remain closed after platform finance took over. */
function expectReadOnlyResponse(body: Record<string, unknown>) {
  expect(body).toEqual({ code: 41001, data: null, message: '历史账目仅供查询，请到财务或我的收益办理。' });
}

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
  for (const service of [
    'applyWithdrawal',
    'cancelWithdrawal',
    'reviewWithdrawal',
    'decideWithdrawal',
    'uploadInvoice',
  ] as const)
    expect(serviceMocks[service]).not.toHaveBeenCalled();
}

describe('历史提现入口只读', () => {
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

  it('达人、团长和管理员均不能通过现有或已移除的历史入口写账', async () => {
    for (const token of ['creator', 'leader', 'admin'] as const) {
      for (const action of ['cancel', 'review', 'decide', 'invoice', 'approve', 'reject']) {
        const response = await request(app)
          .post('/api/v1/withdrawals/1/' + action)
          .set('X-Client-Id', unitClientId)
          .set('Authorization', authorization(token))
          .send({ remark: '拒绝原因' });
        expect(response.status).toBe(410);
        expectReadOnlyResponse(response.body);
      }
    }
    expectNoWriteServices();
  });

  it('达人和团长 申请稳定返回 41001 且不调用 Service', async () => {
    for (const token of ['creator', 'leader'] as const) {
      const response = await request(app)
        .post('/api/v1/withdrawals')
        .set('X-Client-Id', unitClientId)
        .set('Authorization', authorization(token))
        .send({ amount: 10, payMethod: 'alipay', payAccount: 'a@example.com' });
      expect(response.status).toBe(410);
      expectReadOnlyResponse(response.body);
    }
    expectNoWriteServices();
  });

  it('管理员 approve/reject 稳定返回 41001 且不调用 Service', async () => {
    const responses = await Promise.all([
      request(app)
        .post('/api/v1/withdrawals/1/approve')
        .set('X-Client-Id', unitClientId)
        .set('Authorization', authorization('admin'))
        .send({}),
      request(app)
        .post('/api/v1/withdrawals/1/reject')
        .set('X-Client-Id', unitClientId)
        .set('Authorization', authorization('admin'))
        .send({ remark: '拒绝原因' }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(410);
      expectReadOnlyResponse(response.body);
    }
    expectNoWriteServices();
  });

  it('三个 POST 忽略 query、body、Header 和 Cookie 中的伪造开关', async () => {
    const bypass = { d001Approved: true, p0008Approved: true, financeGate: 'open' };
    const responses = await Promise.all([
      request(app)
        .post('/api/v1/withdrawals')
        .query(bypass)
        .set('X-Client-Id', unitClientId)
        .set('Authorization', authorization('creator'))
        .set('x-finance-gate', 'open')
        .set('Cookie', 'financeGate=open')
        .send({ amount: 0, payMethod: 'alipay', payAccount: '', ...bypass }),
      request(app)
        .post('/api/v1/withdrawals/1/approve')
        .query(bypass)
        .set('X-Client-Id', unitClientId)
        .set('Authorization', authorization('admin'))
        .set('x-finance-gate', 'open')
        .set('Cookie', 'financeGate=open')
        .send(bypass),
      request(app)
        .post('/api/v1/withdrawals/1/reject')
        .query(bypass)
        .set('X-Client-Id', unitClientId)
        .set('Authorization', authorization('admin'))
        .set('x-finance-gate', 'open')
        .set('Cookie', 'financeGate=open')
        .send({ remark: '', ...bypass }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(410);
      expectReadOnlyResponse(response.body);
    }
    expectNoWriteServices();
  });

  it('合法 JSON 的非法业务字段或 id 仍先返回 41001，Malformed JSON 保持 40000', async () => {
    const gatedResponses = await Promise.all([
      request(app)
        .post('/api/v1/withdrawals')
        .set('X-Client-Id', unitClientId)
        .set('Authorization', authorization('creator'))
        .send({ amount: 0, payMethod: 'alipay', payAccount: '' }),
      request(app)
        .post('/api/v1/withdrawals/not-a-number/approve')
        .set('X-Client-Id', unitClientId)
        .set('Authorization', authorization('admin'))
        .send({}),
      request(app)
        .post('/api/v1/withdrawals/not-a-number/reject')
        .set('X-Client-Id', unitClientId)
        .set('Authorization', authorization('admin'))
        .send({ remark: '' }),
    ]);

    for (const response of gatedResponses) {
      expect(response.status).toBe(410);
      expectReadOnlyResponse(response.body);
    }

    const malformed = await request(app)
      .post('/api/v1/withdrawals')
      .set('X-Client-Id', unitClientId)
      .set('Authorization', authorization('creator'))
      .set('Content-Type', 'application/json')
      .send('{"amount":');
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ code: 40000, data: null, message: '请求体不是有效 JSON' });
    expectNoWriteServices();
  });

  it('GET /withdrawals 保持读行为且全部写 Service 均为 0 次', async () => {
    serviceMocks.listWithdrawals.mockResolvedValue({
      list: [{ id: '1', amount: 10, pay_account: '13****00' }],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const response = await request(app)
      .get('/api/v1/withdrawals?page=1&pageSize=20')
      .set('X-Client-Id', unitClientId)
      .set('Authorization', authorization('creator'));

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
