import type { RequestHandler } from 'express';
import { incrRateLimit } from '../utils/rateLimit';
import { AppError } from './errors';
import { wechatContext, wechatClientId } from '../wechat/context';
import { verifyToken } from '../auth/jwt';

/**
 * API 级限流（在 IP 登录限流之上叠加）：
 * - 登录用户：按用户 ID 限流（默认 300 req/min）
 * - 未登录请求：按 IP 限流（默认 120 req/min，更严）
 * 敏感路由（提现/财务/密钥）可再叠加更严的独立限流。
 */
export function apiRateLimit(options: { windowSec?: number; userLimit?: number; anonLimit?: number } = {}): RequestHandler {
  const windowSec = options.windowSec ?? 60;
  const userLimit = options.userLimit ?? 300;
  const anonLimit = options.anonLimit ?? 120;
  return async (req, _res, next) => {
    try {
      // This middleware runs before router authentication. Verify the signature only
      // to select a rate-limit bucket; never populate req.user or grant access here.
      let uid = req.user?.sub;
      if (!uid && req.headers.authorization?.startsWith('Bearer ')) {
        try { uid = verifyToken(req.headers.authorization.slice(7)).sub; } catch { /* Invalid tokens use the anonymous limit. */ }
      }
      if (uid) {
        const r = await incrRateLimit(`api:user:${uid}`, userLimit, windowSec);
        if (!r.allowed) throw new AppError(429, 42901, '请求过于频繁，请稍后再试');
      } else {
        const identity = wechatContext(req);
        const ip = identity ? `wechat:${wechatClientId(identity)}` : req.ip ?? 'unknown';
        const r = await incrRateLimit(`api:anon:${ip}`, anonLimit, windowSec);
        if (!r.allowed) throw new AppError(429, 42901, '请求过于频繁，请稍后再试');
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** 敏感写操作专用更严限流（每分钟 20 次） */
export const sensitiveWriteLimit: RequestHandler = async (req, _res, next) => {
  try {
    const uid = req.user?.sub ?? req.ip ?? 'unknown';
    const r = await incrRateLimit(`api:sensitive:${uid}`, 20, 60);
    if (!r.allowed) throw new AppError(429, 42902, '敏感操作过于频繁，请稍后再试');
    next();
  } catch (e) {
    next(e);
  }
};
