import type { RequestHandler } from 'express';
import { incrRateLimit } from '../utils/rateLimit';
import { AppError } from './errors';

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
      const uid = req.user?.sub;
      if (uid) {
        const r = await incrRateLimit(`api:user:${uid}`, userLimit, windowSec);
        if (!r.allowed) throw new AppError(429, 42901, '请求过于频繁，请稍后再试');
      } else {
        const ip = req.ip ?? 'unknown';
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
