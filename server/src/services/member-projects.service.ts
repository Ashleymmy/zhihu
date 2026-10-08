import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { AuthUser, Role } from '../types';
import { effectiveDuty, isStaffRole } from '../auth/roles';
import { hasPermission } from '../auth/permissions';
import { AppError } from '../middleware/errors';
import type { ModuleRuntime } from '../core/module-runtime';
import { lifecycleProviders } from '../core/account-lifecycle';
import { writeAudit } from './audit.service';

export const canAssignMemberProjects = (actor: AuthUser) =>
  effectiveDuty(actor) !== 'finance' && (isStaffRole(actor.role) || actor.role === 'leader');

/** Runs within the same transaction as profile/role changes; target and actor are already locked. */
export async function assignMemberProjects(
  c: PoolConnection,
  actor: AuthUser,
  userId: string,
  role: Role,
  projectIds: string[],
  runtime: ModuleRuntime,
) {
  if (!canAssignMemberProjects(actor)) throw new AppError(403, 40301, '无权分配成员项目');
  if (isStaffRole(role)) throw new AppError(422, 42200, '管理角色按角色权限访问项目，无需单独分配');
  // Recheck the team boundary here as well as in member-access. Never trust submitted project IDs.
  let leaderScope: Set<string> | null = null;
  if (actor.role === 'leader') {
    const [[member]] = await c.query<RowDataPacket[]>('SELECT role,parent_id FROM users WHERE id=? FOR UPDATE', [
      userId,
    ]);
    if (
      userId === actor.sub ||
      role !== 'creator' ||
      member?.role !== 'creator' ||
      String(member.parent_id) !== actor.sub
    )
      throw new AppError(403, 40301, '只能为本人团队的达人分配项目');
    const [available] = await c.query<RowDataPacket[]>(
      `SELECT pm.project_id FROM project_members pm JOIN projects p ON p.id=pm.project_id
       WHERE pm.user_id=? AND pm.left_at IS NULL AND p.is_enabled=1 ORDER BY pm.project_id FOR UPDATE`,
      [actor.sub],
    );
    leaderScope = new Set(available.map((p) => String(p.project_id)));
  }
  const [memberships] = await c.query<RowDataPacket[]>(
    'SELECT * FROM project_members WHERE user_id=? ORDER BY project_id FOR UPDATE',
    [userId],
  );
  const current = memberships.filter((m) => m.left_at === null);
  const wanted = new Set(projectIds);
  const added = projectIds.filter((id) => !current.some((m) => String(m.project_id) === id));
  if (leaderScope && added.some((id) => !leaderScope.has(id)))
    throw new AppError(403, 40301, '只能分配自己已加入且启用中的项目，请刷新后重试');
  // Full-list edits from a leader must preserve grants outside their current scope.
  const removed = current.filter(
    (m) => !wanted.has(String(m.project_id)) && (!leaderScope || leaderScope.has(String(m.project_id))),
  );
  if (!added.length && !removed.length) return false;
  if (added.length) {
    const [projects] = await c.query<RowDataPacket[]>(
      `SELECT id,is_enabled FROM projects WHERE id IN (${added.map(() => '?').join(',')}) ORDER BY id FOR SHARE`,
      added,
    );
    if (projects.length !== added.length || projects.some((p) => !p.is_enabled))
      throw new AppError(422, 42200, '所选项目不存在或已停用，请刷新后重试');
  }
  for (const membership of removed) {
    if (membership.member_role === 'owner')
      throw new AppError(409, 40900, '不能在此移除项目负责人，请先在项目管理中调整负责人');
    if (membership.member_role === 'admin' && !hasPermission(actor.role, 'project.manage'))
      throw new AppError(403, 40301, '项目管理员权限需由管理员在项目管理中调整');
    for (const provider of await lifecycleProviders(c, runtime)) {
      const reasons = await provider.accessChangeBlockers?.(c, userId, String(membership.project_id));
      if (reasons?.length) throw new AppError(409, 40900, reasons.join('；'));
    }
    await c.query('UPDATE project_members SET left_at=NOW(3) WHERE id=?', [membership.id]);
    await writeAudit(
      {
        userId: actor.sub,
        action: 'project.member_remove',
        resourceType: 'project',
        resourceId: String(membership.project_id),
        detail: { userId, source: 'member.edit' },
      },
      c,
    );
  }
  for (const projectId of added) {
    // Existing memberships keep their role; newly granted access is ordinary membership.
    const old = memberships.find((m) => String(m.project_id) === projectId);
    if (old)
      await c.query("UPDATE project_members SET left_at=NULL,joined_at=NOW(3),member_role='member' WHERE id=?", [
        old.id,
      ]);
    else
      await c.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES(?,?,'member')", [
        projectId,
        userId,
      ]);
    await writeAudit(
      {
        userId: actor.sub,
        action: 'project.member_add',
        resourceType: 'project',
        resourceId: projectId,
        detail: { userId, memberRole: 'member', source: 'member.edit' },
      },
      c,
    );
  }
  return true;
}
