import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from './errors';
import { writeAudit } from '../services/audit.service';

export const LEGACY_WITHDRAWAL_WRITE_GATE_MESSAGE = '资金链启动 Gate 未关闭';

/**
 * 生产资金链放行 Gate（00 §D-001）。任一为 false 时真实结算/提现写操作保持 BLOCKED。
 * 稳定顺序：D-001-DECISION → D-001-READINESS → P0-008 → M6。
 *
 * Gate 状态由环境变量 FINANCE_GATES_PASSED 控制（逗号分隔），默认全关。
 * 例：FINANCE_GATES_PASSED=D-001-DECISION,D-001-READINESS,P0-008,M6
 */
const GATE_NAMES = ['D-001-DECISION', 'D-001-READINESS', 'P0-008', 'M6'] as const;

function readGates(): ReadonlyArray<readonly [string, boolean]> {
  const passed = new Set(
    (process.env.FINANCE_GATES_PASSED ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return GATE_NAMES.map((name) => [name, passed.has(name)] as const);
}

export function failedFinanceGates(): string[] {
  return readGates()
    .filter(([, passed]) => !passed)
    .map(([gate]) => gate);
}

function legacyWithdrawalWriteGateError(requestId: string, failedGates: string[]) {
  return new AppError(503, 50310, LEGACY_WITHDRAWAL_WRITE_GATE_MESSAGE, {
    requestId,
    timestamp: Date.now(),
    failedGates,
  });
}

export function assertLegacyWithdrawalWritesBlocked(): void {
  const failed = failedFinanceGates();
  if (failed.length > 0) throw legacyWithdrawalWriteGateError(crypto.randomUUID(), failed);
  // 全部 Gate 通过：放行（资金链已按 D-001-DECISION/READINESS/P0-008/M6 验收）
}

/**
 * 拒绝真实资金写操作：零资金副作用，但保留恰好一条含 requestId 与相同
 * failedGates 的 finance.gate_rejected 审计事件（02 §50310）。
 * 全部 Gate 通过时（FINANCE_GATES_PASSED 配齐）直接放行。
 */
export const blockLegacyWithdrawalWrites: RequestHandler = (req, _res, next) => {
  const failedGates = failedFinanceGates();
  if (failedGates.length === 0) return next();
  const requestId = crypto.randomUUID();
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
