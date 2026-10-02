import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { RowDataPacket, PoolConnection } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { asyncHandler, AppError } from '../middleware/errors';
import { requireAuth } from '../auth/middleware';
import { clientIdentity } from '../auth/clientIdentity';
import { register, loginVerifiedUser, me } from '../services/auth.service';
import { writeAudit } from '../services/audit.service';
import { incrRateLimit, deleteRateLimit } from '../utils/rateLimit';
import { ok } from '../utils/response';
import { requireWechatContext, wechatClientId, type WechatIdentity } from './context';
import { resolveInvitationCode } from './invitations';
import { smsSettings, requireSmsEnabled } from '../sms/config';
import { sendRegistrationCode, verifyRegistrationCode, consumeRegistrationCode } from '../sms/registration';

export async function attachWechat(c: PoolConnection, id: WechatIdentity, userId: string) {
  const [links] = await c.query<RowDataPacket[]>(
    'SELECT user_id,open_id FROM wechat_identities WHERE app_id=? AND (open_id=? OR user_id=?) FOR UPDATE',
    [id.appId, id.openId, userId],
  );
  if (links.some((link) => String(link.user_id) !== userId || link.open_id !== id.openId))
    throw new AppError(409, 40908, '微信或网站账号已绑定其他账号，请联系管理员处理');
  if (!links.length)
    await c.query('INSERT INTO wechat_identities(app_id,open_id,user_id) VALUES(?,?,?)', [id.appId, id.openId, userId]);
}

export const wechatAuthRouter = Router();
wechatAuthRouter.use((req, _res, next) => {
  try {
    requireWechatContext(req);
    next();
  } catch (e) {
    next(e);
  }
});
const credentials = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(128) });
for (const route of ['/login', '/bind'])
  wechatAuthRouter.post(
    route,
    asyncHandler(async (req, res) => {
      const input = credentials.parse(req.body),
        identity = requireWechatContext(req),
        address = `wechat:${wechatClientId(identity)}`;
      if (
        !(await incrRateLimit(`login:ip:${address}`, 20, 300)).allowed ||
        !(await incrRateLimit(`wechat:login:${input.username}`, 20, 300)).allowed
      )
        throw new AppError(429, 42903, '登录请求过于频繁，请稍后再试');
      const [user] = await rows<RowDataPacket>('SELECT id,password_hash,is_active FROM users WHERE username=?', [
        input.username,
      ]);
      if (!user || !(await bcrypt.compare(input.password, user.password_hash)))
        throw new AppError(401, 40102, '网站账号或密码错误');
      if (!user.is_active) throw new AppError(403, 40302, '账号已停用');
      res.locals.miniVerifiedUserId = String(user.id);
      await withTransaction(async (c) => {
        const [[current]] = await c.query<RowDataPacket[]>(
          'SELECT id,password_hash,is_active FROM users WHERE id=? FOR UPDATE',
          [user.id],
        );
        if (!current?.is_active || current.password_hash !== user.password_hash)
          throw new AppError(409, 40900, '账号状态已变化，请重新登录');
        await attachWechat(c, identity, String(user.id));
        await writeAudit(
          { userId: String(user.id), action: 'auth.wechat_bind', resourceType: 'user', resourceId: String(user.id) },
          c,
        );
      });
      await deleteRateLimit(`wechat:login:${input.username}`);
      ok(res, await loginVerifiedUser(String(user.id), clientIdentity(req), req.ip, user.password_hash));
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
const signup = z
  .object({
    phone: z.string().regex(/^1\d{10}$/),
    smsCode: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    password: z
      .string()
      .min(8)
      .max(72)
      .refine((p) => Buffer.byteLength(p) <= 72),
    displayName: z.string().trim().max(64).default(''),
    inviteCode: z
      .string()
      .trim()
      .regex(/^[A-Z2-9]{8}$/),
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
    ok(res, { smsRequired: smsSettings(invitationToken).enabled });
  }),
);
wechatAuthRouter.post(
  '/registration-code',
  asyncHandler(async (req, res) => {
    const identity = requireWechatContext(req);
    const input = z
      .object({ phone: z.string().regex(/^1\d{10}$/), inviteCode: z.string().regex(/^[A-Z2-9]{8}$/) })
      .strict()
      .parse(req.body);
    // Validate invitation and existing accounts before spending an SMS. Never consume an invitation here.
    const invitationToken = await resolveInvitationCode(input.inviteCode);
    requireSmsEnabled(invitationToken);
    const [existing] = await rows<RowDataPacket>('SELECT id FROM users WHERE username=? OR phone=? LIMIT 1', [
      input.phone,
      input.phone,
    ]);
    const [bound] = await rows<RowDataPacket>('SELECT user_id FROM wechat_identities WHERE app_id=? AND open_id=?', [
      identity.appId,
      identity.openId,
    ]);
    if (existing || bound) throw new AppError(409, 40920, '该手机号或微信已有账号，请使用原账号密码登录');
    ok(res, await sendRegistrationCode(input.phone, wechatClientId(identity), invitationToken));
  }),
);
wechatAuthRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = signup.parse(req.body),
      identity = requireWechatContext(req),
      address = `wechat:${wechatClientId(identity)}`;
    const invitationToken = await resolveInvitationCode(input.inviteCode);
    const required = smsSettings(invitationToken).enabled;
    if (required && !input.smsCode) throw new AppError(422, 42220, '请填写短信验证码；旧版小程序请更新后重试');
    const proof = required
      ? await verifyRegistrationCode(input.phone, wechatClientId(identity), input.smsCode!, invitationToken)
      : null;
    const result = await register(
      {
        username: input.phone,
        phone: input.phone,
        password: input.password,
        displayName: input.displayName || input.phone,
        invitationToken,
      },
      req.ip,
      async (c, id) => {
        await attachWechat(c, identity, id);
        if (proof) await consumeRegistrationCode(c, proof, id);
      },
      address,
    );
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
        contact: z.string().trim().min(1).max(128).optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0)
      .parse(req.body);
    await withTransaction(async (c) => {
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
          detail: input,
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
