import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { blockLegacyWithdrawalWrites } from '../middleware/financeGate';
import { validateBody, validateQuery } from '../middleware/validate';
import { approveWithdrawal, createWithdrawal, listWithdrawals, rejectWithdrawal } from '../services/earnings.service';
import { paginationSchema } from '../utils/pagination';
import { ok, okList } from '../utils/response';
const id = z.string().regex(/^\d+$/);
const list = paginationSchema.extend({ status: z.enum(['pending', 'approved', 'rejected']).optional() });
const create = z.object({
  amount: z.number().positive(),
  payMethod: z.enum(['alipay', 'wechat']),
  payAccount: z.string().min(1).max(128),
});
export const withdrawalsRouter = Router();
withdrawalsRouter.use(requireAuth);
withdrawalsRouter.get(
  '/',
  validateQuery(list),
  asyncHandler(async (req, res) => {
    const data = await listWithdrawals(req.user, req.query);
    okList(res, data.list, data.total, data.page, data.pageSize);
  }),
);
withdrawalsRouter.post(
  '/',
  requirePermission('withdraw.apply'),
  blockLegacyWithdrawalWrites,
  validateBody(create),
  asyncHandler(async (req, res) => ok(res, await createWithdrawal(req.user, req.body, req.ip), 201)),
);
withdrawalsRouter.post(
  '/:id/approve',
  requirePermission('withdraw.approve'),
  blockLegacyWithdrawalWrites,
  asyncHandler(async (req, res) => ok(res, await approveWithdrawal(req.user, id.parse(req.params.id), req.ip))),
);
withdrawalsRouter.post(
  '/:id/reject',
  requirePermission('withdraw.approve'),
  blockLegacyWithdrawalWrites,
  validateBody(z.object({ remark: z.string().trim().min(1).max(512) })),
  asyncHandler(async (req, res) =>
    ok(res, await rejectWithdrawal(req.user, id.parse(req.params.id), req.body.remark, req.ip)),
  ),
);
