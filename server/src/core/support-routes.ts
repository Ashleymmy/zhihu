import { Router } from 'express';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError, asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { requireDuty } from './duties';
import { writeAudit } from '../services/audit.service';

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
      ok(res, present(row));
    }),
  );
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
          await c.query(
            `UPDATE platform_support_settings SET service_url=?,business_url=?,service_hours=?,mini_contact_enabled=?,
        revision=revision+1,updated_by=?,updated_at=NOW(3) WHERE id=1`,
            [value.serviceUrl, value.businessUrl, value.serviceHours, Number(value.miniContactEnabled), req.user.sub],
          );
          await writeAudit(
            {
              userId: req.user.sub,
              action: 'support.update',
              resourceType: 'support',
              resourceId: '1',
              detail: { before: present(old), after: { ...value, revision: value.revision + 1 } },
            },
            c,
          );
          return { ...value, revision: value.revision + 1 };
        }),
      );
    }),
  );
  return router;
}
