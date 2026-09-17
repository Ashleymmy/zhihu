import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { requireAuth } from '../auth/middleware';
import { RefreshSession } from '../auth/tokenSessions';
import { asyncHandler } from '../middleware/errors';
import { validateBody } from '../middleware/validate';
import { changePassword, login, logout, me, refresh, register } from '../services/auth.service';
import { ok } from '../utils/response';

const loginSchema = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(128) });
const registerSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72),
  displayName: z.string().trim().min(1).max(64).optional(),
  phone: z.string().trim().regex(/^\+?[0-9 -]{6,20}$/).optional(),
}).strict();
const passwordSchema = z.object({ oldPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(128) });

export const REFRESH_COOKIE_NAME = 'zk_refresh';
const REFRESH_COOKIE_PATH = '/api/v1';

/** 只解析 Refresh Cookie，避免引入整站 cookie 中间件。 */
export function readRefreshCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === REFRESH_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const setRefreshCookie = (res: Response, session: RefreshSession) => {
  res.cookie(REFRESH_COOKIE_NAME, session.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    path: REFRESH_COOKIE_PATH,
    expires: session.expiresAt,
  });
};

const clearRefreshCookie = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
};

export const authRouter = Router();

authRouter.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await register(req.body, req.ip);
    ok(res, result, 201);
  }),
);
authRouter.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { refresh: session, ...result } = await login(req.body.username, req.body.password, req.ip);
    setRefreshCookie(res, session);
    ok(res, result);
  }),
);
authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const plainToken = readRefreshCookie(req);
    if (!plainToken) {
      clearRefreshCookie(res);
      res.status(401).json({ code: 40104, data: null, message: '登录已过期，请重新登录' });
      return;
    }
    try {
      const { refresh: session, ...result } = await refresh(plainToken, req.ip);
      setRefreshCookie(res, session);
      ok(res, result);
    } catch (error) {
      clearRefreshCookie(res);
      throw error;
    }
  }),
);
authRouter.use(requireAuth);
authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    ok(res, await me(req.user));
  }),
);
authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await logout(req.user, readRefreshCookie(req), req.ip);
    clearRefreshCookie(res);
    ok(res, null);
  }),
);
authRouter.post(
  '/change-password',
  validateBody(passwordSchema),
  asyncHandler(async (req, res) => {
    await changePassword(req.user, req.body.oldPassword, req.body.newPassword, req.ip);
    ok(res, null);
  }),
);
