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
const unavailable = () => new AppError(403, 40320, '暂不能使用验证码登录，请先用账号密码登录并验证手机号');
const subject = (user: RowDataPacket) =>
  createHmac('sha256', requireAccountSmsEnabled().secret)
    .update(
      JSON.stringify([String(user.id), user.password_hash, user.phone, user.phone_verified_at, user.must_change_pwd]),
    )
    .digest('hex');

async function phoneUser(number: string) {
  const [[user]] = await db.query<RowDataPacket[]>('SELECT * FROM users WHERE verified_phone_key=?', [number]);
  return user;
}
async function lockedUser(c: PoolConnection, id: string) {
  const [[user]] = await c.query<RowDataPacket[]>('SELECT * FROM users WHERE id=? FOR UPDATE', [id]);
  if (!user?.is_active) throw unavailable();
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
async function passwordVerified(id: string, number: string, value: string) {
  if (!(await incrRateLimit(`sms:phone-password:${id}`, 10, 300)).allowed)
    throw new AppError(429, 42920, '操作过于频繁，请 5 分钟后重试');
  const [[user]] = await db.query<RowDataPacket[]>('SELECT * FROM users WHERE id=?', [id]);
  if (!user || String(user.id) !== id || !(await bcrypt.compare(value, user.password_hash)))
    throw new AppError(422, 42202, '账号密码不正确，请重试');
  canVerify(user, number);
  await availablePhone(db, id, number);
  return user;
}

export const smsAuthRouter = Router();
const bindingInput = z.object({ phone, password });
const publicBindingInput = bindingInput.extend({ username: z.string().trim().min(1).max(64) });
function canBind(user: RowDataPacket, number: string) {
  if (!user.is_active || user.must_change_pwd) throw new AppError(403, 40320, '请先使用账号密码登录并完成密码设置');
  if (user.phone && user.phone !== number)
    throw new AppError(409, 40920, '请验证账号已登记的手机号，修改号码请联系管理员');
}
async function checkBinding(c: Pick<PoolConnection, 'query'>, identity: WechatIdentity, id: string, lock = false) {
  const [links] = await c.query<RowDataPacket[]>(
    'SELECT user_id,open_id FROM wechat_identities WHERE app_id=? AND (open_id=? OR user_id=?)' +
      (lock ? ' FOR UPDATE' : ''),
    [identity.appId, identity.openId, id],
  );
  if (links.some((link) => String(link.user_id) !== id || link.open_id !== identity.openId))
    throw new AppError(409, 40908, '微信或平台账号已绑定其他账号，请联系管理员处理');
  return links.length > 0;
}
async function bindingUser(
  identity: WechatIdentity,
  input: { username?: string; phone: string; password: string },
  id?: string,
  verified?: (id: string) => void,
) {
  const key = id || input.username!;
  if (
    !(await incrRateLimit(`wechat:bind:${key}`, 10, 300)).allowed ||
    !(await incrRateLimit(`wechat:bind-client:${wechatClientId(identity)}`, 20, 300)).allowed
  )
    throw new AppError(429, 42920, '操作过于频繁，请 5 分钟后重试');
  const [[user]] = await db.query<RowDataPacket[]>(
    id ? 'SELECT * FROM users WHERE id=?' : 'SELECT * FROM users WHERE username=?',
    [key],
  );
  if (!user || !(await bcrypt.compare(input.password, user.password_hash)))
    throw new AppError(401, 40102, '账号或密码错误');
  verified?.(String(user.id));
  canBind(user, input.phone);
  await availablePhone(db, String(user.id), input.phone);
  await checkBinding(db, identity, String(user.id));
  return user;
}
smsAuthRouter.get(
  '/binding-status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const identity = requireWechatContext(req);
    const [[link]] = await db.query<RowDataPacket[]>(
      'SELECT open_id FROM wechat_identities WHERE app_id=? AND user_id=?',
      [identity.appId, req.user.sub],
    );
    res.set('Cache-Control', 'no-store');
    ok(res, { bound: !!link, currentWechat: !!link && link.open_id === identity.openId });
  }),
);
for (const authenticated of [false, true]) {
  const guards = authenticated ? [requireAuth] : [];
  smsAuthRouter.post(
    authenticated ? '/bind-current-code' : '/bind-code',
    ...guards,
    asyncHandler(async (req, res) => {
      requireAccountSmsEnabled();
      const input = (authenticated ? bindingInput : publicBindingInput).strict().parse(req.body);
      const identity = requireWechatContext(req);
      const user = await bindingUser(identity, input, authenticated ? req.user.sub : undefined, (id) => {
        res.locals.miniVerifiedUserId = id;
      });
      ok(res, await sendAccountCode(input.phone, wechatClientId(identity), 'wechat_bind', subject(user)));
    }),
  );
  smsAuthRouter.post(
    authenticated ? '/bind-current' : '/bind',
    ...guards,
    asyncHandler(async (req, res) => {
      requireAccountSmsEnabled();
      const input = (authenticated ? bindingInput : publicBindingInput)
        .extend({ smsCode: code })
        .strict()
        .parse(req.body);
      const identity = requireWechatContext(req);
      const user = await bindingUser(identity, input, authenticated ? req.user.sub : undefined, (id) => {
        res.locals.miniVerifiedUserId = id;
      });
      const id = String(user.id),
        guard = subject(user);
      let verifiedAt: Date | null = null;
      const proof = await verifyAccountCode(input.phone, wechatClientId(identity), input.smsCode, 'wechat_bind', guard);
      const complete = async (c: PoolConnection) => {
        const current = await lockedUser(c, id);
        canBind(current, input.phone);
        if (subject(current) !== guard) throw new AppError(409, 40920, '账号信息已变化，请重新验证');
        await availablePhone(c, id, input.phone);
        const bound = await checkBinding(c, identity, id, true);
        await consumeAccountCode(c, proof);
        if (!bound)
          await c.query('INSERT INTO wechat_identities(app_id,open_id,user_id) VALUES(?,?,?)', [
            identity.appId,
            identity.openId,
            id,
          ]);
        await c.query('UPDATE users SET phone=?,phone_verified_at=COALESCE(phone_verified_at,NOW(3)) WHERE id=?', [
          input.phone,
          id,
        ]);
        const [[verified]] = await c.query<RowDataPacket[]>('SELECT phone_verified_at FROM users WHERE id=?', [id]);
        verifiedAt = verified.phone_verified_at;
        await writeAudit({ userId: id, action: 'auth.wechat_bind', resourceType: 'user', resourceId: id }, c);
      };
      try {
        if (authenticated) {
          await withTransaction(complete);
          ok(res, await me(req.user));
        } else {
          const result = await loginVerifiedUser(id, clientIdentity(req), req.ip, user.password_hash, complete);
          res.locals.miniVerifiedUserId = id;
          ok(res, { ...result, user: { ...result.user, phone: input.phone, phoneVerifiedAt: verifiedAt } });
        }
      } catch (error) {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY')
          throw new AppError(409, 40908, '微信或手机号已被其他账号绑定，请联系管理员核对');
        throw error;
      }
    }),
  );
}
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
    const user = loginEligible(await phoneUser(input.phone), input.phone);
    ok(res, await sendAccountCode(input.phone, wechatClientId(identity), 'login', subject(user)));
  }),
);
smsAuthRouter.post(
  '/sms-login',
  asyncHandler(async (req, res) => {
    requireAccountSmsEnabled();
    const input = z.object({ phone, smsCode: code }).strict().parse(req.body),
      identity = requireWechatContext(req);
    const user = loginEligible(await phoneUser(input.phone), input.phone),
      guard = subject(user);
    const proof = await verifyAccountCode(input.phone, wechatClientId(identity), input.smsCode, 'login', guard);
    const result = await loginVerifiedUser(
      String(user.id),
      clientIdentity(req),
      req.ip,
      user.password_hash,
      async (c) => {
        const current = loginEligible(await lockedUser(c, String(user.id)), input.phone);
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
    const user = await passwordVerified(req.user.sub, input.phone, input.password);
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
    const user = await passwordVerified(req.user.sub, input.phone, input.password),
      guard = subject(user);
    const proof = await verifyAccountCode(input.phone, wechatClientId(identity), input.smsCode, 'phone_verify', guard);
    try {
      await withTransaction(async (c) => {
        const current = await lockedUser(c, req.user.sub);
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
