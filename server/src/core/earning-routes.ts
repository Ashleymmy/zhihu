import { Router } from 'express';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db';
import { AppError, asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { isStaffRole } from '../auth/roles';
import { assertDuty } from './duties';
import { assertProjectMembership } from '../services/projectMembers.service';
import type { ModuleRuntime } from './module-runtime';
import type { AuthUser } from '../types';
import { cash, cashText } from './money';

const id = z.string().regex(/^[1-9]\d*$/);
const day = z.string().date();
const filter = z
  .object({
    projectId: id.optional(),
    accountId: id.optional(),
    from: day,
    to: day,
    metricType: z.string().max(32).optional(),
    group: z.enum(['self', 'team']).optional(),
    search: z.string().trim().max(128).default(''),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
function access(user: AuthUser) {
  if (isStaffRole(user.role)) assertDuty(user, 'finance');
}
function scopeWhere(user: AuthUser, runtime: ModuleRuntime) {
  const modules = runtime
    .all()
    .filter((m) => m.manifest.roles.includes(user.role))
    .map((m) => m.manifest.id);
  return {
    sql: `p.is_enabled=1 AND a.status='active' AND a.module_id IN (?) AND (?=1 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=? AND pm.left_at IS NULL))`,
    args: [modules.length ? modules : [''], Number(isStaffRole(user.role)), user.sub],
  };
}
const joins = `FROM opc_earning_lines l JOIN opc_earning_sources s ON s.id=l.source_id
  JOIN projects p ON p.id=s.project_id JOIN integration_accounts a ON a.id=s.account_id AND a.module_id=s.module_id
  JOIN project_integrations pi ON pi.project_id=s.project_id AND pi.account_id=s.account_id`;
const cashJoins = `LEFT JOIN opc_income_sources inc ON inc.module_id=s.module_id AND inc.account_id=s.account_id AND inc.project_id=s.project_id AND inc.source_key=s.source_key
  LEFT JOIN (SELECT source_id,user_id,SUM(amount) confirmed FROM opc_income_entries WHERE user_id=? GROUP BY source_id,user_id) paid ON paid.source_id=inc.id AND paid.user_id=l.payee_id`;
export function createEarningRouter(runtime: ModuleRuntime) {
  const router = Router();
  router.use((req, _res, next) => {
    try {
      access(req.user);
      next();
    } catch (e) {
      next(e);
    }
  });
  router.get(
    '/mine',
    asyncHandler(async (req, res) => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
      const f = filter.parse({ from: today.slice(0, 8) + '01', to: today, ...req.query });
      if (f.from > f.to) throw new AppError(422, 42200, '开始日期不能晚于结束日期');
      if (f.accountId && !f.projectId) throw new AppError(422, 42200, '请先选择项目');
      if (f.projectId) await assertProjectMembership(req.user, f.projectId);
      const scope = scopeWhere(req.user, runtime);
      ok(
        res,
        await withTransaction(async (c) => {
          const [scopes] = await c.query<RowDataPacket[]>(
            `SELECT CAST(p.id AS CHAR) project_id,p.name project_name,a.module_id,CAST(a.id AS CHAR) account_id FROM projects p JOIN project_integrations pi ON pi.project_id=p.id JOIN integration_accounts a ON a.id=pi.account_id WHERE ${scope.sql} ORDER BY p.id,a.id`,
            scope.args,
          );
          if (
            f.projectId &&
            !scopes.some((s) => s.project_id === f.projectId && (!f.accountId || s.account_id === f.accountId))
          )
            throw new AppError(403, 40300, '这个项目暂不可查看');
          const where = `l.payee_id=? AND l.source_version=s.current_version AND ${scope.sql} AND s.business_date BETWEEN ? AND ?
        ${f.projectId ? 'AND s.project_id=?' : ''} ${f.accountId ? 'AND s.account_id=?' : ''} ${f.metricType ? 'AND s.metric_type=?' : ''}
        ${f.group === 'team' ? 'AND l.performer_id<>l.payee_id' : f.group === 'self' ? 'AND (l.performer_id=l.payee_id OR l.performer_id IS NULL)' : ''}
        ${f.search ? 'AND (s.task_name LIKE ? OR l.performer_name LIKE ?)' : ''}`;
          const args = [
            req.user.sub,
            ...scope.args,
            f.from,
            f.to,
            ...(f.projectId ? [f.projectId] : []),
            ...(f.accountId ? [f.accountId] : []),
            ...(f.metricType ? [f.metricType] : []),
            ...(f.search ? ['%' + f.search + '%', '%' + f.search + '%'] : []),
          ];
          const [list] = await c.query<RowDataPacket[]>(
            `SELECT CAST(l.id AS CHAR) id,s.module_id,CAST(s.project_id AS CHAR) project_id,p.name project_name,CAST(s.account_id AS CHAR) account_id,s.task_id,s.task_name,DATE_FORMAT(s.business_date,'%Y-%m-%d') business_date,s.metric_type,s.metric_label,s.quantity_unit,
        CAST(l.performer_id AS CHAR) performer_id,l.performer_name,l.rule_code,CAST(l.quantity AS CHAR) quantity,CAST(l.unit_price AS CHAR) unit_price,CAST(l.quantity*l.unit_price AS CHAR) calculation_amount,CAST(l.amount AS CHAR) amount,l.is_internal,IF(COALESCE(s.blocked_reason,inc.blocked_reason,'')='',l.is_ready,0) is_ready,l.confirmed_at,
        COALESCE(s.blocked_reason,inc.blocked_reason,NULLIF(l.blocked_reason,''),'') reason,l.next_action,
        CAST(COALESCE(paid.confirmed,0) AS CHAR) confirmed_amount,CAST(l.amount-COALESCE(paid.confirmed,0) AS CHAR) pending_amount,
        IF(l.performer_id<>l.payee_id,'team','self') earning_group
        ${joins} ${cashJoins} WHERE ${where} ORDER BY s.business_date DESC,l.id DESC LIMIT ? OFFSET ?`,
            [req.user.sub, ...args, f.pageSize, (f.page - 1) * f.pageSize],
          );
          const [groups] = await c.query<RowDataPacket[]>(
            `SELECT CAST(s.project_id AS CHAR) project_id,p.name project_name,s.metric_type,s.metric_label,s.quantity_unit,
        COUNT(*) records,SUM(l.amount IS NULL) pending_calculations,CAST(COALESCE(SUM(l.quantity),0) AS CHAR) quantity,
        CAST(COALESCE(SUM(IF(l.is_internal=0,l.amount,0)),0) AS CHAR) amount,
        CAST(COALESCE(SUM(IF(l.is_internal=0,paid.confirmed,0)),0) AS CHAR) confirmed_amount,
        CAST(COALESCE(SUM(IF(l.is_internal=1,l.amount,0)),0) AS CHAR) internal_amount
        ${joins} ${cashJoins} WHERE ${where} GROUP BY s.project_id,p.name,s.metric_type,s.metric_label,s.quantity_unit ORDER BY s.project_id,s.metric_type`,
            [req.user.sub, ...args],
          );
          const sum = (field: string) => cashText(groups.reduce((n, g) => n + cash(String(g[field]), true), 0n));
          return {
            scopes,
            list,
            groups,
            total: groups.reduce((n, g) => n + Number(g.records), 0),
            page: f.page,
            pageSize: f.pageSize,
            summary: {
              amount: sum('amount'),
              confirmedAmount: sum('confirmed_amount'),
              pendingAmount: cashText(cash(sum('amount'), true) - cash(sum('confirmed_amount'), true)),
              internalAmount: sum('internal_amount'),
              pendingCalculations: groups.reduce((n, g) => n + Number(g.pending_calculations), 0),
            },
          };
        }),
      );
    }),
  );
  router.get(
    '/:id/history',
    asyncHandler(async (req, res) => {
      const lineId = id.parse(req.params.id),
        scope = scopeWhere(req.user, runtime);
      const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
      ok(
        res,
        await withTransaction(async (c) => {
          const [[line]] = await c.query<RowDataPacket[]>(
            `SELECT s.* ${joins} WHERE l.id=? AND l.payee_id=? AND ${scope.sql}`,
            [lineId, req.user.sub, ...scope.args],
          );
          if (!line) throw new AppError(404, 40400, '这条收益记录不可查看');
          const args = [line.module_id, line.project_id, line.account_id, line.source_key, req.user.sub];
          const base = `FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.module_id=? AND s.project_id=? AND s.account_id=? AND s.source_key=? AND e.user_id=?`;
          const [list] = await c.query<RowDataPacket[]>(
            `SELECT e.source_version,CAST(SUM(e.amount) AS CHAR) amount,CAST(MAX(e.target_amount) AS CHAR) target_amount,MIN(e.confirmed_at) confirmed_at ${base} GROUP BY e.source_version ORDER BY MIN(e.id) DESC LIMIT 25 OFFSET ?`,
            [...args, (page - 1) * 25],
          );
          const [[count]] = await c.query<RowDataPacket[]>(
            `SELECT COUNT(DISTINCT e.source_version) total ${base}`,
            args,
          );
          return { list, total: Number(count.total), page };
        }),
      );
    }),
  );
  return router;
}
