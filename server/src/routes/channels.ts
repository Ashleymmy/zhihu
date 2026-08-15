import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody, validateQuery } from '../middleware/validate';
import { assignChannel, listChannels, requestChannelSync } from '../services/catalog.service';
import { paginationSchema } from '../utils/pagination';
import { ok, okList } from '../utils/response';
const id = z.string().regex(/^\d+$/);
export const channelsRouter = Router();
channelsRouter.use(requireAuth);
channelsRouter.get(
  '/',
  validateQuery(paginationSchema),
  asyncHandler(async (req, res) => {
    const data = await listChannels(req.user, req.query);
    okList(res, data.list, data.total, data.page, data.pageSize);
  }),
);
channelsRouter.post(
  '/sync',
  requirePermission('project.manage'),
  asyncHandler(async (req, res) => ok(res, await requestChannelSync(req.user), 202)),
);
channelsRouter.patch(
  '/:id/owner',
  requirePermission('project.manage'),
  validateBody(z.object({ ownerId: id.nullable() })),
  asyncHandler(async (req, res) =>
    ok(res, await assignChannel(req.user, id.parse(req.params.id), req.body.ownerId, req.ip)),
  ),
);
