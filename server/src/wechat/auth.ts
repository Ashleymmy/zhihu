import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { asyncHandler, AppError } from '../middleware/errors';
import { requireAuth } from '../auth/middleware';
import { clientIdentity } from '../auth/clientIdentity';
import { loginVerifiedUser, me, passwordLoginUser } from '../services/auth.service';
import { passwordLoginSchema, passwordLoginProof } from '../auth/password-login';
import { writeAudit } from '../services/audit.service';
import { incrRateLimit, deleteRateLimit } from '../utils/rateLimit';
import { ok } from '../utils/response';
import { requireWechatContext, wechatClientId } from './context';
import { resolveInvitationCode } from './invitations';
import { smsSignupSchema, registrationPolicy, sendSignupCode, registerWithSms } from '../services/sms-signup.service';
import { smsAuthRouter } from './sms-auth';

import { saveAvatar, ownAvatar, AVATAR_MAX_BYTES } from '../services/user-avatar.service';

export const wechatAuthRouter = Router();
wechatAuthRouter.use((req, _res, next) => {
  try {
    requireWechatContext(req);
    next();
  } catch (e) {
    next(e);
  }
});
const credentials = passwordLoginSchema;
wechatAuthRouter.use(smsAuthRouter);
wechatAuthRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = credentials.parse(req.body),
      identity = requireWechatContext(req),
      address = `wechat:${wechatClientId(identity)}`;
    if (
      !(await incrRateLimit(`login:ip:${address}`, 20, 300)).allowed ||
      !(await incrRateLimit(`wechat:login:${input.username}`, 20, 300)).allowed
    )
      throw new AppError(429, 42903, '登录请求过于频繁，请稍后再试');
    const user = await passwordLoginUser(input.username, input.loginMethod);
    if (!user || user.password_set === 0 || !(await bcrypt.compare(input.password, user.password_hash)))
      throw new AppError(401, 40102, input.loginMethod === 'phone' ? '手机号或密码错误；未设置密码可使用验证码登录' : '原账号或密码错误');
    if (!user.is_active) throw new AppError(403, 40302, '账号已停用');
    res.locals.miniVerifiedUserId = String(user.id);
    // Platform login does not authorize a persistent WeChat binding.
    await deleteRateLimit(`wechat:login:${input.username}`);
    ok(res, await loginVerifiedUser(String(user.id), clientIdentity(req), req.ip, user.password_hash,
      passwordLoginProof(String(user.id), input.username, input.loginMethod)));
  }),
);
wechatAuthRouter.post(
  '/wechat-login',
  asyncHandler(async (req, res) => {
    const identity = requireWechatContext(req);
    const [link] = await rows<RowDataPacket>('SELECT user_id FROM wechat_identities WHERE app_id=? AND open_id=?', [
      identity.appId,
      identity.openId,
    ]);
    if (!link) return ok(res, { needsBind: true });
    res.locals.miniVerifiedUserId = String(link.user_id);
    ok(res, await loginVerifiedUser(String(link.user_id), clientIdentity(req), req.ip));
  }),
);
const signup = smsSignupSchema
  .extend({
    inviteCode: z
      .string()
      .trim()
      .regex(/^[A-Z2-9]{8}$/)
      .optional(),
  })
  .strict();
wechatAuthRouter.get(
  '/registration-policy',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const code = z
      .string()
      .regex(/^[A-Z2-9]{8}$/)
      .optional()
      .parse(req.query.inviteCode);
    const invitationToken = code ? await resolveInvitationCode(code) : undefined;
    ok(res, registrationPolicy(invitationToken));
  }),
);
wechatAuthRouter.post(
  '/registration-code',
  asyncHandler(async (req, res) => {
    const identity = requireWechatContext(req);
    const input = z
      .object({
        phone: z.string().regex(/^1\d{10}$/),
        inviteCode: z
          .string()
          .regex(/^[A-Z2-9]{8}$/)
          .optional(),
      })
      .strict()
      .parse(req.body);
    // Validate invitation and existing accounts before spending an SMS. Never consume an invitation here.
    const invitationToken = input.inviteCode ? await resolveInvitationCode(input.inviteCode) : undefined;
    ok(res, await sendSignupCode(input.phone, wechatClientId(identity), invitationToken));
  }),
);
wechatAuthRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = signup.parse(req.body),
      identity = requireWechatContext(req);
    const invitationToken = input.inviteCode ? await resolveInvitationCode(input.inviteCode) : undefined;
    const result = await registerWithSms(input, wechatClientId(identity), req.ip, invitationToken);
    res.locals.miniVerifiedUserId = result.id;
    ok(res, await loginVerifiedUser(result.id, clientIdentity(req), req.ip), 201);
  }),
);
wechatAuthRouter.post(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        displayName: z.string().trim().min(1).max(64).optional(),
        contact: z.string().trim().max(128).optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0)
      .parse(req.body);
    await withTransaction(async (c) => {
      const [[active]] = await c.query<RowDataPacket[]>('SELECT is_active,closed_at FROM users WHERE id=? FOR UPDATE', [
        req.user.sub,
      ]);
      if (!active?.is_active || active.closed_at) throw new AppError(401, 40101, '账号已不可用');
      if (input.displayName !== undefined)
        await c.query('UPDATE users SET display_name=? WHERE id=?', [input.displayName, req.user.sub]);
      if (input.contact !== undefined)
        await c.query(
          'INSERT INTO wechat_profiles(user_id,contact) VALUES(?,?) ON DUPLICATE KEY UPDATE contact=VALUES(contact)',
          [req.user.sub, input.contact],
        );
      await writeAudit(
        {
          userId: req.user.sub,
          action: 'auth.profile_update',
          resourceType: 'user',
          resourceId: req.user.sub,
          detail: { fields: Object.keys(input) },
        },
        c,
      );
    });
    ok(res, { ...(await me(req.user)), ...input });
  }),
);
wechatAuthRouter.get(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [profile] = await rows<RowDataPacket>('SELECT contact FROM wechat_profiles WHERE user_id=?', [req.user.sub]);
    ok(res, { ...(await me(req.user)), contact: profile?.contact ?? '' });
  }),
);

wechatAuthRouter.post(
  '/avatar',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        base64: z
          .string()
          .min(1)
          .max(Math.ceil(AVATAR_MAX_BYTES / 3) * 4),
      })
      .strict()
      .parse(req.body);
    await saveAvatar(req.user.sub, input.base64);
    ok(res, await me(req.user));
  }),
);
wechatAuthRouter.get(
  '/avatar',
  requireAuth,
  asyncHandler(async (req, res) => {
    z.object({}).strict().parse(req.query);
    res.set('Cache-Control', 'no-store');
    ok(res, await ownAvatar(req.user.sub));
  }),
);
