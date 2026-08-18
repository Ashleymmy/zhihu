import type { RequestHandler } from 'express';
import { AppError } from './errors';

export const LEGACY_WITHDRAWAL_WRITE_GATE_MESSAGE = '资金链启动 Gate 未关闭';

function legacyWithdrawalWriteGateError() {
  return new AppError(503, 50310, LEGACY_WITHDRAWAL_WRITE_GATE_MESSAGE);
}

export function assertLegacyWithdrawalWritesBlocked(): never {
  throw legacyWithdrawalWriteGateError();
}

export const blockLegacyWithdrawalWrites: RequestHandler = (_req, _res, next) => {
  next(legacyWithdrawalWriteGateError());
};
