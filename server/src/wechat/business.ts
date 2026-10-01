import { Router } from 'express';
import { z } from 'zod';
import { rows } from '../db';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../modules/zhihu/permissions';
import { asyncHandler, AppError } from '../middleware/errors';
import { requireWechatContext } from './context';
import { ok } from '../utils/response';
import { compositionInputSchema } from '../modules/zhihu/routes/compositions';
import { insertComposition } from '../modules/zhihu/services/compositions.service';
import { enqueue } from '../modules/zhihu/queue';
import { mutate, select, audit, authorize } from '../modules/zhihu/attribution/store';
import { assertDuty } from '../core/duties';
import { overview } from '../modules/zhihu/attribution/workbench';
import { listKeywords } from '../modules/zhihu/attribution/resources';
import { insertEvidence } from '../modules/zhihu/attribution/statements';
import { listWorks } from '../modules/zhihu/attribution/works';
import { listProjects } from '../services/projectMembers.service';
import { listProjectCourses } from '../services/project-courses.service';
import { miniFile } from './files';
import { analyzeCompositionImport } from '../modules/zhihu/services/composition-import.service';
import { importOptionsSchema } from '../modules/zhihu/services/composition-import-parser';

const scope = z.object({ projectId: z.string().regex(/^\d+$/), accountId: z.string().regex(/^\d+$/) });
export const miniBusinessRouter = Router();
const paths = ['/mini-works', '/mini-import-works', '/home-summary', '/courses'];
miniBusinessRouter.use((req, _res, next) => {
  if (!paths.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next('router');
  try {
    requireWechatContext(req);
    next();
  } catch (e) {
    next(e);
  }
});
miniBusinessRouter.use(requireAuth);
miniBusinessRouter.post(
  '/mini-works',
  requirePermission('composition.create'),
  asyncHandler(async (req, res) => {
    const s = scope.parse(req.body),
      input = compositionInputSchema.parse(req.body),
      key = z
        .string()
        .regex(/^[\w.-]{8,128}$/)
        .parse(req.body.requestKey);
    const result = await mutate(req.user, s, 'mini.composition.create', key, input, async (c) => {
      const [plan] = await select(
        c,
        'SELECT id,current_binding_id FROM zh_keywords WHERE plan_id=? AND account_id=? AND project_id=?',
        [input.planId, s.accountId, s.projectId],
      );
      if (!plan) throw new AppError(404, 40400, '当前项目没有此关键词');
      const id = await insertComposition(req.user, input, c);
      if (plan.current_binding_id)
        await insertEvidence(c, req.user, s, {
          bindingId: String(plan.current_binding_id),
          url: input.promoUrl,
          description: input.title || '小程序登记作品',
        });
      await audit(c, req.user, 'composition.create', id, { source: 'mini' });
      return { id, syncStatus: 'local' };
    });
    await enqueue(
      'push-composition',
      { ...s, compositionId: result.id },
      { jobId: `composition-${result.id}`, removeOnComplete: true, removeOnFail: true },
    );
    ok(res, result, 201);
  }),
);
miniBusinessRouter.post(
  '/mini-import-works',
  requirePermission('composition.create'),
  asyncHandler(async (req, res) => {
    const s = scope.parse(req.body);
    const file = await miniFile(req.user, req.body.fileId, s.projectId, s.accountId, 'composition-xlsx');
    const options = importOptionsSchema.parse({
      ...req.body.options,
      defaults: { ...req.body.options?.defaults, planId: req.body.planId },
    });
    const result = await analyzeCompositionImport(req.user, file, options);
    ok(res, result);
  }),
);
miniBusinessRouter.get(
  '/home-summary',
  asyncHandler(async (req, res) => {
    const s = scope.parse(req.query),
      date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const [keywords, works] = await Promise.all([listKeywords(req.user, s, 1, 1), listWorks(req.user, s, 1, 1)]);
    let todayReceivable: string | null = null,
      todayPayable: string | null = null;
    try {
      assertDuty(req.user, 'finance');
      const view = await overview(req.user, s, { from: date, to: date });
      todayReceivable = view.summary.receivable;
      todayPayable = view.summary.payable;
    } catch (error) {
      if (!(error instanceof AppError) || error.httpStatus !== 403) throw error;
    }
    ok(res, {
      todayReceivable,
      todayPayable,
      keywords: keywords.total,
      works: works.total,
      pendingReview: null,
      ongoing: null,
    });
  }),
);
miniBusinessRouter.get(
  '/courses',
  asyncHandler(async (req, res) => {
    const projects = await listProjects(req.user),
      tiers = [];
    for (const project of projects) {
      if (!project.isEnabled) continue;
      const courses = (await listProjectCourses(req.user, String(project.id)))
        .filter((c) => c.isActive)
        .map((c) => ({
          id: c.id,
          projectId: c.projectId,
          title: c.courseName,
          intro: '项目课程',
          cover: '',
          tier: 'silver',
          url: c.courseUrl,
          views: null,
          duration: '',
        }));
      if (courses.length) tiers.push({ key: String(project.id), title: project.name, subtitle: '项目课程', courses });
    }
    ok(res, { tiers, total: tiers.reduce((n, t) => n + t.courses.length, 0) });
  }),
);
miniBusinessRouter.get(
  '/courses/:id',
  asyncHandler(async (req, res) => {
    const id = z.string().regex(/^\d+$/).parse(req.params.id);
    const [ref] = await rows('SELECT project_id FROM project_courses WHERE id=?', [id]);
    if (!ref) throw new AppError(404, 40400, '课程不存在');
    const course = (await listProjectCourses(req.user, String(ref.project_id))).find((c) => c.id === id && c.isActive);
    if (!course) throw new AppError(404, 40400, '课程不存在或已下架');
    ok(res, {
      id,
      title: course.courseName,
      url: course.courseUrl,
      sections: [{ title: '课程链接', content: course.courseUrl || '课程内容尚未发布' }],
    });
  }),
);
