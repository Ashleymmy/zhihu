import type { RequestHandler } from 'express';
import type { AuthUser } from '../../../types';
import { isStaffRole } from '../../../auth/roles';
import { assertDuty } from '../../../core/duties';
import { AppError } from '../../../middleware/errors';

export function assertLegacyFinanceRead(user: AuthUser) {
  if (isStaffRole(user.role)) assertDuty(user, 'finance');
}
export function legacyOwnerScope(user: AuthUser, column: string) {
  assertLegacyFinanceRead(user);
  return isStaffRole(user.role)
    ? { clause: '1=1', bindings: [] as unknown[] }
    : { clause: column + '=?', bindings: [user.sub] as unknown[] };
}
export const legacyFinanceReadOnly: RequestHandler = (req, _res, next) => {
  try {
    assertLegacyFinanceRead(req.user);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      throw new AppError(410, 41001, '历史账目仅供查询，请到财务或我的收益办理。');
    next();
  } catch (error) {
    next(error);
  }
};
