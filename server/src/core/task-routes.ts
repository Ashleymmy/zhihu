import { Router } from 'express';
import { z } from 'zod';
import type { ModuleRuntime } from './module-runtime';
import { assertDataScope } from './accounts';
import { listProjects, assertProjectMembership } from '../services/projectMembers.service';
import { serviceProjects } from './project-scopes';
import { isStaffRole } from '../auth/roles';
import { dutyAllows } from './duties';
import { AppError, asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { logger } from '../utils/logger';
import type { AuthUser } from '../types';
const id = z.string().regex(/^\d+$/);
const query = z.object({
  projectId: id.optional(),
  accountId: id.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(128).default(''),
  view: z.enum(['all', 'available', 'owned']).optional(),
  attention: z.enum(['assignment', 'review', 'work', 'disputed']).optional(),
});
function taskAccess(user: AuthUser) {
  if (isStaffRole(user.role) && !dutyAllows(user, 'operations')) throw new AppError(403, 40301, '这里需要运营权限');
}
export function createTaskRouter(runtime: ModuleRuntime) {
  const router = Router();
  router.use((req, _res, next) => {
    try {
      taskAccess(req.user);
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const filter = query.parse(req.query);
      if (filter.accountId && !filter.projectId) throw new AppError(422, 42200, '请选择项目后查看任务');
      if (filter.projectId) await assertProjectMembership(req.user, filter.projectId);
      const projects = await serviceProjects(runtime, req.user);
      if (filter.projectId && !projects.some((p) => p.id === filter.projectId))
        throw new AppError(404, 40401, '项目暂不可用');
      const groups = [];
      for (const project of projects.filter((p) => !filter.projectId || p.id === filter.projectId)) {
        const accounts = project.accounts.filter(
          (a) => a.status === 'active' && (!filter.accountId || a.id === filter.accountId),
        );
        if (filter.accountId && !accounts.length) throw new AppError(403, 40301, '该项目的数据来源不可用');
        for (const account of accounts) {
          const module = runtime.get(account.moduleId);
          if (module && !module.manifest.roles.includes(req.user.role)) continue;
          if (module && !module.taskProvider) {
            groups.push({
              projectId: project.id,
              projectName: project.name,
              moduleId: account.moduleId,
              accountId: account.id,
              page: filter.page,
              pageSize: filter.pageSize,
              list: [],
              total: null,
              status: 'unsupported',
            });
            continue;
          }
          await assertDataScope(req.user, project.id, account.id, account.moduleId);
          const base = {
            projectId: project.id,
            projectName: project.name,
            moduleId: account.moduleId,
            accountId: account.id,
            page: filter.page,
            pageSize: filter.pageSize,
          };
          if (!module?.taskProvider) {
            groups.push({ ...base, list: [], total: null, status: 'unavailable' });
            continue;
          }
          try {
            const result = await module.taskProvider.list({ projectId: project.id, accountId: account.id }, req.user, {
              ...filter,
              view: filter.view ?? (isStaffRole(req.user.role) ? 'all' : 'owned'),
            });
            groups.push({ ...base, ...result, status: 'ready' });
          } catch (error) {
            logger.warn({ err: error, moduleId: account.moduleId, projectId: project.id }, 'Task provider unavailable');
            groups.push({ ...base, list: [], total: null, status: 'unavailable' });
          }
        }
      }
      ok(res, { projects: projects.map(({ id, name }) => ({ id, name })), groups });
    }),
  );
  const params = z.object({
    moduleId: z.string().regex(/^[a-z0-9-]+$/),
    accountId: id,
    taskId: z.string().min(1).max(128),
  });
  async function provider(user: AuthUser, projectId: string, moduleId: string, accountId: string) {
    if (!(await listProjects(user)).some((p) => p.id === projectId && p.isEnabled))
      throw new AppError(403, 40301, '该项目暂不可访问');
    await assertDataScope(user, projectId, accountId, moduleId);
    const module = runtime.get(moduleId);
    if (!module?.taskProvider || !module.manifest.roles.includes(user.role))
      throw new AppError(404, 40401, '任务功能暂不可用');
    return module.taskProvider;
  }
  router.get(
    '/:moduleId/:accountId/:taskId',
    asyncHandler(async (req, res) => {
      const p = params.parse(req.params),
        scope = { projectId: id.parse(req.query.projectId), accountId: p.accountId };
      const tasks = await provider(req.user, scope.projectId, p.moduleId, p.accountId);
      ok(res, await tasks.detail(scope, req.user, p.taskId));
    }),
  );
  router.post(
    '/:moduleId/:accountId/:taskId/actions/:action',
    asyncHandler(async (req, res) => {
      const p = params.extend({ action: z.string().regex(/^[a-z0-9-]+$/) }).parse(req.params);
      const body = z
        .object({
          projectId: id,
          requestKey: z.string().regex(/^[\w.-]{8,128}$/),
          input: z.record(z.unknown()).default({}),
        })
        .strict()
        .parse(req.body);
      const scope = { projectId: body.projectId, accountId: p.accountId },
        tasks = await provider(req.user, scope.projectId, p.moduleId, p.accountId);
      ok(res, await tasks.execute(scope, req.user, p.taskId, p.action, body.input, body.requestKey));
    }),
  );
  return router;
}
