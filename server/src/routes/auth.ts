import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { asyncHandler } from '../middleware/errors';
import { validateBody } from '../middleware/validate';
import { changePassword, login, logout, me } from '../services/auth.service';
import { ok } from '../utils/response';

const loginSchema = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(128) });
const passwordSchema = z.object({ oldPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(128) });

export const authRouter = Router();

authRouter.post('/login', validateBody(loginSchema), asyncHandler(async (req, res) => {
  ok(res, await login(req.body.username, req.body.password, req.ip));
}));
authRouter.use(requireAuth);
authRouter.get('/me', asyncHandler(async (req, res) => { ok(res, await me(req.user)); }));
authRouter.post('/logout', asyncHandler(async (req, res) => { await logout(req.user, req.ip); ok(res, null); }));
authRouter.post('/change-password', validateBody(passwordSchema), asyncHandler(async (req, res) => {
  await changePassword(req.user, req.body.oldPassword, req.body.newPassword, req.ip);
  ok(res, null);
}));
