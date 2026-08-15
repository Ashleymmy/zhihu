import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody, validateQuery } from '../middleware/validate';
import {
  createComposition,
  createCompositionBatch,
  getComposition,
  listCompositions,
  updateComposition,
} from '../services/compositions.service';
import { paginationSchema } from '../utils/pagination';
import { ok, okList } from '../utils/response';
import {
  isCompositionCategoryValid,
  isZonedIsoDateTime,
  normalizeMediaType,
  normalizeZonedIsoDateTime,
  ZHIHU_MEDIA_TYPES,
} from '../zhihu/composition';

const id = z.string().regex(/^\d+$/);
const mediaType = z.union([z.enum(ZHIHU_MEDIA_TYPES), z.literal(1), z.literal(2)]).transform(normalizeMediaType);
const categoryFields = {
  compositionType: z.number().int().min(0).max(2),
  compositionSubType: z.number().int().min(1).max(11),
};
const releaseTime = z
  .string()
  .refine(isZonedIsoDateTime, '作品发布时间必须是带时区的 ISO 8601')
  .transform(normalizeZonedIsoDateTime);
const input = z
  .object({
    planId: id,
    mediaType,
    mediaAccount: z.string().trim().min(1).max(128),
    ...categoryFields,
    title: z.string().max(255).nullable().optional(),
    promoUrl: z.string().url().max(1024),
    releaseTime,
  })
  .refine((value) => isCompositionCategoryValid(value.compositionType, value.compositionSubType), {
    message: '作品分类组合不正确',
    path: ['compositionSubType'],
  });
const patch = z.object({
  mediaType: mediaType.optional(),
  mediaAccount: z.string().trim().min(1).max(128).optional(),
  compositionType: categoryFields.compositionType.optional(),
  compositionSubType: categoryFields.compositionSubType.optional(),
  title: z.string().max(255).nullable().optional(),
  promoUrl: z.string().url().max(1024).optional(),
  releaseTime: releaseTime.nullable().optional(),
});
const list = paginationSchema.extend({ planId: id.optional(), status: z.string().optional() });
export const compositionsRouter = Router();
compositionsRouter.use(requireAuth);
compositionsRouter.get(
  '/',
  validateQuery(list),
  asyncHandler(async (req, res) => {
    const data = await listCompositions(req.user, req.query);
    okList(res, data.list, data.total, data.page, data.pageSize);
  }),
);
compositionsRouter.post(
  '/',
  requirePermission('composition.create'),
  validateBody(input),
  asyncHandler(async (req, res) => ok(res, await createComposition(req.user, req.body, req.ip), 201)),
);
compositionsRouter.post(
  '/batch',
  requirePermission('composition.create'),
  validateBody(z.object({ items: z.array(input).min(1).max(100) })),
  asyncHandler(async (req, res) => ok(res, await createCompositionBatch(req.user, req.body.items, req.ip), 201)),
);
compositionsRouter.patch(
  '/:id',
  requirePermission('composition.edit'),
  validateBody(patch),
  asyncHandler(async (req, res) =>
    ok(res, await updateComposition(req.user, id.parse(req.params.id), req.body, req.ip)),
  ),
);
compositionsRouter.get(
  '/:id/audit-status',
  asyncHandler(async (req, res) => {
    const item = await getComposition(req.user, id.parse(req.params.id));
    ok(res, {
      id: String(item.id),
      status: item.status,
      rejectReason: item.reject_reason ?? null,
      syncStatus: item.sync_status,
    });
  }),
);
