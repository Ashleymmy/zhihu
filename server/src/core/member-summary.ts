import { Router } from 'express';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import type { AuthUser } from '../types';
import { withTransaction } from '../db';
import { AppError, asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import type { AmountPeriods, TeamTurnover } from './contracts';
import type { ModuleRuntime } from './module-runtime';
import { cash, cashText } from './money';

const periods = ['total', 'today', 'yesterday'] as const;
const zero = (): AmountPeriods => ({ total: '0.0000', today: '0.0000', yesterday: '0.0000' });
function add(target: AmountPeriods, source: AmountPeriods) {
  for (const key of periods) target[key] = cashText(cash(target[key], true) + cash(source[key], true));
}
export async function memberSummary(runtime: ModuleRuntime, user: AuthUser) {
  if (!['leader', 'creator'].includes(user.role)) throw new AppError(403, 40300, '请使用团长或达人账号查看收益');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  const modules = runtime
    .all()
    .filter((m) => m.manifest.roles.includes(user.role))
    .map((m) => m.manifest.id);
  return withTransaction(async (c) => {
    const scopeWhere = `p.is_enabled=1 AND a.status='active' AND a.module_id IN (?)
      AND EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=? AND pm.left_at IS NULL)`;
    const scopeArgs = [modules.length ? modules : [''], user.sub];
    // Sum ledger deltas first. Joining every historical projection would multiply
    // income; the latest confirmed projection classifies the net confirmed sum.
    const [rows] = await c.query<RowDataPacket[]>(
      `
      SELECT IF(l.performer_id=l.payee_id OR l.performer_id IS NULL,'direct','team') kind,
        CAST(SUM(paid.amount) AS CHAR) total,
        CAST(SUM(IF(s.business_date=?,paid.amount,0)) AS CHAR) today,
        CAST(SUM(IF(s.business_date=?,paid.amount,0)) AS CHAR) yesterday
      FROM (SELECT source_id,SUM(amount) amount FROM opc_income_entries WHERE user_id=? GROUP BY source_id) paid
      JOIN opc_income_sources s ON s.id=paid.source_id
      JOIN projects p ON p.id=s.project_id
      JOIN integration_accounts a ON a.id=s.account_id AND a.module_id=s.module_id
      JOIN project_integrations pi ON pi.project_id=s.project_id AND pi.account_id=s.account_id
      JOIN opc_earning_sources es ON es.module_id=s.module_id AND es.project_id=s.project_id
        AND es.account_id=s.account_id AND es.source_key=s.source_key
      JOIN opc_earning_lines l ON l.id=(SELECT latest.id FROM opc_earning_lines latest
        WHERE latest.source_id=es.id AND latest.payee_id=? AND latest.confirmed_at IS NOT NULL
        ORDER BY latest.confirmed_at DESC,latest.id DESC LIMIT 1)
      WHERE ${scopeWhere} AND s.business_date<=? AND l.is_internal=0
      GROUP BY kind`,
      [today, yesterday, user.sub, user.sub, ...scopeArgs, today],
    );
    const direct = zero(),
      reward = zero();
    for (const row of rows) {
      const amounts = { total: String(row.total), today: String(row.today), yesterday: String(row.yesterday) };
      add(row.kind === 'direct' ? direct : reward, amounts);
    }
    if (user.role !== 'leader') return { businessDate: today, direct, team: null };
    const [[count]] = await c.query<RowDataPacket[]>(
      "SELECT COUNT(*) total FROM users WHERE parent_id=? AND role='creator' AND is_active=1",
      [user.sub],
    );
    const [scopes] = await c.query<RowDataPacket[]>(
      `SELECT CAST(p.id AS CHAR) project_id,CAST(a.id AS CHAR) account_id,a.module_id
      FROM projects p JOIN project_integrations pi ON pi.project_id=p.id JOIN integration_accounts a ON a.id=pi.account_id
      WHERE ${scopeWhere}`,
      scopeArgs,
    );
    const turnover: TeamTurnover = {
      ...zero(),
      missing: { total: 0, today: 0, yesterday: 0 },
      records: { total: 0, today: 0, yesterday: 0 },
    };
    let unavailable = false;
    for (const scope of scopes) {
      const provider = runtime.get(String(scope.module_id))?.dataProvider?.teamTurnover;
      if (!provider) {
        unavailable = true;
        continue;
      }
      const value = await provider(
        c,
        { projectId: String(scope.project_id), accountId: String(scope.account_id), from: '1000-01-01', to: today },
        user,
      );
      add(turnover, value);
      for (const key of periods) {
        turnover.missing[key] += value.missing[key];
        turnover.records[key] += value.records[key];
      }
    }
    return {
      businessDate: today,
      direct,
      team: { memberCount: Number(count.total), reward, turnover: unavailable ? null : turnover },
    };
  });
}
export function createMemberSummaryRouter(runtime: ModuleRuntime) {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      z.object({}).strict().parse(req.query);
      ok(res, await memberSummary(runtime, req.user));
    }),
  );
  return router;
}
