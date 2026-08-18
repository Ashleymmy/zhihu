import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody } from '../middleware/validate';
import { createMcnAccount, listMcnAccounts } from '../services/mcn.service';
import { ok } from '../utils/response';

const id = z.string().regex(/^\d+$/);
const create = z.object({
  accountKey: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'accountKey 只允许字母、数字、下划线和连字符'),
  accountName: z.string().trim().min(1).max(128),
  ownerUserId: id.optional(),
});

export const mcnRouter = Router();
mcnRouter.use(requireAuth);
mcnRouter.get(
  '/',
  requirePermission('project.manage'),
  asyncHandler(async (_req, res) => ok(res, await listMcnAccounts())),
);
mcnRouter.post(
  '/',
  requirePermission('project.manage'),
  validateBody(create),
  asyncHandler(async (req, res) => ok(res, await createMcnAccount(req.user, req.body, req.ip), 201)),
);
