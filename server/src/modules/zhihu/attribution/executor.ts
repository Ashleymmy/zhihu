import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../../../types';
import { isStaffRole } from '../../../auth/roles';
import { assertDuty } from '../../../core/duties';
import { fail, type Scope } from './domain';
import { select } from './store';

// Staff act only for themselves. Regular executors still need active membership.
export async function resolveExecutor(c: PoolConnection, user: AuthUser, scope: Scope, id: string) {
  const [target] = await select(c, `SELECT u.id,u.role,u.parent_id,u.display_name,u.admin_duty,u.is_active,
    EXISTS(SELECT 1 FROM project_members pm WHERE pm.user_id=u.id AND pm.project_id=? AND pm.left_at IS NULL) project_member
    FROM users u WHERE u.id=? FOR SHARE`, [scope.projectId,id]);
  if (!target?.is_active) fail('请选择当前项目的有效执行人',403);
  if (isStaffRole(String(target.role))) {
    if (id!==user.sub || target.role!==user.role) fail('管理员只能选择本人执行',403);
    assertDuty({...user,adminDuty:target.admin_duty as AuthUser['adminDuty']},'operations');
  } else if (!Number(target.project_member) || !['leader','creator'].includes(String(target.role))) {
    fail('请选择本项目有效的团长或达人',403);
  }
  return target;
}

export const internalPerformance = (relation: string) => relation==='activation:staff_self' || relation==='new_user:staff_self';
