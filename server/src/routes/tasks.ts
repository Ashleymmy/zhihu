import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateQuery } from '../middleware/validate';
import { getTask, listTasks, requestTaskSync } from '../services/catalog.service';
import { paginationSchema } from '../utils/pagination';
import { ok, okList } from '../utils/response';
const id = z.string().min(1).max(32);
const list = paginationSchema.extend({ status: z.string().optional(), keyword: z.string().optional() });
const syncQuery = z.object({ channelId: z.string().regex(/^\d+$/).max(32).optional() });
export const tasksRouter = Router();
tasksRouter.use(requireAuth);
tasksRouter.get(
  '/',
  validateQuery(list),
  asyncHandler(async (req, res) => {
    const data = await listTasks(req.query);
    okList(res, data.list, data.total, data.page, data.pageSize);
  }),
);
tasksRouter.post(
  '/sync',
  requirePermission('catalog.sync'),
  validateQuery(syncQuery),
  asyncHandler(async (req, res) =>
    ok(res, await requestTaskSync(req.user, req.query.channelId as string | undefined), 202),
  ),
);
tasksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => ok(res, await getTask(id.parse(req.params.id)))),
);
