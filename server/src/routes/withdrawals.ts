import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { sensitiveWriteLimit } from '../middleware/apiRateLimit';
import { asyncHandler } from '../middleware/errors';
import { validateBody, validateQuery } from '../middleware/validate';
import {
  applyWithdrawal,
  cancelWithdrawal,
  decideWithdrawal,
  getInvoice,
  getStatement,
  listWithdrawals,
  reviewWithdrawal,
  uploadInvoice,
} from '../services/finance-approvals.service';
import { paginationSchema } from '../utils/pagination';
import { ok, okList } from '../utils/response';

const id = z.string().regex(/^\d+$/);
const list = paginationSchema.extend({
  status: z.enum(['pending', 'leader_approved', 'approved', 'rejected', 'cancelled']).optional(),
});
const create = z.object({
  amount: z.number().positive(),
  settleType: z.enum(['personal', 'corporate']).default('personal'),
  payMethod: z.enum(['alipay', 'wechat', 'bank_transfer']),
  payAccount: z.string().min(1).max(128),
  companyName: z.string().trim().max(128).optional(),
  bankName: z.string().trim().max(128).optional(),
  bankAccount: z.string().trim().max(64).optional(),
  taxId: z.string().trim().max(32).optional(),
});

const invoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 + 1, files: 1, fields: 0, parts: 2 },
}).single('file');
const review = z.object({
  action: z.enum(['approve', 'reject']),
  remark: z.string().trim().max(512).nullable().optional(),
});

export const withdrawalsRouter = Router();
withdrawalsRouter.use(requireAuth);

/** 列表（按角色分流） */
withdrawalsRouter.get(
  '/',
  validateQuery(list),
  asyncHandler(async (req, res) => {
    const data = await listWithdrawals(req.user, req.query);
    okList(res, data.list, data.total, data.page, data.pageSize);
  }),
);

/** 成员/团长提交提现申请（自动风控标记） */
withdrawalsRouter.post(
  '/',
  sensitiveWriteLimit,
  requirePermission('withdraw.apply'),
  validateBody(create),
  asyncHandler(async (req, res) => ok(res, await applyWithdrawal(req.user, req.body, req.ip), 201)),
);

/** 成员撤销（初审前） */
withdrawalsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    await cancelWithdrawal(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);

/** 团长初审 */
withdrawalsRouter.post(
  '/:id/review',
  sensitiveWriteLimit,
  requirePermission('withdraw.review'),
  validateBody(review),
  asyncHandler(async (req, res) => {
    await reviewWithdrawal(req.user, id.parse(req.params.id), req.body.action, req.body.remark ?? null, req.ip);
    ok(res, null);
  }),
);

/** 管理员终审 + 放款 */
withdrawalsRouter.post(
  '/:id/decide',
  sensitiveWriteLimit,
  requirePermission('withdraw.approve'),
  validateBody(review),
  asyncHandler(async (req, res) => {
    await decideWithdrawal(req.user, id.parse(req.params.id), req.body.action, req.body.remark ?? null, req.ip);
    ok(res, null);
  }),
);

/** 上传发票（对公申请，申请人本人） */
withdrawalsRouter.post('/:id/invoice', invoiceUpload, asyncHandler(async (req, res) => {
  if (!req.file) throw new Error('缺少上传文件');
  ok(res, await uploadInvoice(req.user, id.parse(req.params.id), req.file, req.ip), 201);
}));

/** 下载发票（本人 / 团长 / 管理员） */
withdrawalsRouter.get('/:id/invoice', asyncHandler(async (req, res) => {
  const invoice = await getInvoice(req.user, id.parse(req.params.id));
  res.download(invoice.path, invoice.name);
}));

/** 结算单（本人 / 团长 / 管理员） */
withdrawalsRouter.get(
  '/:id/statement',
  asyncHandler(async (req, res) => ok(res, await getStatement(req.user, id.parse(req.params.id)))),
);
