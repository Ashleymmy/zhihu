import multer, { MulterError } from 'multer';
import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../auth/middleware';
import { requirePermission } from '../permissions';
import { asyncHandler } from '../../../middleware/errors';
import { AppError } from '../../../middleware/errors';
import { ok } from '../../../utils/response';
import { paginationSchema } from '../../../utils/pagination';
import { XLSX_MAX_BYTES } from '../zhihu/allianceXlsx';
import {
  confirmDataImport,
  getDataImportBatch,
  listDataImportBatches,
  parseDataImport,
  rejectDataImport,
} from '../services/data-import.service';

const sourceType = z.object({
  sourceType: z.enum(['email_attachment', 'manual_excel']).default('email_attachment'),
});
const id = z.string().regex(/^[A-Za-z0-9_-]+$/u);
const rejection = z.object({ reason: z.string().trim().max(500).optional() });
const detailQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
const confirmRequest = z.object({
  tempFileId: id,
  options: z
    .object({
      overwriteDuplicates: z.boolean().default(false),
      autoTriggerAttribution: z.boolean().default(true),
    })
    .optional(),
});

const upload = multer({
  storage: multer.memoryStorage(),
  preservePath: true,
  limits: {
    fileSize: XLSX_MAX_BYTES + 1,
    files: 1,
    fields: 1,
    parts: 3,
    fieldNameSize: 64,
    fieldSize: 128,
    headerPairs: 32,
    fieldNestingDepth: 0,
  },
}).single('file');

const uploadMiddleware: RequestHandler = (req, res, next) => {
  upload(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new AppError(413, 41300, `上传文件不能超过 ${XLSX_MAX_BYTES / 1024 / 1024} MB`));
      return;
    }
    next(new AppError(422, 42216, '上传文件不符合要求：仅接受合法的 .xlsx 文件'));
  });
};

export const dataImportRouter = Router();
dataImportRouter.use(requireAuth, requirePermission('data.import'));

dataImportRouter.post(
  '/parse',
  uploadMiddleware,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(422, 42216, '缺少上传文件');
    const input = sourceType.parse(req.body);
    ok(res, await parseDataImport(req.user, req.file, input.sourceType, req.ip), 201);
  }),
);

dataImportRouter.post(
  '/confirm',
  asyncHandler(async (req, res) => {
    const input = confirmRequest.parse(req.body ?? {});
    ok(res, await confirmDataImport(req.user, input.tempFileId, req.ip));
  }),
);

dataImportRouter.post(
  '/:id/confirm',
  asyncHandler(async (req, res) => {
    ok(res, await confirmDataImport(req.user, id.parse(req.params.id), req.ip));
  }),
);

dataImportRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const input = rejection.parse(req.body ?? {});
    ok(res, await rejectDataImport(req.user, id.parse(req.params.id), input.reason, req.ip));
  }),
);

dataImportRouter.get(
  '/batches',
  asyncHandler(async (req, res) => {
    const query = paginationSchema.parse(req.query);
    ok(res, await listDataImportBatches(req.user, query.page, query.pageSize));
  }),
);

dataImportRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const query = detailQuery.parse(req.query);
    ok(res, await getDataImportBatch(req.user, id.parse(req.params.id), query.page, query.pageSize));
  }),
);
