import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { requireDuty } from './duties';
import type { ModuleRuntime } from './module-runtime';
import { approve, decline, listPromotions, nominate, nomineePreview, promotionDetail } from './member-promotions';

/** 晋升工作台：有运营权限的现有人员可单人登记、查看和确认，保留原接口地址兼容旧记录。 */
const id = z.string().regex(/^[1-9]\d*$/);
const reason = z.string().trim().min(2, '请写明原因').max(500);
const none = z.object({}).strict();

export function createPromotionRouter(runtime: ModuleRuntime) {
  const router = Router();
  router.use(requireDuty('operations'));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const q = z.object({ view: z.enum(['open', 'done']).default('open') }).strict().parse(req.query);
      ok(res, await listPromotions(req.user, q.view));
    }),
  );
  router.get(
    '/nominee/:userId',
    asyncHandler(async (req, res) => {
      none.parse(req.query);
      ok(res, await nomineePreview(id.parse(req.params.userId)));
    }),
  );
  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      none.parse(req.query);
      ok(res, await promotionDetail(req.user, id.parse(req.params.id)));
    }),
  );
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = z.object({ userId: id, note: reason }).strict().parse(req.body);
      ok(res, await nominate(req.user, body), 201);
    }),
  );
  router.post(
    '/:id/approve',
    asyncHandler(async (req, res) => {
      const body = z
        .object({ follow: z.array(id).max(500), note: z.string().trim().max(500).optional() })
        .strict()
        .parse(req.body);
      ok(res, await approve(req.user, id.parse(req.params.id), { follow: body.follow, note: body.note || undefined }, runtime));
    }),
  );
  for (const [path, status] of [['reject', 'rejected'], ['cancel', 'cancelled']] as const)
    router.post(
      `/:id/${path}`,
      asyncHandler(async (req, res) => {
        const body = z.object({ reason }).strict().parse(req.body);
        await decline(req.user, id.parse(req.params.id), status, body.reason);
        ok(res, { status });
      }),
    );
  return router;
}
