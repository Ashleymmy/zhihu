import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { assertDataScope } from './accounts';
import type { ModuleRuntime } from './module-runtime';
const id = z.string().regex(/^[1-9]\d*$/);
const query = z.object({
  projectId: id, accountId: id, moduleId: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  from: z.string().date(), to: z.string().date(), view: z.enum(['self', 'team', 'all']).default('self'),
  ownerId: id.optional(), metricType: z.string().min(1).max(32).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export function createActivityRouter(runtime: ModuleRuntime) {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    const q = query.parse(req.query);
    if (q.from > q.to) throw new AppError(422, 42200, '开始日期不能晚于结束日期');
    await assertDataScope(req.user, q.projectId, q.accountId, q.moduleId);
    const module = runtime.get(q.moduleId);
    if (!module || !module.manifest.roles.includes(req.user.role)) throw new AppError(404, 40400, '项目暂不可用');
    if (!module.dataProvider?.activity) throw new AppError(404, 40400, '该项目暂未提供业绩明细');
    ok(res, await module.dataProvider.activity(q, req.user, q));
  }));
  return router;
}
