import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody } from '../middleware/validate';
import { createMember, deleteMember, disableMember, listMembers, resetPassword, updateMember, listLeaders, myTeam, applyToTeam, listMyApplications, listApplications, reviewApplication, cancelMyApplication } from '../services/team.service';
import { ok } from '../utils/response';

const id = z.string().regex(/^\d+$/);
const create = z.object({
  username: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(64),
  phone: z.string().max(20).nullable().optional(),
  role: z
    .enum(['leader', 'member', 'creator'])
    .transform((value) => (value === 'member' ? 'creator' : value))
    .optional(),
  parentId: id.nullable().optional(),
});
const update = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  phone: z.string().max(20).nullable().optional(),
});
const resetPwd = z.object({
  password: z.string().min(8).max(128).optional(),
});
const apply = z.object({
  leaderUsername: z.string().trim().min(1).max(64),
  message: z.string().trim().max(500).optional(),
});
const review = z.object({
  action: z.enum(['approve', 'reject']),
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
  validateBody(resetPwd),
  asyncHandler(async (req, res) => ok(res, await resetPassword(req.user, id.parse(req.params.id), req.ip, req.body.password))),
);
teamRouter.post(
  '/members/:id/disable',
  requirePermission('team.disable'),
  asyncHandler(async (req, res) => {
    await disableMember(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);
teamRouter.delete(
  '/members/:id',
  requirePermission('team.delete'),
  asyncHandler(async (req, res) => {
    await deleteMember(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);
teamRouter.get(
  '/leaders',
  requirePermission('team.apply'),
  asyncHandler(async (_req, res) => ok(res, await listLeaders())),
);
teamRouter.get(
  '/my',
  requirePermission('team.apply'),
  asyncHandler(async (req, res) => ok(res, await myTeam(req.user))),
);
teamRouter.post(
  '/applications',
  requirePermission('team.apply'),
  validateBody(apply),
  asyncHandler(async (req, res) => ok(res, await applyToTeam(req.user, req.body.leaderUsername, req.body.message, req.ip), 201)),
);
teamRouter.get(
  '/applications/mine',
  requirePermission('team.apply'),
  asyncHandler(async (req, res) => ok(res, await listMyApplications(req.user))),
);
teamRouter.get(
  '/applications',
  requirePermission('team.review'),
  asyncHandler(async (req, res) => ok(res, await listApplications(req.user))),
);
teamRouter.post(
  '/applications/:id/cancel',
  requirePermission('team.apply'),
  asyncHandler(async (req, res) => {
    await cancelMyApplication(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);
teamRouter.post(
  '/applications/:id/review',
  requirePermission('team.review'),
  validateBody(review),
  asyncHandler(async (req, res) => {
    await reviewApplication(req.user, id.parse(req.params.id), req.body.action, req.ip);
    ok(res, null);
  }),
);
