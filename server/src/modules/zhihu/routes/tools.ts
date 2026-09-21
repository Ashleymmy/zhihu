import { siteInfo } from '../services/site-info';
import { requireOfficialPlanRead } from '../zhihu/planReadCapability';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../auth/middleware';
import { requirePermission } from '../permissions';
import { asyncHandler } from '../../../middleware/errors';
import { validateBody } from '../../../middleware/validate';
import { ok } from '../../../utils/response';
import { enqueue } from '../queue';
export const toolsRouter = Router();
toolsRouter.use(requireAuth, requirePermission('project.manage'));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const settleInput = z.object({ from: dateStr.optional(), to: dateStr.optional(), settleDate: dateStr.optional() });
toolsRouter.post(
  '/settle-earnings',
  validateBody(settleInput),
  asyncHandler(async (req, res) => {
    const jobId = `settle-manual-${Date.now()}`;
    await enqueue(
      'settle-earnings',
      { source: 'manual', from: req.body.from ?? req.body.settleDate, to: req.body.to ?? req.body.settleDate },
      { jobId },
    );
    ok(res, { jobId, message: '收益结算任务已加入队列' }, 202);
  }),
);
toolsRouter.post(
  '/sync-plan-status',
  asyncHandler(async () => {
    requireOfficialPlanRead();
  }),
);
toolsRouter.post(
  '/sync-composition-status',
  asyncHandler(async (_req, res) => {
    const jobId = `sync-composition-status-manual-${Date.now()}`;
    await enqueue('sync-composition-status', { source: 'manual' }, { jobId });
    ok(res, { jobId, message: '作品审核状态同步任务已加入队列' }, 202);
  }),
);

toolsRouter.get(
  '/site-info',
  asyncHandler(async (_req, res) => ok(res, await siteInfo())),
);
