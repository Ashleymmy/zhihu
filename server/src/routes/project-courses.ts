import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody } from '../middleware/validate';
import { createProjectCourse, deleteProjectCourse, listProjectCourses } from '../services/project-courses.service';
import { ok } from '../utils/response';

const id = z.string().regex(/^\d+$/);
const addCourse = z.object({
  courseName: z.string().trim().min(1).max(128),
  courseUrl: z.string().url().max(512).optional(),
  displayOrder: z.number().int().min(0).optional(),
});

// 挂载在 projectsRouter 的 /:projectId/courses 下，requireAuth 由父路由提供
export const projectCoursesRouter = Router({ mergeParams: true });

projectCoursesRouter.get(
  '/',
  asyncHandler(async (req, res) => ok(res, await listProjectCourses(req.user, id.parse(req.params.projectId)))),
);

projectCoursesRouter.post(
  '/',
  requirePermission('project.manage'),
  validateBody(addCourse),
  asyncHandler(async (req, res) =>
    ok(res, await createProjectCourse(req.user, id.parse(req.params.projectId), req.body, req.ip), 201),
  ),
);

projectCoursesRouter.delete(
  '/:courseId',
  requirePermission('project.manage'),
  asyncHandler(async (req, res) => {
    await deleteProjectCourse(req.user, id.parse(req.params.projectId), id.parse(req.params.courseId), req.ip);
    ok(res, null);
  }),
);
