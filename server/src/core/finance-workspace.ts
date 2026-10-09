import { Router } from 'express';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db';
import { isStaffRole } from '../auth/roles';
import { AppError, asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { assertDuty } from './duties';
import { assertDataScope } from './accounts';
import { serviceProjects } from './project-scopes';
import type { ModuleRuntime } from './module-runtime';
const id = z.string().regex(/^[1-9]\d*$/);

/** Shared finance navigation and confirmed income; no project-table reads. */
export function createFinanceWorkspaceRouter(runtime: ModuleRuntime) {
  const router = Router();
  router.use((req, _res, next) => {
    try {
      if (!isStaffRole(req.user.role)) throw new AppError(403, 40300, '这里需要财务权限');
      assertDuty(req.user, 'finance');
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const projects = await serviceProjects(runtime, req.user);
      ok(
        res,
        projects.flatMap((project) =>
          project.accounts.map((account) => ({
            projectId: project.id,
            projectName: project.name,
            accountId: account.id,
            accountName: account.name,
            moduleId: account.moduleId,
            available: !!runtime.get(account.moduleId),
          })),
        ),
      );
    }),
  );
  router.get(
    '/entries',
    asyncHandler(async (req, res) => {
      const scope = z
        .object({
          projectId: id,
          accountId: id,
          moduleId: z.string().min(1).max(64),
          from: z.string().date(),
          to: z.string().date(),
          page: z.coerce.number().int().min(1).max(100000).default(1),
        })
        .strict()
        .parse(req.query);
      if (scope.from > scope.to) throw new AppError(422, 42200, '开始日期不能晚于结束日期');
      const module = runtime.get(scope.moduleId);
      if (!module || !module.manifest.roles.includes(req.user.role)) throw new AppError(404, 40400, '项目暂不可用');
      await assertDataScope(req.user, scope.projectId, scope.accountId, scope.moduleId);
      ok(
        res,
        await withTransaction(async (c) => {
          const args = [scope.moduleId, scope.projectId, scope.accountId, scope.from, scope.to];
          const where = 's.module_id=? AND s.project_id=? AND s.account_id=? AND s.business_date BETWEEN ? AND ?';
          const [list] = await c.query<RowDataPacket[]>(
            `SELECT CONCAT(s.id,':',e.user_id) id,
        s.description task_name,DATE_FORMAT(s.business_date,'%Y-%m-%d') business_date,
        u.display_name payee_name,CAST(e.user_id AS CHAR) payee_id,
        CAST(SUM(e.amount) AS CHAR) amount,MAX(e.confirmed_at) confirmed_at,
        es.metric_label,es.quantity_unit,CAST(MAX(l.quantity) AS CHAR) quantity,
        CAST(MAX(l.unit_price) AS CHAR) unit_price,
        COALESCE(s.blocked_reason,'') reason
        FROM opc_income_sources s JOIN opc_income_entries e ON e.source_id=s.id JOIN users u ON u.id=e.user_id
        LEFT JOIN opc_earning_sources es ON es.module_id=s.module_id AND es.project_id=s.project_id AND es.account_id=s.account_id AND es.source_key=s.source_key
        LEFT JOIN opc_earning_lines l ON l.source_id=es.id AND l.source_version=s.source_version AND l.payee_id=e.user_id
        WHERE ${where} GROUP BY s.id,e.user_id,s.description,s.business_date,u.display_name,es.metric_label,es.quantity_unit,s.blocked_reason
        ORDER BY s.business_date DESC,s.id DESC,e.user_id LIMIT 25 OFFSET ?`,
            [...args, (scope.page - 1) * 25],
          );
          const [[summary]] = await c.query<RowDataPacket[]>(
            `SELECT COUNT(DISTINCT s.id,e.user_id) records,
        CAST(COALESCE(SUM(e.amount),0) AS CHAR) amount FROM opc_income_sources s JOIN opc_income_entries e ON e.source_id=s.id WHERE ${where}`,
            args,
          );
          return { list, total: Number(summary.records), amount: String(summary.amount), page: scope.page };
        }),
      );
    }),
  );
  return router;
}
