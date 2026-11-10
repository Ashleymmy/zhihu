import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../middleware/errors';
import { cash } from './money';

/** Called under the existing finance scope lock by both payment entry points. */
export async function assertSettlementPaymentSafe(c: PoolConnection, withdrawalId: string, resumingFailure = false) {
  const [origins] = await c.query<RowDataPacket[]>(
    'SELECT failure_reason FROM opc_settlement_payment_origins WHERE withdrawal_id=?',
    [withdrawalId],
  );
  if (origins[0]?.failure_reason && !resumingFailure)
    throw new AppError(409, 40900, '这笔付款办理已记录失败，请先核对原因并继续原办理记录');
  const [allocated] = await c.query<RowDataPacket[]>(
    `SELECT a.income_source_id,a.user_id,s.blocked_reason,
      CAST((SELECT COALESCE(SUM(e.amount),0) FROM opc_income_entries e WHERE e.source_id=a.income_source_id AND e.user_id=a.user_id AND e.availability='available') AS CHAR) released,
      CAST((SELECT COALESCE(SUM(b.amount),0) FROM opc_settlement_payment_allocations b JOIN opc_withdrawals w ON w.id=b.withdrawal_id
        WHERE b.income_source_id=a.income_source_id AND b.user_id=a.user_id AND w.status IN ('pending','approved','paid')) AS CHAR) reserved,
      es.current_version,s.source_version,es.blocked_reason earning_blocked,
      (SELECT COUNT(*) FROM opc_earning_lines l WHERE l.source_id=es.id AND l.source_version=es.current_version AND (l.confirmed_at IS NULL OR l.is_ready=0)) unconfirmed
     FROM opc_settlement_payment_allocations a JOIN opc_income_sources s ON s.id=a.income_source_id
     JOIN opc_earning_sources es ON es.id=a.earning_source_id WHERE a.withdrawal_id=? AND a.amount>0`,
    [withdrawalId],
  );
  for (const row of allocated) {
    if (
      row.blocked_reason ||
      row.earning_blocked ||
      row.current_version !== row.source_version ||
      Number(row.unconfirmed) > 0 ||
      cash(String(row.reserved)) > cash(String(row.released), true)
    )
      throw new AppError(409, 40900, '关联收益的金额或状态已变化，请先核对结算记录再办理付款');
  }
}
