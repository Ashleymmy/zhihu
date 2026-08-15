import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody } from '../middleware/validate';
import { createMember, disableMember, listMembers, resetPassword, updateMember } from '../services/team.service';
import { ok } from '../utils/response';

const id = z.string().regex(/^\d+$/);
const create = z.object({
  username: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(64),
  phone: z.string().max(20).nullable().optional(),
  role: z.enum(['leader', 'member']).optional(),
  parentId: id.nullable().optional(),
});
const update = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  phone: z.string().max(20).nullable().optional(),
});
export const teamRouter = Router();
teamRouter.use(requireAuth);
teamRouter.get(
  '/members',
  requirePermission('team.view'),
  asyncHandler(async (req, res) => ok(res, await listMembers(req.user))),
);
teamRouter.post(
  '/members',
  requirePermission('team.create_member'),
  validateBody(create),
  asyncHandler(async (req, res) => ok(res, await createMember(req.user, req.body, req.ip), 201)),
);
teamRouter.patch(
  '/members/:id',
  requirePermission('team.create_member'),
  validateBody(update),
  asyncHandler(async (req, res) => {
    await updateMember(req.user, id.parse(req.params.id), req.body, req.ip);
    ok(res, null);
  }),
);
teamRouter.post(
  '/members/:id/reset-password',
  requirePermission('team.reset_pwd'),
  asyncHandler(async (req, res) => ok(res, await resetPassword(req.user, id.parse(req.params.id), req.ip))),
);
teamRouter.post(
  '/members/:id/disable',
  requirePermission('team.disable'),
  asyncHandler(async (req, res) => {
    await disableMember(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);
