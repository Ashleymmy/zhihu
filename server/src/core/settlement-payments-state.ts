import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { SettlementDocument } from './settlement-contracts';
import { cash } from './money';

/** Live projection only. The confirmed document and earning entries remain unchanged. */
export async function settlementPaymentStatus(
  c: PoolConnection,
  doc: SettlementDocument,
): Promise<'not_initiated' | 'processing' | 'partially_paid' | 'paid' | 'needs_review'> {
  if (doc.status !== 'confirmed') return 'not_initiated';
  const s = doc.scope,
    records = doc.items.filter((i) => i.status === 'confirmed');
  if (!records.length) return 'not_initiated';
  const [sources] = await c.query<RowDataPacket[]>(
    `SELECT CAST(es.id AS CHAR) id,CAST(COALESCE(SUM(e.amount),0) AS CHAR) amount,
    es.blocked_reason,ins.blocked_reason income_blocked,es.current_version,ins.source_version,
    (SELECT COUNT(*) FROM opc_earning_lines l WHERE l.source_id=es.id AND l.source_version=es.current_version AND (l.confirmed_at IS NULL OR l.is_ready=0)) unconfirmed
    FROM opc_earning_sources es LEFT JOIN opc_income_sources ins ON ins.module_id=es.module_id AND ins.account_id=es.account_id AND ins.source_key=es.source_key
    LEFT JOIN opc_income_entries e ON e.source_id=ins.id AND e.user_id=? WHERE es.id IN (?) GROUP BY es.id,ins.id`,
    [s.leaderId, records.map((i) => i.record.id)],
  );
  const [links] = await c.query<RowDataPacket[]>(
    `SELECT CAST(a.earning_source_id AS CHAR) source_id,CAST(a.amount AS CHAR) amount,w.status,o.failure_reason
    FROM opc_settlement_payment_allocations a JOIN opc_withdrawals w ON w.id=a.withdrawal_id LEFT JOIN opc_settlement_payment_origins o ON o.withdrawal_id=w.id
    WHERE a.user_id=? AND a.earning_source_id IN (?) AND w.status IN ('pending','approved','paid')`,
    [s.leaderId, records.map((i) => i.record.id)],
  );
  const [legacy] = await c.query<RowDataPacket[]>(
    `SELECT w.id FROM opc_withdrawals w WHERE w.module_id=? AND w.project_id=? AND w.account_id=? AND w.user_id=? AND w.status IN ('pending','approved','paid')
    AND w.amount>COALESCE((SELECT SUM(a.amount) FROM opc_settlement_payment_allocations a WHERE a.withdrawal_id=w.id),0) LIMIT 1`,
    [s.moduleId, s.projectId, s.accountId, s.leaderId],
  );
  if (legacy.length || links.some((l) => l.failure_reason)) return 'needs_review';
  let target = 0n,
    paid = 0n,
    processing = 0n;
  for (const source of sources) {
    if (
      source.blocked_reason ||
      source.income_blocked ||
      source.current_version !== source.source_version ||
      Number(source.unconfirmed) > 0
    )
      return 'needs_review';
    const saved = cash(records.find((i) => i.record.id === source.id)!.record.confirmedAmount, true),
      current = cash(String(source.amount), true),
      cap = saved < current ? saved : current;
    const sourceLinks = links.filter((l) => l.source_id === source.id),
      reserved = sourceLinks.reduce((n, l) => n + cash(String(l.amount)), 0n);
    if (reserved > cap) return 'needs_review';
    target += cap;
    for (const link of sourceLinks)
      if (link.status === 'paid') paid += cash(String(link.amount));
      else processing += cash(String(link.amount));
  }
  return processing > 0n
    ? paid > 0n
      ? 'partially_paid'
      : 'processing'
    : paid > 0n
      ? paid >= target
        ? 'paid'
        : 'partially_paid'
      : 'not_initiated';
}
