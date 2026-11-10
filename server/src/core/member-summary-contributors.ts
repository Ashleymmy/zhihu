import type { AuthUser } from '../types';
import { withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import type { ModuleRuntime } from './module-runtime';
import { cash, cashText } from './money';
import { insightContext, insightFilter, insightScopes, queryRows, scopedSql } from './insights-scope';

export async function leaderContributors(runtime: ModuleRuntime, user: AuthUser, query: Record<string, unknown>) {
  if (user.role !== 'leader') throw new AppError(403, 40301, '请使用团长账号查看本人团队分成');
  const filter = insightFilter({ days: 30, ...query }), scopes = await insightScopes(runtime, user, filter);
  return withTransaction(async c => {
    const scope = scopedSql('s', scopes);
    const rows = await queryRows(c, `SELECT CAST(l.performer_id AS CHAR) performer_id,MAX(l.performer_name) performer_name,
      s.metric_type,s.metric_label,s.quantity_unit,COUNT(*) records,CAST(SUM(l.quantity) AS CHAR) quantity,SUM(l.quantity IS NULL) quantity_missing,
      CAST(SUM(CASE WHEN l.source_version=s.current_version THEN l.amount ELSE COALESCE(paid.confirmed,0) END) AS CHAR) amount,
      CAST(SUM(COALESCE(paid.confirmed,0)) AS CHAR) confirmed_amount,
      SUM(l.source_version=s.current_version AND l.amount IS NULL) pending_calculations
      FROM opc_earning_sources s JOIN opc_earning_lines l ON l.source_id=s.id AND l.payee_id=? AND (
        l.source_version=s.current_version OR (NOT EXISTS(SELECT 1 FROM opc_earning_lines current_line WHERE current_line.source_id=s.id AND current_line.payee_id=l.payee_id AND current_line.source_version=s.current_version)
          AND l.id=(SELECT past.id FROM opc_earning_lines past WHERE past.source_id=s.id AND past.payee_id=l.payee_id AND past.confirmed_at IS NOT NULL ORDER BY past.confirmed_at DESC,past.id DESC LIMIT 1)))
      LEFT JOIN opc_income_sources inc ON inc.module_id=s.module_id AND inc.project_id=s.project_id AND inc.account_id=s.account_id AND inc.source_key=s.source_key
      LEFT JOIN (SELECT source_id,SUM(amount) confirmed FROM opc_income_entries WHERE user_id=? GROUP BY source_id) paid ON paid.source_id=inc.id
      WHERE ${scope.sql} AND s.business_date BETWEEN ? AND ? AND l.performer_id<>l.payee_id AND l.is_internal=0
      GROUP BY l.performer_id,s.metric_type,s.metric_label,s.quantity_unit ORDER BY l.performer_id,s.metric_type`, [user.sub, user.sub, ...scope.args, filter.from, filter.to]);
    const groups = new Map<string, { performerId: string; name: string; amount: string; confirmedAmount: string; pendingCalculations: number; records: number; quantities: { metricType: string; label: string; unit: string; quantity: string | null; records: number }[] }>();
    for (const r of rows) {
      const performerId = String(r.performer_id);
      const item = groups.get(performerId) ?? { performerId, name: String(r.performer_name), amount: '0.0000', confirmedAmount: '0.0000', pendingCalculations: 0, records: 0, quantities: [] };
      item.amount = cashText(cash(item.amount, true) + cash(String(r.amount ?? '0'), true));
      item.confirmedAmount = cashText(cash(item.confirmedAmount, true) + cash(String(r.confirmed_amount ?? '0'), true));
      item.pendingCalculations += Number(r.pending_calculations);
      item.records += Number(r.records);
      item.quantities.push({ metricType: String(r.metric_type), label: String(r.metric_label), unit: String(r.quantity_unit), quantity: Number(r.quantity_missing) || r.quantity === null ? null : String(r.quantity), records: Number(r.records) });
      groups.set(performerId, item);
    }
    const all = [...groups.values()].sort((a, b) => { const difference = cash(b.amount, true) - cash(a.amount, true); return difference ? difference > 0n ? 1 : -1 : BigInt(a.performerId) < BigInt(b.performerId) ? -1 : 1; });
    const amount = cashText(all.reduce((sum, r) => sum + cash(r.amount, true), 0n));
    const confirmedAmount = cashText(all.reduce((sum, r) => sum + cash(r.confirmedAmount, true), 0n));
    return { ...insightContext(filter, scopes), status: all.length ? 'ready' : 'empty', ownerId: user.sub, ownershipBasis: 'saved_payee_and_performer',
      list: all.slice((filter.page - 1) * filter.pageSize, filter.page * filter.pageSize).map(r => ({ ...r, knownAmount: r.amount, amount: r.pendingCalculations ? null : r.amount, pendingAmount: r.pendingCalculations ? null : cashText(cash(r.amount, true) - cash(r.confirmedAmount, true)),
        detail: { endpoint: '/api/v1/core/earnings/mine', query: { projectId: filter.projectId, accountId: filter.accountId, moduleId: filter.moduleId, from: filter.from, to: filter.to, group: 'team', performerId: r.performerId } } })),
      total: all.length, page: filter.page, pageSize: filter.pageSize,
      summary: { amount: all.some(r => r.pendingCalculations) ? null : amount, knownAmount: amount, confirmedAmount, pendingAmount: all.some(r => r.pendingCalculations) ? null : cashText(cash(amount, true) - cash(confirmedAmount, true)), records: all.reduce((sum, r) => sum + r.records, 0), pendingCalculations: all.reduce((sum, r) => sum + r.pendingCalculations, 0) } };
  });
}
