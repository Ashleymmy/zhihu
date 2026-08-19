import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody } from '../middleware/validate';
import {
  addProjectMember,
  listProjectMembers,
  listProjects,
  removeProjectMember,
} from '../services/projectMembers.service';
import { createProject, disableProject, updateProject } from '../services/projects.service';
import { ok } from '../utils/response';
import { projectCoursesRouter } from './project-courses';

const id = z.string().regex(/^\d+$/);
const addMember = z.object({
  userId: id,
  memberRole: z.enum(['owner', 'admin', 'member', 'viewer']).optional(),
});
const createProjectBody = z.object({
  name: z.string().trim().min(1).max(64),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(32),
  apiBaseUrl: z.string().url().max(255),
  signMethod: z.enum(['hmac_sha256', 'oauth2']).optional(),
  configJson: z.record(z.unknown()).optional(),
});
const updateProjectBody = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  apiBaseUrl: z.string().url().max(255).optional(),
  signMethod: z.enum(['hmac_sha256', 'oauth2']).optional(),
  isEnabled: z.boolean().optional(),
  configJson: z.record(z.unknown()).nullable().optional(),
});

export const projectsRouter = Router();
projectsRouter.use(requireAuth);
projectsRouter.use('/:projectId/courses', projectCoursesRouter);

projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => ok(res, await listProjects(req.user))),
);
projectsRouter.post(
  '/',
  requirePermission('project.manage'),
  validateBody(createProjectBody),
  asyncHandler(async (req, res) => ok(res, await createProject(req.user, req.body, req.ip), 201)),
);
projectsRouter.patch(
  '/:projectId',
  requirePermission('project.manage'),
  validateBody(updateProjectBody),
  asyncHandler(async (req, res) =>
    ok(res, await updateProject(req.user, id.parse(req.params.projectId), req.body, req.ip)),
  ),
);
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
projectsRouter.delete(
  '/:projectId',
  requirePermission('project.manage'),
  asyncHandler(async (req, res) => {
    await disableProject(req.user, id.parse(req.params.projectId), req.ip);
    ok(res, null);
  }),
);
