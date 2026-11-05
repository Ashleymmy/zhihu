import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../../../auth/middleware';
import { asyncHandler, AppError } from '../../../middleware/errors';
import { ok } from '../../../utils/response';
import * as risk from '../services/risk-reports';
import { riskFilters } from '../zhihu/risk';
export const riskReportsRouter = Router();
riskReportsRouter.use(requireAuth, (req, _res, next) => {
  try {
    risk.requireRiskManager(req.user);
    next();
  } catch (e) {
    next(e);
  }
});
const page = z.coerce.number().int().min(1).max(50000).default(1);
riskReportsRouter.get(
  '/',
  asyncHandler(async (req, res) =>
    ok(res, await risk.listRisk(req.user, risk.scopeSchema.parse(req.query), riskFilters.parse(req.query))),
  ),
);
riskReportsRouter.get(
  '/works',
  asyncHandler(async (req, res) =>
    ok(
      res,
      await risk.riskWorks(
        req.user,
        risk.scopeSchema.parse(req.query),
        z.string().trim().max(128).default('').parse(req.query.search),
        page.parse(req.query.page),
      ),
    ),
  ),
);
riskReportsRouter.get(
  '/history',
  asyncHandler(async (req, res) =>
    ok(res, await risk.riskHistory(req.user, risk.scopeSchema.parse(req.query), page.parse(req.query.page))),
  ),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0, parts: 2 },
}).single('file');
riskReportsRouter.post(
  '/images',
  asyncHandler(async (req, _res, next) => {
    await risk.authorizeRisk(req.user, risk.scopeSchema.parse(req.query));
    next();
  }),
  (req, res, next) =>
    upload(req, res, (e) =>
      next(e ? new AppError(422, 42201, '请选择一张不超过 2 MB 的 PNG 或 JPEG 截图') : undefined),
    ),
  asyncHandler(async (req, res) =>
    ok(res, await risk.riskImage(req.user, risk.scopeSchema.parse(req.query), req.file)),
  ),
);
riskReportsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string(),
        accountId: z.string(),
        requestKey: z.string().regex(/^[\w.-]{8,128}$/),
        report: risk.reportSchema,
      })
      .strict()
      .parse(req.body);
    ok(res, await risk.submitRisk(req.user, risk.scopeSchema.parse(body), body.requestKey, body.report));
  }),
);
riskReportsRouter.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    const input = risk.scopeSchema
      .extend({ attempt: z.number().int().positive(), checkedNotReceived: z.boolean().default(false) })
      .strict()
      .parse(req.body);
    ok(
      res,
      await risk.retryRisk(
        req.user,
        input,
        z.string().uuid().parse(req.params.id),
        input.attempt,
        input.checkedNotReceived,
      ),
    );
  }),
);
