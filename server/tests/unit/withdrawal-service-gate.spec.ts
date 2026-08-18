import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/middleware/errors';
import { approveWithdrawal, createWithdrawal, rejectWithdrawal } from '../../src/services/earnings.service';
import type { AuthUser } from '../../src/types';

const mocks = vi.hoisted(() => ({
  rows: vi.fn(),
  withTransaction: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  rows: mocks.rows,
  withTransaction: mocks.withTransaction,
}));

vi.mock('../../src/services/audit.service', () => ({
  writeAudit: mocks.writeAudit,
}));

const user: AuthUser = {
  sub: '4',
  role: 'member',
  parentId: '2',
  username: 'member-a',
  displayName: 'Member A',
  jti: 'member-jti',
};

async function expectBlocked(operation: Promise<unknown>) {
  await expect(operation).rejects.toBeInstanceOf(AppError);
  await expect(operation).rejects.toMatchObject({
    httpStatus: 503,
    code: 50310,
    message: '资金链启动 Gate 未关闭',
  });
}

function expectNoSideEffects() {
  expect(mocks.withTransaction).not.toHaveBeenCalled();
  expect(mocks.rows).not.toHaveBeenCalled();
  expect(mocks.writeAudit).not.toHaveBeenCalled();
}

describe('legacy 提现 Service Gate', () => {
  beforeEach(() => {
    mocks.rows.mockReset();
    mocks.withTransaction.mockReset();
    mocks.writeAudit.mockReset();
  });

  it('createWithdrawal 在事务前硬关闭且零副作用', async () => {
    await expectBlocked(
      createWithdrawal(user, {
        amount: 10,
        payMethod: 'alipay',
        payAccount: 'a@example.com',
      }),
    );
    expectNoSideEffects();
  });

  it('approveWithdrawal 在事务前硬关闭且零副作用', async () => {
    await expectBlocked(approveWithdrawal(user, '1'));
    expectNoSideEffects();
  });

  it('rejectWithdrawal 在事务前硬关闭且零副作用', async () => {
    await expectBlocked(rejectWithdrawal(user, '1', '拒绝原因'));
    expectNoSideEffects();
  });
});
