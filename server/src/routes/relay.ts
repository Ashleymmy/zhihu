import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody } from '../middleware/validate';
import { ok } from '../utils/response';
import { XLSX_MAX_BYTES } from '../zhihu/allianceXlsx';
import {
  approveBatch,
  cancelBatch,
  createBatch,
  createRule,
  disableRule,
  getBatch,
  importBatch,
  listBatches,
  listRules,
} from '../services/relay.service';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: XLSX_MAX_BYTES + 1, files: 1, fields: 4 },
}).single('file');

const importMeta = z.object({
  title: z.string().trim().min(1).max(128),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const id = z.string().regex(/^\d+$/);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/, '金额必须是最多 4 位小数的非负数字符串');
const percentageText = z.string().regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/, '比例必须是 0 到 1 之间的数字');

const ruleInput = z
  .object({
    targetUserId: id.nullable().optional(),
    targetRole: z.enum(['leader', 'creator']),
    method: z.enum(['fixed', 'percentage']),
    unitPrice: money.nullable().optional(),
    percentage: percentageText.nullable().optional(),
    priority: z.number().int().min(0).max(9999).optional(),
  })
  .refine((value) => (value.method === 'fixed' ? value.unitPrice != null : value.percentage != null), {
    message: 'fixed 必须提供 unitPrice，percentage 必须提供 percentage',
  });

const batchInput = z.object({
  title: z.string().trim().min(1).max(128),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z
    .array(
      z.object({
        creatorId: id,
        sourceAmount: money,
        note: z.string().max(255).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const relayRouter = Router();
relayRouter.use(requireAuth, requirePermission('finance.relay'));

relayRouter.get('/rules', asyncHandler(async (_req, res) => ok(res, await listRules())));
relayRouter.post(
  '/rules',
  validateBody(ruleInput),
  asyncHandler(async (req, res) => ok(res, await createRule(req.user, req.body, req.ip), 201)),
);
relayRouter.post(
  '/rules/:id/disable',
  asyncHandler(async (req, res) => {
    await disableRule(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);

relayRouter.get('/batches', asyncHandler(async (_req, res) => ok(res, await listBatches())));
relayRouter.get(
  '/batches/:id',
  asyncHandler(async (req, res) => ok(res, await getBatch(id.parse(req.params.id)))),
);
relayRouter.post(
  '/batches',
  validateBody(batchInput),
  asyncHandler(async (req, res) => ok(res, await createBatch(req.user, req.body, req.ip), 201)),
);
relayRouter.post(
  '/batches/import',
  upload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new Error('缺少上传文件');
    const meta = importMeta.parse(req.body);
    ok(res, await importBatch(req.user, req.file, meta, req.ip), 201);
  }),
);
relayRouter.post(
  '/batches/:id/approve',
  asyncHandler(async (req, res) => {
    await approveBatch(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);
relayRouter.post(
  '/batches/:id/cancel',
  asyncHandler(async (req, res) => {
    await cancelBatch(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);
