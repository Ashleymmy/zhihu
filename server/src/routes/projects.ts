import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody } from '../middleware/validate';
import { addProjectMember, listProjectMembers, removeProjectMember } from '../services/projectMembers.service';
import { ok } from '../utils/response';

const id = z.string().regex(/^\d+$/);
const addMember = z.object({
  userId: id,
  memberRole: z.enum(['owner', 'admin', 'member', 'viewer']).optional(),
});

export const projectsRouter = Router();
projectsRouter.use(requireAuth);
projectsRouter.get(
  '/:projectId/members',
  asyncHandler(async (req, res) => ok(res, await listProjectMembers(req.user, id.parse(req.params.projectId)))),
);
projectsRouter.post(
  '/:projectId/members',
  requirePermission('project.manage'),
  validateBody(addMember),
  asyncHandler(async (req, res) =>
    ok(res, await addProjectMember(req.user, id.parse(req.params.projectId), req.body, req.ip), 201),
  ),
);
projectsRouter.delete(
  '/:projectId/members/:userId',
  requirePermission('project.manage'),
  asyncHandler(async (req, res) => {
    await removeProjectMember(req.user, id.parse(req.params.projectId), id.parse(req.params.userId), req.ip);
    ok(res, null);
  }),
);
