import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateQuery } from '../middleware/validate';
import { byKeyword, byMember, overview, requestSync, trend } from '../services/metrics.service';
import { paginationSchema } from '../utils/pagination';
import { ok, okList } from '../utils/response';

const range = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  granularity: z.literal('day').default('day'),
});
const keyword = paginationSchema
  .merge(range)
  .extend({
    sort: z.enum(['earning', 'impressions', 'clicks', 'conversions']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
  });
export const metricsRouter = Router();
metricsRouter.use(requireAuth);
metricsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => ok(res, await overview(req.user))),
);
metricsRouter.get(
  '/trend',
  validateQuery(range),
  asyncHandler(async (req, res) => ok(res, await trend(req.user, req.query))),
);
metricsRouter.get(
  '/by-keyword',
  validateQuery(keyword),
  asyncHandler(async (req, res) => {
    const data = await byKeyword(req.user, req.query);
    okList(res, data.list, data.total, data.page, data.pageSize);
  }),
);
metricsRouter.get(
  '/by-member',
  requirePermission('earning.view_team'),
  validateQuery(range),
  asyncHandler(async (req, res) => ok(res, await byMember(req.user, req.query))),
);
metricsRouter.post(
  '/sync',
  requirePermission('project.manage'),
  asyncHandler(async (req, res) => ok(res, await requestSync(req.user), 202)),
);
