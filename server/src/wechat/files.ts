import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db, rows, withTransaction } from '../db';
import { requireAuth } from '../auth/middleware';
import { requireWechatContext, wechatContext } from './context';
import { asyncHandler, AppError } from '../middleware/errors';
import { assertDataScope } from '../core/accounts';
import { assertDuty } from '../core/duties';
import { ok } from '../utils/response';
import type { AuthUser } from '../types';
import { incrRateLimit } from '../utils/rateLimit';

const scope = z.object({ projectId: z.string().regex(/^\d+$/), accountId: z.string().regex(/^\d+$/) });
const uuid = z.string().uuid();
const CHUNK = 512 * 1024;
const max = (purpose: string) => (purpose === 'report' ? 10 * 1024 * 1024 : 5 * 1024 * 1024);
async function owned(c: PoolConnection, id: string, user: AuthUser) {
  const [[f]] = await c.query<RowDataPacket[]>(
    'SELECT * FROM mini_uploads WHERE id=? AND user_id=? AND expires_at>NOW(3) FOR UPDATE',
    [id, user.sub],
  );
  if (!f) throw new AppError(404, 40400, '上传文件不存在或已过期');
  await assertDataScope(user, String(f.project_id), String(f.account_id), 'zhihu');
  return f;
}
export const miniFilesRouter = Router();
miniFilesRouter.use((req, _res, next) => {
  try {
    requireWechatContext(req);
    next();
  } catch (e) {
    next(e);
  }
});
miniFilesRouter.use(requireAuth);
miniFilesRouter.post(
  '/prepare',
  asyncHandler(async (req, res) => {
    const input = scope
      .extend({
        purpose: z.enum(['report', 'payment-proof', 'composition-xlsx']),
        name: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .refine((n) => !/[\\/\x00-\x1f]/.test(n)),
      })
      .parse(req.body);
    await assertDataScope(req.user, input.projectId, input.accountId, 'zhihu');
    if (input.purpose !== 'composition-xlsx') assertDuty(req.user, 'finance');
    if (!(await incrRateLimit(`mini:files:${req.user.sub}`, 20, 3600)).allowed)
      throw new AppError(429, 42900, '上传次数过多，请稍后再试');
    await db.query('DELETE FROM mini_uploads WHERE expires_at<NOW(3) LIMIT 100');
    const id = crypto.randomUUID();
    await db.query(
      'INSERT INTO mini_uploads(id,user_id,project_id,account_id,purpose,filename,expires_at) VALUES(?,?,?,?,?,?,TIMESTAMPADD(HOUR,24,NOW(3)))',
      [id, req.user.sub, input.projectId, input.accountId, input.purpose, input.name],
    );
    ok(res, { id, upload: { transport: 'cloud-function', chunkBytes: CHUNK, maxBytes: max(input.purpose) } });
  }),
);
miniFilesRouter.post(
  '/:id/upload-chunk',
  asyncHandler(async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = z
        .object({
          index: z.number().int().min(0).max(19),
          totalBytes: z
            .number()
            .int()
            .min(1)
            .max(10 * 1024 * 1024),
          base64: z
            .string()
            .max(Math.ceil(CHUNK / 3) * 4)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        })
        .parse(req.body);
    const data = Buffer.from(input.base64, 'base64');
    if (data.toString('base64') !== input.base64) throw new AppError(422, 42200, '文件分块编码不正确');
    await withTransaction(async (c) => {
      const f = await owned(c, id, req.user);
      const expected = Math.min(CHUNK, input.totalBytes - input.index * CHUNK);
      if (input.totalBytes > max(f.purpose) || expected <= 0 || data.length !== expected)
        throw new AppError(422, 42200, '文件分块长度不正确');
      if (f.total_bytes !== null && f.total_bytes !== input.totalBytes)
        throw new AppError(409, 40900, '上传内容已变化');
      const [[old]] = await c.query<RowDataPacket[]>(
        'SELECT content FROM mini_upload_chunks WHERE upload_id=? AND chunk_index=?',
        [id, input.index],
      );
      if (old) {
        if (!old.content.equals(data)) throw new AppError(409, 40900, '上传内容已变化');
        return;
      }
      if (f.finished) throw new AppError(409, 40900, '上传已经完成');
      await c.query('UPDATE mini_uploads SET total_bytes=? WHERE id=?', [input.totalBytes, id]);
      await c.query('INSERT INTO mini_upload_chunks(upload_id,chunk_index,content) VALUES(?,?,?)', [
        id,
        input.index,
        data,
      ]);
    });
    ok(res, { id, index: input.index });
  }),
);
miniFilesRouter.post(
  '/:id/finish-upload',
  asyncHandler(async (req, res) => {
    const id = uuid.parse(req.params.id);
    await withTransaction(async (c) => {
      const f = await owned(c, id, req.user);
      const [[count]] = await c.query<RowDataPacket[]>(
        'SELECT COUNT(*) count,COALESCE(SUM(OCTET_LENGTH(content)),0) size FROM mini_upload_chunks WHERE upload_id=?',
        [id],
      );
      if (
        !f.total_bytes ||
        Number(count.size) !== f.total_bytes ||
        Number(count.count) !== Math.ceil(f.total_bytes / CHUNK)
      )
        throw new AppError(409, 40900, '文件尚未传完，请重试');
      await c.query('UPDATE mini_uploads SET finished=1 WHERE id=?', [id]);
    });
    ok(res, { id, fileId: id, status: 'ready' });
  }),
);
export async function miniFile(
  user: AuthUser,
  id: string,
  projectId: string,
  accountId: string,
  purpose: string,
): Promise<Express.Multer.File> {
  const record = await withTransaction(async (c) => {
    const f = await owned(c, uuid.parse(id), user);
    if (
      !f.finished ||
      String(f.project_id) !== projectId ||
      String(f.account_id) !== accountId ||
      f.purpose !== purpose
    )
      throw new AppError(403, 40300, '文件不属于当前项目或用途');
    const [chunks] = await c.query<RowDataPacket[]>(
      'SELECT content FROM mini_upload_chunks WHERE upload_id=? ORDER BY chunk_index',
      [id],
    );
    return { f, buffer: Buffer.concat(chunks.map((c) => c.content)) };
  });
  const { f, buffer } = record;
  const mime = /\.pdf$/i.test(f.filename)
    ? 'application/pdf'
    : /\.png$/i.test(f.filename)
      ? 'image/png'
      : /\.jpe?g$/i.test(f.filename)
        ? 'image/jpeg'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return {
    originalname: f.filename,
    buffer,
    size: buffer.length,
    mimetype: mime,
    fieldname: 'file',
    encoding: '7bit',
  } as Express.Multer.File;
}
/** Reuse existing multipart controllers without opening a public file URL. */
export const attachMiniFile: RequestHandler = asyncHandler(async (req, _res, next) => {
  if (!wechatContext(req) || req.method !== 'POST' || !req.body?.fileId) return next();
  const purpose = /^\/api\/v1\/core\/finance\/withdrawals\/\d+\/pay$/.test(req.path)
    ? 'payment-proof'
    : ['/api/v1/modules/zhihu/imports', '/api/v1/modules/zhihu/workbench/import'].includes(req.path)
      ? 'report'
      : null;
  if (!purpose) return next();
  // Authenticate before accessing the upload. The canonical route authorizes the business operation again.
  await new Promise<void>((resolve, reject) => requireAuth(req, _res, (e) => (e ? reject(e) : resolve())));
  const input = scope.parse(req.body);
  req.file = await miniFile(req.user, req.body.fileId, input.projectId, input.accountId, purpose);
  if (purpose === 'payment-proof')
    req.body.acknowledged = req.body.acknowledged === true ? 'true' : req.body.acknowledged;
  next();
});
