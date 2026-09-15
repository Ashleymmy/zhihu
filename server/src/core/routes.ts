import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler, AppError } from '../middleware/errors';
import { ok } from '../utils/response';
import { ModuleRuntime } from './module-runtime';
import { financeRouter } from './finance-routes';
import { staffRouter } from './staff';
import {
  listAccounts,
  createAccount,
  setAccountStatus,
  linkAccount,
  projectAccounts,
  assertDataScope,
} from './accounts';
import type { ModuleSummary } from './contracts';
const id = z.string().regex(/^[1-9][0-9]*$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
export function createPlatformRouter(runtime: ModuleRuntime) {
  const r = Router();
  r.use(requireAuth);
  r.get(
    '/modules',
    asyncHandler(async (req, res) => ok(res, runtime.list(req.user.role))),
  );
  r.use('/finance',financeRouter);
  r.use('/staff',staffRouter);
  r.get(
    '/integrations',
    asyncHandler(async (req, res) => ok(res, await listAccounts(req.user))),
  );
  r.post(
    '/integrations',
    requirePermission('module.manage'),
    asyncHandler(async (req, res) => {
      const input = z
        .object({
          moduleId: z.string(),
          accountKey: z.string().trim().min(1).max(128),
          name: z.string().trim().min(1).max(128),
        })
        .parse(req.body);
      const module = runtime.get(input.moduleId);
      if (!module) throw new AppError(422, 42201, '请先启用对应模块');
      if (module.manifest.accountCreation === 'managed')
        throw new AppError(422, 42202, module.manifest.accountMessage ?? '该模块由部署流程配置接入账号');
      ok(res, await createAccount(req.user, input), 201);
    }),
  );
  r.patch(
    '/integrations/:id',
    requirePermission('module.manage'),
    asyncHandler(async (req, res) => {
      await setAccountStatus(req.user, id.parse(req.params.id), z.enum(['active', 'disabled']).parse(req.body.status));
      ok(res, null);
    }),
  );
  r.get(
    '/projects/:projectId/integrations',
    asyncHandler(async (req, res) => ok(res, await projectAccounts(req.user, id.parse(req.params.projectId)))),
  );
  r.post(
    '/projects/:projectId/integrations',
    requirePermission('project.manage'),
    asyncHandler(async (req, res) => {
      await linkAccount(req.user, id.parse(req.params.projectId), id.parse(req.body.accountId));
      ok(res, null, 201);
    }),
  );
  r.delete(
    '/projects/:projectId/integrations/:accountId',
    requirePermission('project.manage'),
    asyncHandler(async (req, res) => {
      await linkAccount(req.user, id.parse(req.params.projectId), id.parse(req.params.accountId), true);
      ok(res, null);
    }),
  );
  r.get(
    '/modules/:moduleId/summary',
    asyncHandler(async (req, res) => {
      const moduleId = z.string().parse(req.params.moduleId);
      const module = runtime.get(moduleId);
      if (!module || !module.manifest.roles.includes(req.user.role)) throw new AppError(404, 40401, '模块不可用');
      const scope = z.object({ projectId: id, accountId: id, from: date, to: date }).parse(req.query);
      if (scope.from > scope.to) throw new AppError(422, 42200, '起始日期不能晚于结束日期');
      await assertDataScope(req.user, scope.projectId, scope.accountId, moduleId);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: ModuleSummary;
      try {
        if (!module.dataProvider) throw new Error('not_connected');
        result = await Promise.race([
          module.dataProvider.summary(scope, req.user),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), 5000);
          }),
        ]);
        if (
          result.moduleId !== moduleId ||
          result.accountId !== scope.accountId ||
          result.projectId !== scope.projectId ||
          result.from !== scope.from ||
          result.to !== scope.to
        )
          throw new Error('scope_mismatch');
      } catch {
        result = { ...scope, moduleId, status: 'unavailable', updatedAt: new Date().toISOString(), metrics: [] };
      } finally {
        if (timer) clearTimeout(timer);
      }
      ok(res, result);
    }),
  );
  return r;
}
