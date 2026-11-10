import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import type { ModuleRuntime } from './module-runtime';
import { listReminders, readReminder } from './reminders';

export function createReminderRouter(runtime: ModuleRuntime) {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(20),
          state: z.enum(['unread', 'all']).default('unread'),
        })
        .strict()
        .parse(req.query);
      ok(res, await listReminders(runtime, req.user, query));
    }),
  );
  router.post(
    '/:id/read',
    asyncHandler(async (req, res) => {
      const key = z
        .string()
        .regex(/^(?:comment:[1-9]\d*|payment:[1-9]\d*:[a-f0-9]{24})$/)
        .parse(req.params.id);
      const input = z.object({ read: z.boolean() }).strict().parse(req.body);
      ok(res, await readReminder(runtime, req.user, key, input.read));
    }),
  );
  return router;
}
