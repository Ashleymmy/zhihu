import { Router } from 'express';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError, asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { requireDuty } from './duties';
import { writeAudit } from '../services/audit.service';
import { createHash } from 'node:crypto';
import { avatarImage, AVATAR_MAX_BYTES } from '../services/user-avatar.service';

const channel = z.enum(['wechat', 'feishu']);
const qrInput = z.object({
  channel,
  name: z.string().trim().max(80),
  version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  mimeType: z.enum(['image/png', 'image/jpeg']).optional(),
  base64: z.string().max(Math.ceil(AVATAR_MAX_BYTES / 3) * 4).optional(),
}).strict();
const qrPresent = (r: RowDataPacket) => ({ channel: r.channel, name: r.contact_name, version: r.content_hash, mimeType: r.mime_type });

export function isSupportLink(value: string): boolean {
  if (!value) return true;
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      ['feishu.cn', 'larksuite.com', 'larkoffice.com'].some(
        (host) => u.hostname === host || u.hostname.endsWith('.' + host),
      )
    );
  } catch {
    return false;
  }
}
const link = z.string().trim().max(2048).refine(isSupportLink, '请填写 HTTPS 飞书链接');
const input = z
  .object({
    serviceUrl: link,
    businessUrl: link,
    serviceHours: z.string().trim().max(100),
    miniContactEnabled: z.boolean(),
    revision: z.number().int().nonnegative(),
    businessQrCodes: z.array(qrInput).max(2).refine(items => new Set(items.map(item => item.channel)).size === items.length, '每种联系方式只能设置一个二维码').optional(),
  })
  .strict();
const present = (r: RowDataPacket) => ({
  serviceUrl: r.service_url,
  businessUrl: r.business_url,
  serviceHours: r.service_hours,
  miniContactEnabled: !!r.mini_contact_enabled,
  revision: Number(r.revision),
});

export function createSupportRouter() {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.set('Cache-Control', 'no-store');
      const [row] = await rows<RowDataPacket>('SELECT * FROM platform_support_settings WHERE id=1');
      const images = await rows<RowDataPacket>('SELECT channel,contact_name,content_hash,mime_type FROM platform_support_qrcodes ORDER BY channel DESC');
      ok(res, { ...present(row), businessQrCodes: images.map(qrPresent) });
    }),
  );
  router.get('/business-qrcodes/:channel', asyncHandler(async (req, res) => {
    const [image] = await rows<RowDataPacket>('SELECT * FROM platform_support_qrcodes WHERE channel=?', [channel.parse(req.params.channel)]);
    if (!image) throw new AppError(404, 40400, '此联系方式已更新，请刷新后查看');
    res.set('Cache-Control', 'no-store');
    ok(res, { ...qrPresent(image), base64: (image.content as Buffer).toString('base64') });
  }));
  router.put(
    '/',
    requireDuty('staff'),
    asyncHandler(async (req, res) => {
      const value = input.parse(req.body);
      ok(
        res,
        await withTransaction(async (c) => {
          const [[old]] = await c.query<RowDataPacket[]>(
            'SELECT * FROM platform_support_settings WHERE id=1 FOR UPDATE',
          );
          if (Number(old.revision) !== value.revision) throw new AppError(409, 40900, '设置已被更新，请刷新后再保存');
          const [previous] = await c.query<RowDataPacket[]>('SELECT * FROM platform_support_qrcodes FOR UPDATE');
          // Omitted by older clients: preserve configured images. An explicit empty list removes them.
          if (value.businessQrCodes !== undefined) {
            const prepared = value.businessQrCodes.map(item => {
              if (item.base64 !== undefined) {
                let image;
                try { image = avatarImage(item.base64); }
                catch { throw new AppError(422, 42200, '请选择完整的 JPG 或 PNG 二维码，大小不超过 256 KB，长宽不超过 2048 像素'); }
                return { ...item, content: image.buffer, mime: image.mime, hash: createHash('sha256').update(image.buffer).digest('hex') };
              }
              const existing = previous.find(r => r.channel === item.channel && r.content_hash === item.version);
              if (!existing) throw new AppError(409, 40900, '二维码已更新，请刷新后重新选择');
              return { ...item, content: existing.content as Buffer, mime: String(existing.mime_type), hash: String(existing.content_hash) };
            });
            await c.query('DELETE FROM platform_support_qrcodes');
            for (const item of prepared) await c.query(
              'INSERT INTO platform_support_qrcodes(channel,contact_name,mime_type,content,content_hash,updated_by) VALUES(?,?,?,?,?,?)',
              [item.channel, item.name, item.mime, item.content, item.hash, req.user.sub],
            );
          }
          await c.query(
            `UPDATE platform_support_settings SET service_url=?,business_url=?,service_hours=?,mini_contact_enabled=?,
        revision=revision+1,updated_by=?,updated_at=NOW(3) WHERE id=1`,
            [value.serviceUrl, value.businessUrl, value.serviceHours, Number(value.miniContactEnabled), req.user.sub],
          );
          const [current] = await c.query<RowDataPacket[]>('SELECT channel,contact_name,content_hash,mime_type FROM platform_support_qrcodes ORDER BY channel DESC');
          const after = { ...present(old), ...value, businessQrCodes: current.map(qrPresent), revision: value.revision + 1 };
          await writeAudit(
            {
              userId: req.user.sub,
              action: 'support.update',
              resourceType: 'support',
              resourceId: '1',
              detail: { before: { ...present(old), businessQrCodes: previous.map(qrPresent) }, after },
            },
            c,
          );
          return after;
        }),
      );
    }),
  );
  return router;
}
