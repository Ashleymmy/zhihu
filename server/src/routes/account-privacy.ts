import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { asyncHandler, AppError } from '../middleware/errors';
import { ok } from '../utils/response';
import { closureStatus, closeAccount } from '../services/account-closure.service';
export const accountPrivacyRouter = Router();
accountPrivacyRouter.use(requireAuth);
accountPrivacyRouter.get(
  '/closure',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    ok(res, await closureStatus(req.user));
  }),
);
accountPrivacyRouter.post(
  '/closure',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        userId: z.string().regex(/^\d+$/),
        password: z.string().min(1).max(128),
        confirmation: z.literal('注销网站及小程序共用账号'),
      })
      .strict()
      .parse(req.body);
    if (input.userId !== req.user.sub) throw new AppError(409, 40900, '登录账号已变化，请重新进入注销页面');
    ok(res, await closeAccount(req.user, input.password));
  }),
);
