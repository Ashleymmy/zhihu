import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../auth/middleware';
import { asyncHandler, AppError } from '../../../middleware/errors';
import { ok } from '../../../utils/response';
import { incrRateLimit } from '../../../utils/rateLimit';
import { authorizeSalt } from '../services/salt-boards';
import { saltBoards, saltContents, saltId, saltPaging } from '../zhihu/salt';
import * as risk from '../services/risk-reports';

// Customer-facing routes always apply personal ownership, even for a staff actor.
export const contentToolsRouter = Router();
contentToolsRouter.use(requireAuth, (req, _res, next) => {
  try {
    risk.requireRiskParticipant(req.user);
    next();
  } catch (error) {
    next(error);
  }
});
const page = z.coerce.number().int().min(1).max(50000).default(1);
contentToolsRouter.get(
  '/boards',
  asyncHandler(async (req, res) => {
    await authorizeSalt(req.user, risk.scopeSchema.parse(req.query), 'personal');
    ok(res, await saltBoards());
  }),
);
contentToolsRouter.get(
  '/boards/:id/contents',
  asyncHandler(async (req, res) => {
    await authorizeSalt(req.user, risk.scopeSchema.parse(req.query), 'personal');
    ok(res, await saltContents(saltId.parse(req.params.id), saltPaging.parse(req.query)));
  }),
);
contentToolsRouter.get(
  '/works',
  asyncHandler(async (req, res) => {
    ok(
      res,
      await risk.riskWorks(
        req.user,
        risk.scopeSchema.parse(req.query),
        z.string().trim().max(128).default('').parse(req.query.search),
        page.parse(req.query.page),
        'personal',
      ),
    );
  }),
);
contentToolsRouter.get(
  '/works/:id/risks',
  asyncHandler(async (req, res) => {
    ok(
      res,
      await risk.personalWorkRisk(
        req.user,
        risk.scopeSchema.parse(req.query),
        z.string().regex(/^\d+$/).parse(req.params.id),
        z.coerce.number().int().min(0).max(1000000).default(0).parse(req.query.offset),
      ),
    );
  }),
);
contentToolsRouter.get(
  '/reports',
  asyncHandler(async (req, res) => {
    ok(
      res,
      await risk.riskHistory(req.user, risk.scopeSchema.parse(req.query), page.parse(req.query.page), 'personal'),
    );
  }),
);
contentToolsRouter.post(
  '/images',
  asyncHandler(async (req, res) => {
    const input = risk.scopeSchema
      .extend({
        base64: z
          .string()
          .min(4)
          .max(Math.ceil((700 * 1024) / 3) * 4)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict()
      .parse(req.body);
    await risk.authorizeRisk(req.user, input, 'personal');
    if (!(await incrRateLimit(`zhihu:risk-image:${req.user.sub}`, 30, 3600)).allowed)
      throw new AppError(429, 42900, '截图上传过于频繁，请稍后重试');
    const buffer = Buffer.from(input.base64, 'base64');
    if (buffer.toString('base64') !== input.base64 || buffer.length > 700 * 1024)
      throw new AppError(422, 42201, '截图内容不完整，请重新选择');
    const mimetype = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : 'image/jpeg';
    ok(
      res,
      await risk.riskImage(
        req.user,
        input,
        { buffer, size: buffer.length, mimetype },
        'personal',
      ),
    );
  }),
);
contentToolsRouter.post(
  '/reports',
  asyncHandler(async (req, res) => {
    const input = risk.scopeSchema
      .extend({
        requestKey: z.string().regex(/^[\w.-]{8,128}$/),
        report: risk.reportSchema,
      })
      .strict()
      .parse(req.body);
    ok(res, await risk.submitRisk(req.user, input, input.requestKey, input.report, 'personal'));
  }),
);
contentToolsRouter.get(
  '/reports/:id/result',
  asyncHandler(async (req, res) => {
    ok(
      res,
      await risk.personalRiskResult(
        req.user,
        risk.scopeSchema.parse(req.query),
        z.string().uuid().parse(req.params.id),
        z.coerce.number().int().min(0).max(1000000).default(0).parse(req.query.offset),
      ),
    );
  }),
);
contentToolsRouter.post(
  '/reports/:id/retry',
  asyncHandler(async (req, res) => {
    const input = risk.scopeSchema
      .extend({
        attempt: z.number().int().positive(),
        checkedNotReceived: z.boolean().default(false),
      })
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
        'personal',
      ),
    );
  }),
);
