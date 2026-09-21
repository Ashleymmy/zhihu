import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../../../auth/middleware';
import { requirePermission } from '../permissions';
import { AppError, asyncHandler } from '../../../middleware/errors';
import { IMPORT_MAX_BYTES, importOptionsSchema } from '../services/composition-import-parser';
import { analyzeCompositionImport, commitCompositionImport } from '../services/composition-import.service';
import { getWorkImportDraft, listWorkImportDrafts, saveWorkImportDraft } from '../services/composition-import-drafts.service';
import { validateBody, validateQuery } from '../../../middleware/validate';
import {
  createComposition,
  createCompositionBatch,
  getComposition,
  listCompositions,
  updateComposition,
} from '../services/compositions.service';
import { paginationSchema } from '../../../utils/pagination';
import { ok, okList } from '../../../utils/response';
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
const list = paginationSchema.extend({ planId: id.optional(), status: z.string().optional(), keyword: z.string().trim().max(128).optional() });
export const compositionsRouter = Router();
compositionsRouter.use(requireAuth);
const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMPORT_MAX_BYTES, files: 1, fields: 1, parts: 3, fieldSize: 256 * 1024 } }).single('file');
const upload: import('express').RequestHandler = (req, res, next) => multipart(req, res, error => next(error instanceof multer.MulterError ? new AppError(422, 42200, '请上传一个不超过 5 MB 的表格文件') : error));
for (const mode of ['analyze', 'commit', 'draft'] as const) {
  compositionsRouter.post(`/import/${mode}`, requirePermission('composition.create'), upload, asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(422, 42200, '请选择要上传的表格');
    if ([...req.file.originalname].every(char => char.charCodeAt(0) <= 255)) {
      const decoded = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      if (!decoded.includes('\uFFFD')) req.file.originalname = decoded;
    }
    let rawOptions: unknown;
    try { rawOptions = JSON.parse(req.body.options || '{}'); }
    catch { throw new AppError(422, 42200, '字段对应设置不是有效 JSON'); }
    const options = importOptionsSchema.parse(rawOptions);
    if (mode === 'draft') return ok(res, await saveWorkImportDraft(req.user, req.file, options, req.ip), 201);
    if (mode === 'commit') return ok(res, await commitCompositionImport(req.user, req.file, options, req.ip), 201);
    const result = await analyzeCompositionImport(req.user, req.file, options);
    return ok(res, { ...result, rows: result.rows.map(({ input: _, ...row }) => row) });
  }));
}
compositionsRouter.get('/import/drafts', requirePermission('composition.create'), asyncHandler(async (req, res) => {
  const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
  ok(res, await listWorkImportDrafts(req.user, page));
}));
compositionsRouter.get('/import/drafts/:id', requirePermission('composition.create'), asyncHandler(async (req, res) => {
  ok(res, await getWorkImportDraft(req.user, id.parse(req.params.id)));
}));
compositionsRouter.get('/import/drafts/:id/file', requirePermission('composition.create'), asyncHandler(async (req, res) => {
  const draft = await getWorkImportDraft(req.user, id.parse(req.params.id), true);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(draft.file_name)}`);
  res.type('application/octet-stream').send(draft.source_file);
}));
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
    const item = (await getComposition(req.user, id.parse(req.params.id))) as Record<string, unknown>;
    ok(res, {
      id: String(item.id),
      status: item.status,
      rejectReason: item.reject_reason ?? item.rejectReason ?? null,
      syncStatus: item.sync_status ?? item.syncStatus,
    });
  }),
);
