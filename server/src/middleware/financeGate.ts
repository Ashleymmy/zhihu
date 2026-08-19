import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from './errors';
import { writeAudit } from '../services/audit.service';

export const LEGACY_WITHDRAWAL_WRITE_GATE_MESSAGE = '资金链启动 Gate 未关闭';

/**
 * 生产资金链放行 Gate（00 §D-001）。任一为 false 时真实结算/提现写操作保持 BLOCKED。
 * 稳定顺序：D-001-DECISION → D-001-READINESS → P0-008 → M6。
 */
const FINANCE_GATES = [
  ['D-001-DECISION', false],
  ['D-001-READINESS', false],
  ['P0-008', false],
  ['M6', false],
] as const;

export function failedFinanceGates(): string[] {
  return FINANCE_GATES.filter(([, passed]) => !passed).map(([gate]) => gate);
}

function legacyWithdrawalWriteGateError(requestId: string, failedGates: string[]) {
  return new AppError(503, 50310, LEGACY_WITHDRAWAL_WRITE_GATE_MESSAGE, {
    requestId,
    timestamp: Date.now(),
    failedGates,
  });
}

export function assertLegacyWithdrawalWritesBlocked(): never {
  throw legacyWithdrawalWriteGateError(crypto.randomUUID(), failedFinanceGates());
}

/**
 * 拒绝真实资金写操作：零资金副作用，但保留恰好一条含 requestId 与相同
 * failedGates 的 finance.gate_rejected 审计事件（02 §50310）。
 */
export const blockLegacyWithdrawalWrites: RequestHandler = (req, _res, next) => {
  const requestId = crypto.randomUUID();
  const failedGates = failedFinanceGates();
  void writeAudit({
    userId: req.user?.sub ?? null,
    action: 'finance.gate_rejected',
    resourceType: 'finance',
    resourceId: requestId,
    detail: { requestId, failedGates, path: req.originalUrl, method: req.method },
    ip: req.ip,
  })
    .catch(() => undefined) // 审计失败不改变拒绝结果——资金链依旧 fail closed
    .finally(() => next(legacyWithdrawalWriteGateError(requestId, failedGates)));
};
