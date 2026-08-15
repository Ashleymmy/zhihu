import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody, validateQuery } from '../middleware/validate';
import {
  createRule,
  deleteRule,
  getSecret,
  listLogs,
  listRules,
  rotateSecret,
  updateRule,
} from '../services/callbacks.service';
import { paginationSchema } from '../utils/pagination';
import { ok, okList } from '../utils/response';

const id = z.string().regex(/^\d+$/);
const rule = z.object({
  planId: id,
  callbackUrl: z.string().url().max(1024),
  events: z.array(z.string().min(1).max(64)).min(1),
  status: z.enum(['active', 'inactive']).optional(),
});

export const callbacksRouter = Router();
callbacksRouter.use(requireAuth);
callbacksRouter.get(
  '/rules',
  validateQuery(paginationSchema),
  asyncHandler(async (req, res) => {
    const data = await listRules(req.user, req.query);
    okList(res, data.list, data.total, data.page, data.pageSize);
  }),
);
callbacksRouter.post(
  '/rules',
  requirePermission('callback.config'),
  validateBody(rule),
  asyncHandler(async (req, res) => ok(res, await createRule(req.user, req.body, req.ip), 201)),
);
callbacksRouter.patch(
  '/rules/:id',
  requirePermission('callback.config'),
  validateBody(rule.omit({ planId: true }).partial()),
  asyncHandler(async (req, res) => ok(res, await updateRule(req.user, id.parse(req.params.id), req.body, req.ip))),
);
callbacksRouter.delete(
  '/rules/:id',
  requirePermission('callback.config'),
  asyncHandler(async (req, res) => {
    await deleteRule(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);
callbacksRouter.get(
  '/secret',
  requirePermission('callback.secret'),
  asyncHandler(async (_req, res) => ok(res, await getSecret())),
);
callbacksRouter.post(
  '/secret/rotate',
  requirePermission('callback.secret'),
  asyncHandler(async (req, res) => ok(res, await rotateSecret(req.user, req.ip))),
);
callbacksRouter.get(
  '/logs',
  validateQuery(
    paginationSchema.extend({
      status: z.enum(['success', 'failed', 'retry']).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const data = await listLogs(req.user, req.query);
    okList(res, data.list, data.total, data.page, data.pageSize);
  }),
);
