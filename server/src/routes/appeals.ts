import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { sensitiveWriteLimit } from '../middleware/apiRateLimit';
import { asyncHandler } from '../middleware/errors';
import { validateBody, validateQuery } from '../middleware/validate';
import {
  cancelAppeal,
  decideAppeal,
  listAppeals,
  reviewAppeal,
  submitAppeal,
} from '../services/finance-approvals.service';
import { paginationSchema } from '../utils/pagination';
import { ok, okList } from '../utils/response';

const id = z.string().regex(/^\d+$/);
const list = paginationSchema.extend({
  status: z.enum(['pending', 'leader_approved', 'approved', 'rejected', 'cancelled']).optional(),
});
const create = z.object({
  kind: z.enum(['补款', '扣款', '结算异议', '其他']),
  title: z.string().trim().min(1).max(128),
  content: z.string().trim().min(1).max(2000),
  evidence: z.string().trim().max(2000).nullable().optional(),
});
const review = z.object({
  action: z.enum(['approve', 'reject']),
  remark: z.string().trim().max(512).nullable().optional(),
});
const decide = review.extend({
  adjustAmount: z.number().int().min(-100000000).max(100000000).nullable().optional(),
});

export const appealsRouter = Router();
appealsRouter.use(requireAuth);

appealsRouter.get(
  '/',
  validateQuery(list),
  asyncHandler(async (req, res) => {
    const data = await listAppeals(req.user, req.query);
    okList(res, data.list, data.total, data.page, data.pageSize);
  }),
);

/** 成员提交财务申诉 */
appealsRouter.post(
  '/',
  sensitiveWriteLimit,
  validateBody(create),
  asyncHandler(async (req, res) => ok(res, await submitAppeal(req.user, req.body, req.ip), 201)),
);

appealsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    await cancelAppeal(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);

appealsRouter.post(
  '/:id/review',
  sensitiveWriteLimit,
  requirePermission('withdraw.review'),
  validateBody(review),
  asyncHandler(async (req, res) => {
    await reviewAppeal(req.user, id.parse(req.params.id), req.body.action, req.body.remark ?? null, req.ip);
    ok(res, null);
  }),
);

appealsRouter.post(
  '/:id/decide',
  sensitiveWriteLimit,
  requirePermission('withdraw.approve'),
  validateBody(decide),
  asyncHandler(async (req, res) => {
    await decideAppeal(req.user, id.parse(req.params.id), req.body.action, req.body.remark ?? null, req.body.adjustAmount ?? null, req.ip);
    ok(res, null);
  }),
);
