import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { AuthUser, Role } from '../types';
import { effectiveDuty, isStaffRole } from '../auth/roles';
import { hasPermission } from '../auth/permissions';
import { AppError } from '../middleware/errors';
import { config } from '../config';
import { writeAudit } from './audit.service';

export const canAssignMemberProjects = (actor: AuthUser) =>
  effectiveDuty(actor) !== 'finance' && hasPermission(actor.role, 'project.manage');

/** Runs within the same transaction as profile/role changes; target and actor are already locked. */
export async function assignMemberProjects(
  c: PoolConnection,
  actor: AuthUser,
  userId: string,
  role: Role,
  projectIds: string[],
) {
  if (!canAssignMemberProjects(actor)) throw new AppError(403, 40301, '分配项目需要项目管理权限');
  if (isStaffRole(role)) throw new AppError(422, 42200, '管理角色按角色权限访问项目，无需单独分配');
  const [memberships] = await c.query<RowDataPacket[]>(
    'SELECT * FROM project_members WHERE user_id=? ORDER BY project_id FOR UPDATE',
    [userId],
  );
  const current = memberships.filter((m) => m.left_at === null);
  const wanted = new Set(projectIds);
  const added = projectIds.filter((id) => !current.some((m) => String(m.project_id) === id));
  const removed = current.filter((m) => !wanted.has(String(m.project_id)));
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
    if (config.enabledModules.includes('zhihu')) {
      const [[binding]] = await c.query<RowDataPacket[]>(
        `SELECT b.id FROM zh_keyword_bindings b JOIN zh_keywords k ON k.id=b.keyword_id
        WHERE k.project_id=? AND (b.leader_id=? OR b.executor_id=?) AND b.released_at IS NULL AND b.stop_new_use_at IS NULL LIMIT 1 FOR UPDATE`,
        [membership.project_id, userId, userId],
      );
      if (binding) throw new AppError(409, 40900, '该成员在待移除项目中仍有使用中的关键词，请先处理后再移出');
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
