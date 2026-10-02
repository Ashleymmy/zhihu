import { Router } from 'express';
import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db, withTransaction } from '../db';
import { asyncHandler, AppError } from '../middleware/errors';
import { requireAuth } from '../auth/middleware';
import { clientIdentity } from '../auth/clientIdentity';
import { loginVerifiedUser, me } from '../services/auth.service';
import { writeAudit } from '../services/audit.service';
import { incrRateLimit } from '../utils/rateLimit';
import { ok } from '../utils/response';
import { requireWechatContext, wechatClientId, type WechatIdentity } from './context';
import { smsSettings, requireAccountSmsEnabled } from '../sms/config';
import { sendAccountCode, verifyAccountCode, consumeAccountCode } from '../sms/registration';

const phone = z.string().regex(/^1\d{10}$/);
const code = z.string().regex(/^\d{6}$/);
const password = z.string().min(1).max(128);
const unavailable = () =>
  new AppError(403, 40320, '暂不能使用验证码登录，请先用账号密码登录，完成微信绑定和手机号验证');
const subject = (user: RowDataPacket) =>
  createHmac('sha256', requireAccountSmsEnabled().secret)
    .update(
      JSON.stringify([String(user.id), user.password_hash, user.phone, user.phone_verified_at, user.must_change_pwd]),
    )
    .digest('hex');

async function boundUser(identity: WechatIdentity) {
  const [[user]] = await db.query<RowDataPacket[]>(
    'SELECT u.* FROM users u JOIN wechat_identities w ON w.user_id=u.id WHERE w.app_id=? AND w.open_id=?',
    [identity.appId, identity.openId],
  );
  return user;
}
async function lockedUser(c: PoolConnection, id: string, identity: WechatIdentity) {
  const [[user]] = await c.query<RowDataPacket[]>('SELECT * FROM users WHERE id=? FOR UPDATE', [id]);
  const [[link]] = await c.query<RowDataPacket[]>(
    'SELECT user_id FROM wechat_identities WHERE app_id=? AND open_id=? FOR UPDATE',
    [identity.appId, identity.openId],
  );
  if (!user?.is_active || String(link?.user_id) !== id) throw unavailable();
  return user;
}
function loginEligible(user: RowDataPacket | undefined, number: string) {
  if (!user?.is_active || user.must_change_pwd || !user.phone_verified_at || user.phone !== number) throw unavailable();
  return user;
}
function canVerify(user: RowDataPacket, number: string) {
  if (!user.is_active || user.must_change_pwd) throw new AppError(403, 40320, '请先使用账号密码登录并完成密码设置');
  if (user.phone_verified_at) throw new AppError(409, 40920, '手机号已经验证，修改号码请联系管理员');
  if (user.phone && user.phone !== number)
    throw new AppError(409, 40920, '请验证账号已登记的手机号，修改号码请联系管理员');
}
async function availablePhone(c: Pick<PoolConnection, 'query'>, id: string, number: string) {
  const [[other]] = await c.query<RowDataPacket[]>(
    'SELECT id FROM users WHERE id<>? AND (phone=? OR username=?) LIMIT 1',
    [id, number, number],
  );
  if (other) throw new AppError(409, 40920, '该手机号已被其他账号使用，请联系管理员核对');
}
async function passwordVerified(id: string, identity: WechatIdentity, number: string, value: string) {
  if (!(await incrRateLimit(`sms:phone-password:${id}`, 10, 300)).allowed)
    throw new AppError(429, 42920, '操作过于频繁，请 5 分钟后重试');
  const user = await boundUser(identity);
  if (!user || String(user.id) !== id || !(await bcrypt.compare(value, user.password_hash)))
    throw new AppError(422, 42202, '账号密码不正确，请重试');
  canVerify(user, number);
  await availablePhone(db, id, number);
  return user;
}

export const smsAuthRouter = Router();
smsAuthRouter.get(
  '/sms-policy',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    ok(res, { smsLoginEnabled: smsSettings().loginEnabled });
  }),
);
smsAuthRouter.post(
  '/login-code',
  asyncHandler(async (req, res) => {
    requireAccountSmsEnabled();
    const input = z.object({ phone }).strict().parse(req.body),
      identity = requireWechatContext(req);
    const user = loginEligible(await boundUser(identity), input.phone);
    ok(res, await sendAccountCode(input.phone, wechatClientId(identity), 'login', subject(user)));
  }),
);
smsAuthRouter.post(
  '/sms-login',
  asyncHandler(async (req, res) => {
    requireAccountSmsEnabled();
    const input = z.object({ phone, smsCode: code }).strict().parse(req.body),
      identity = requireWechatContext(req);
    const user = loginEligible(await boundUser(identity), input.phone),
      guard = subject(user);
    const proof = await verifyAccountCode(input.phone, wechatClientId(identity), input.smsCode, 'login', guard);
    const result = await loginVerifiedUser(
      String(user.id),
      clientIdentity(req),
      req.ip,
      user.password_hash,
      async (c) => {
        const current = loginEligible(await lockedUser(c, String(user.id), identity), input.phone);
        if (subject(current) !== guard) throw unavailable();
        // Consumption and session creation commit together; a replay can never issue another session.
        await consumeAccountCode(c, proof);
        await writeAudit(
          { userId: String(user.id), action: 'auth.sms_login', resourceType: 'user', resourceId: String(user.id) },
          c,
        );
      },
    );
    res.locals.miniVerifiedUserId = String(user.id);
    ok(res, result);
  }),
);
smsAuthRouter.post(
  '/phone-code',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireAccountSmsEnabled();
    const input = z.object({ phone, password }).strict().parse(req.body),
      identity = requireWechatContext(req);
    const user = await passwordVerified(req.user.sub, identity, input.phone, input.password);
    ok(res, await sendAccountCode(input.phone, wechatClientId(identity), 'phone_verify', subject(user)));
  }),
);
smsAuthRouter.post(
  '/verify-phone',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireAccountSmsEnabled();
    const input = z.object({ phone, password, smsCode: code }).strict().parse(req.body),
      identity = requireWechatContext(req);
    const user = await passwordVerified(req.user.sub, identity, input.phone, input.password),
      guard = subject(user);
    const proof = await verifyAccountCode(input.phone, wechatClientId(identity), input.smsCode, 'phone_verify', guard);
    try {
      await withTransaction(async (c) => {
        const current = await lockedUser(c, req.user.sub, identity);
        canVerify(current, input.phone);
        if (subject(current) !== guard) throw new AppError(409, 40920, '账号信息已变化，请重新验证');
        await availablePhone(c, req.user.sub, input.phone);
        await consumeAccountCode(c, proof);
        await c.query('UPDATE users SET phone=?,phone_verified_at=NOW(3) WHERE id=?', [input.phone, req.user.sub]);
        await writeAudit(
          { userId: req.user.sub, action: 'auth.phone_verified', resourceType: 'user', resourceId: req.user.sub },
          c,
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY')
        throw new AppError(409, 40920, '该手机号已被其他账号验证，请联系管理员核对');
      throw error;
    }
    ok(res, await me(req.user));
  }),
);
