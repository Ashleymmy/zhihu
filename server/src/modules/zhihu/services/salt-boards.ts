import type { AuthUser } from '../../../types';
import { isStaffRole, effectiveDuty } from '../../../auth/roles';
import { assertDataScope } from '../../../core/accounts';
import { AppError } from '../../../middleware/errors';
import { z } from 'zod';
export const saltScope = z.object({ projectId: z.string().regex(/^\d+$/), accountId: z.string().regex(/^\d+$/) });
export async function authorizeSalt(user: AuthUser, scope: z.infer<typeof saltScope>) {
  if (!isStaffRole(user.role) || effectiveDuty(user) === 'finance')
    throw new AppError(403, 40301, '盐选榜单仅向管理员和运营开放');
  const account = await assertDataScope(user, scope.projectId, scope.accountId, 'zhihu');
  if (account.accountKey !== 'legacy') throw new AppError(409, 40901, '此项目尚未接通知乎榜单，请选择已接通的项目');
}
