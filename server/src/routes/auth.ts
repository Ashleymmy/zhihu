import { ownAvatar } from '../services/user-avatar.service';
import { newPasswordSchema } from '../auth/password-policy';
import { passwordLoginSchema } from '../auth/password-login';
import { createAccountSmsRouter } from '../wechat/sms-auth';
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { RefreshSession } from '../auth/tokenSessions';
import { asyncHandler } from '../middleware/errors';
import { validateBody } from '../middleware/validate';
import {
  changePassword,
  login,
  logout,
  me,
  refresh,
  setInitialPassword,
  loginVerifiedUser,
} from '../services/auth.service';
import { ok } from '../utils/response';
import { createHash } from 'node:crypto';
import { incrRateLimit } from '../utils/rateLimit';
import { AppError } from '../middleware/errors';
import { smsSignupSchema, registrationPolicy, sendSignupCode, registerWithSms } from '../services/sms-signup.service';
import { clientIdentity } from '../auth/clientIdentity';
import { invitationPreview } from '../services/invitations.service';

const loginSchema = passwordLoginSchema;
const invitationSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{43}$/)
  .optional();
const registerSchema = smsSignupSchema.extend({ invitationToken: invitationSchema }).strict();
const signupIdentity = (req: Request) =>
  createHash('sha256')
    .update('web-signup:' + clientIdentity(req).id)
    .digest('hex');
const passwordSchema = z.object({ oldPassword: z.string().min(1).max(128), newPassword: newPasswordSchema });

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

const setRefreshCookie = (req: Request, res: Response, session: RefreshSession) => {
  res.cookie(REFRESH_COOKIE_NAME, session.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: REFRESH_COOKIE_PATH,
    expires: session.expiresAt,
  });
};

const clearRefreshCookie = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
};

export const authRouter = Router();
authRouter.use(
  createAccountSmsRouter((req, res, result) => {
    const { refresh: session, ...body } = result;
    if (!session) throw new AppError(401, 40106, '请重新打开登录页面');
    setRefreshCookie(req, res, session);
    ok(res, body);
  }),
);
authRouter.post(
  '/invitation',
  validateBody(z.object({ token: z.string().regex(/^[a-zA-Z0-9_-]{43}$/) }).strict()),
  asyncHandler(async (req, res) => ok(res, await invitationPreview(req.body.token))),
);

authRouter.get(
  '/registration-policy',
  asyncHandler(async (req, res) => {
    const token = invitationSchema.parse(req.query.invitationToken);
    if (token) await invitationPreview(token);
    res.set('Cache-Control', 'no-store');
    ok(res, registrationPolicy(token));
  }),
);
authRouter.post(
  '/registration-code',
  validateBody(z.object({ phone: z.string().regex(/^1\d{10}$/), invitationToken: invitationSchema }).strict()),
  asyncHandler(async (req, res) => {
    const identity = signupIdentity(req);
    if (!(await incrRateLimit(`web-signup-sms:${req.ip}`, 10, 3600)).allowed)
      throw new AppError(429, 42920, '验证码发送过于频繁，请稍后再试');
    if (req.body.invitationToken) await invitationPreview(req.body.invitationToken);
    ok(res, await sendSignupCode(req.body.phone, identity, req.body.invitationToken));
  }),
);

authRouter.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await registerWithSms(req.body, signupIdentity(req), req.ip, req.body.invitationToken);
    const { refresh: session, ...loggedIn } = await loginVerifiedUser(result.id, clientIdentity(req), req.ip);
    if (session) setRefreshCookie(req, res, session);
    ok(res, { ...result, ...loggedIn }, 201);
  }),
);
authRouter.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { refresh: session, ...result } = await login(
      req.body.username,
      req.body.password,
      req.ip,
      clientIdentity(req),
      req.body.loginMethod,
    );
    setRefreshCookie(req, res, session);
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
      const { refresh: session, ...result } = await refresh(plainToken, req.ip, clientIdentity(req));
      setRefreshCookie(req, res, session);
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
    clearRefreshCookie(res);
    ok(res, null);
  }),
);

authRouter.post(
  '/set-password',
  validateBody(z.object({ newPassword: newPasswordSchema }).strict()),
  asyncHandler(async (req, res) => {
    await setInitialPassword(req.user, req.body.newPassword, req.ip);
    clearRefreshCookie(res);
    ok(res, null);
  }),
);

authRouter.get(
  '/avatar',
  asyncHandler(async (req, res) => {
    z.object({}).strict().parse(req.query);
    res.set('Cache-Control', 'no-store');
    ok(res, await ownAvatar(req.user.sub));
  }),
);
