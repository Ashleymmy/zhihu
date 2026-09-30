import { RequestHandler } from 'express';
import { AppError } from '../middleware/errors';
import { Role } from '../types';
import { rows } from '../db';
import { normalizeRole, effectiveDuty, isStaffRole, canManageRole } from './roles';
import { clientIdentity } from './clientIdentity';
import { assertLoginSession } from './tokenSessions';
import { isDevDemoAuthUser } from '../core/demo';
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
      if (!isDevDemoAuthUser(user)) {
        const [current] = await rows<import('mysql2/promise').RowDataPacket>(
          'SELECT role,is_active,admin_duty,parent_id FROM users WHERE id=?',
          [user.sub],
        );
        const role = normalizeRole(current?.role);
        if (!current || !current.is_active || !role) throw new Error('inactive');
        // 每次请求以数据库当前身份为准，停用、降权、转团立即生效。
        user.role = role;
        user.adminDuty = effectiveDuty({ role, adminDuty: current.admin_duty }) as 'all' | 'operations' | 'finance';
        user.parentId = current.parent_id == null ? null : String(current.parent_id);
        await assertLoginSession(user.sub, user.sessionId, clientIdentity(req));
      }
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
    const allowed =
      roles.includes(req.user.role) || roles.some((role) => isStaffRole(role) && canManageRole(req.user.role, role));
    const limited =
      isStaffRole(req.user.role) &&
      effectiveDuty(req.user) !== 'all' &&
      !(roles.includes('operator') && effectiveDuty(req.user) === 'operations');
    if (!allowed || limited) return next(new AppError(403, 40301, '无权执行此操作'));
    next();
  };
