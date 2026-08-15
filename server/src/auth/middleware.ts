import { RequestHandler } from 'express';
import { AppError } from '../middleware/errors';
import { Role } from '../types';
import { verifyToken } from './jwt';
import { revocationStore } from './revocation';

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    next(new AppError(401, 40100, '请先登录'));
    return;
  }
  void (async () => {
    try {
      const user = verifyToken(token);
      if (await revocationStore.isRevoked(user.jti)) throw new Error('revoked');
      req.user = user;
      req.token = token;
      next();
    } catch {
      next(new AppError(401, 40101, '登录已过期，请重新登录'));
    }
  })().catch(next);
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!roles.includes(req.user.role)) return next(new AppError(403, 40301, '无权执行此操作'));
    next();
  };
