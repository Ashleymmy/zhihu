import { Router } from 'express';
import type { AuthUser } from '../types';
import { withTransaction } from '../db';
import { asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { assertDuty } from './duties';
import { cash, cashText } from './money';
import type { ModuleRuntime } from './module-runtime';
import { insightContext, insightFilter, insightScopes, queryRows, scopedSql, todayInShanghai } from './insights-scope';

const amount = (v: unknown) => cashText(cash(String(v ?? '0'), true));
const methods: Record<string, string> = { bank: '银行转账', alipay: '支付宝', wechat: '微信' };
export async function readFinanceOverview(runtime: ModuleRuntime, user: AuthUser, name: 'today-payouts' | 'reconcile-progress' | 'withdrawals/pending', query: unknown) {
  assertDuty(user, 'finance');
  const filter = insightFilter(query), scopes = await insightScopes(runtime, user, filter);
  return withTransaction(async c => {
    if (name === 'reconcile-progress') {
      const scope = scopedSql('s', scopes);
      const rows = await queryRows(c, `SELECT CAST(s.project_id AS CHAR) project_id,MAX(p.name) name,DATE_FORMAT(s.business_date,'%Y-%m-%d') business_date,
        COUNT(DISTINCT s.id) sources,MIN(CASE WHEN l.id IS NOT NULL AND l.is_ready=1 AND COALESCE(s.blocked_reason,'')='' THEN 1 ELSE 0 END) checked,
        MIN(CASE WHEN l.id IS NOT NULL AND (l.confirmed_at IS NOT NULL OR l.is_internal=1) AND COALESCE(s.blocked_reason,'')='' THEN 1 ELSE 0 END) confirmed
        FROM opc_earning_sources s JOIN projects p ON p.id=s.project_id LEFT JOIN opc_earning_lines l ON l.source_id=s.id AND l.source_version=s.current_version
        WHERE ${scope.sql} AND s.business_date BETWEEN ? AND ? GROUP BY s.project_id,s.business_date ORDER BY s.project_id,s.business_date`, [...scope.args, filter.from, filter.to]);
      const byProject = [...new Set(rows.map(r => String(r.project_id)))].map(projectId => {
        const days = rows.filter(r => String(r.project_id) === projectId);
        return { projectId, name: String(days[0].name), checked: days.filter(r => Number(r.checked) === 1).length, confirmed: days.filter(r => Number(r.confirmed) === 1).length, total: days.length,
          days: days.map(r => ({ date: String(r.business_date), checked: Number(r.checked) === 1, confirmed: Number(r.confirmed) === 1, sources: Number(r.sources), detail: { path: '/finance', query: { projectId, accountId: filter.accountId, moduleId: filter.moduleId, from: r.business_date, to: r.business_date } } })) };
      });
      const checkedDays = rows.filter(r => Number(r.checked) === 1).length;
      return { ...insightContext(filter, scopes), status: rows.length ? 'ready' : 'empty', checkedDays, totalDays: rows.length, rate: rows.length ? checkedDays / rows.length : null, byProject,
        coverage: 'observed_project_business_days_only', message: rows.length ? '只统计已有收益来源的项目日期，未到资料不视为已核对' : '当前范围还没有收益来源，请先查看报表资料' };
    }
    const scope = scopedSql('w', scopes), today = todayInShanghai();
    const joins = 'FROM opc_withdrawals w LEFT JOIN opc_withdrawal_terms wt ON wt.withdrawal_id=w.id JOIN users u ON u.id=w.user_id';
    const totals = await queryRows(c, `SELECT w.status,COUNT(*) count,CAST(COALESCE(SUM(w.amount),0) AS CHAR) gross_amount,
      CAST(COALESCE(SUM(COALESCE(wt.net_amount,w.amount)),0) AS CHAR) net_amount,MIN(w.created_at) earliest
      ${joins} WHERE ${scope.sql} GROUP BY w.status`, scope.args);
    const [paid] = await queryRows(c, `SELECT COUNT(CASE WHEN w.paid_on=? THEN 1 END) today_count,
      CAST(COALESCE(SUM(CASE WHEN w.paid_on=? THEN COALESCE(wt.net_amount,w.amount) ELSE 0 END),0) AS CHAR) today_paid,
      CAST(COALESCE(SUM(CASE WHEN w.paid_on BETWEEN ? AND ? THEN COALESCE(wt.net_amount,w.amount) ELSE 0 END),0) AS CHAR) month_paid
      ${joins} WHERE ${scope.sql} AND w.status='paid'`, [today, today, today.slice(0, 8) + '01', today, ...scope.args]);
    if (name === 'today-payouts') {
      const rows = await queryRows(c, `SELECT CAST(w.id AS CHAR) id,CAST(w.user_id AS CHAR) member_id,u.display_name,CAST(w.project_id AS CHAR) project_id,CAST(w.account_id AS CHAR) account_id,w.module_id,w.pay_method,
        CAST(w.amount AS CHAR) gross_amount,CAST(COALESCE(wt.net_amount,w.amount) AS CHAR) net_amount,DATE_FORMAT(w.paid_on,'%Y-%m-%d') paid_on,w.paid_at
        ${joins} WHERE ${scope.sql} AND w.status='paid' AND w.paid_on=? ORDER BY w.paid_at DESC,w.id DESC LIMIT ? OFFSET ?`, [...scope.args, today, filter.pageSize, (filter.page - 1) * filter.pageSize]);
      return { ...insightContext({ ...filter, from: today, to: today }, scopes, 'actual_payment_date'), status: Number(paid.today_count) ? 'ready' : 'empty',
        count: Number(paid.today_count), totalAmount: amount(paid.today_paid), page: filter.page, pageSize: filter.pageSize,
        list: rows.map(r => ({ id: String(r.id), memberId: String(r.member_id), name: String(r.display_name), amount: amount(r.net_amount), grossAmount: amount(r.gross_amount), method: methods[r.pay_method] ?? '转账', status: '已登记发放', paidOn: r.paid_on, registeredAt: r.paid_at,
          detail: { path: '/finance', query: { projectId: String(r.project_id), accountId: String(r.account_id), moduleId: r.module_id, withdrawalId: String(r.id) } } })) };
    }
    const pending = totals.find(r => r.status === 'pending'), approved = totals.find(r => r.status === 'approved');
    const rows = await queryRows(c, `SELECT CAST(w.id AS CHAR) id,CAST(w.user_id AS CHAR) member_id,u.display_name,CAST(w.amount AS CHAR) amount,w.created_at,w.module_id,CAST(w.project_id AS CHAR) project_id,CAST(w.account_id AS CHAR) account_id
      ${joins} WHERE ${scope.sql} AND w.status='pending' ORDER BY w.created_at,w.id LIMIT ? OFFSET ?`, [...scope.args, filter.pageSize, (filter.page - 1) * filter.pageSize]);
    return { ...insightContext(filter, scopes, 'current_withdrawal_state_and_actual_payment_date'), status: scopes.length ? 'ready' : 'empty',
      totalAmount: amount(pending?.gross_amount), count: Number(pending?.count ?? 0), approvedAmount: amount(approved?.gross_amount), approvedCount: Number(approved?.count ?? 0),
      earliest: pending?.earliest ? new Date(pending.earliest).toISOString() : null, todayPaid: amount(paid.today_paid), monthPaid: amount(paid.month_paid),
      paymentPeriod: { today, monthFrom: today.slice(0, 8) + '01' }, failedCount: null, failedCountReason: '现有付款登记不记录支付通道失败，不能将退回申请当作发放失败',
      page: filter.page, pageSize: filter.pageSize, pendingDateBasis: 'all_application_dates_in_selected_projects',
      oldest: rows.map(r => ({ id: String(r.id), memberId: String(r.member_id), name: String(r.display_name), amount: amount(r.amount), createdAt: new Date(r.created_at).toISOString(), waiting: '提交于 ' + new Date(r.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
        detail: { path: '/finance', query: { projectId: String(r.project_id), accountId: String(r.account_id), moduleId: r.module_id, withdrawalId: String(r.id) } } })) };
  });
}
export function createFinanceOverviewRouter(runtime: ModuleRuntime) {
  const router = Router();
  for (const name of ['today-payouts', 'reconcile-progress', 'withdrawals/pending'] as const)
    router.get('/' + name, asyncHandler(async (req, res) => ok(res, await readFinanceOverview(runtime, req.user, name, req.query))));
  return router;
}
