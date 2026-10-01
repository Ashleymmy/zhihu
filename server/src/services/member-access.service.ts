import type { RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import type { AuthUser, Role } from '../types';
import { canManageRole, effectiveDuty, isStaffRole, normalizeRole } from '../auth/roles';
import { permissionsFor } from '../auth/permissions';
import { AppError } from '../middleware/errors';
import { config } from '../config';
import { writeAudit } from './audit.service';
import { assignMemberProjects, canAssignMemberProjects } from './member-projects.service';
import { memberClientInfo } from './member-clients.service';

const roles: Role[] = ['developer', 'admin', 'operator', 'leader', 'creator'];
type MemberRecord = RowDataPacket & { id: string; role: string; is_active: number; parent_id?: string | null };
export function canManageMember(actor: AuthUser, member: { id: unknown; role: unknown; parent_id?: unknown }) {
  if (String(member.id) === actor.sub || effectiveDuty(actor) === 'finance') return false;
  const role = normalizeRole(member.role);
  if (!role) return false;
  if (actor.role === 'leader') return role === 'creator' && String(member.parent_id) === actor.sub;
  return (
    actor.role === 'developer' ||
    (canManageRole(actor.role, role) && (!isStaffRole(role) || effectiveDuty(actor) === 'all'))
  );
}
export function editableMemberRoles(actor: AuthUser) {
  return actor.role === 'leader'
    ? ['creator']
    : roles.filter(
        (role) =>
          actor.role === 'developer' ||
          (canManageRole(actor.role, role) && (!isStaffRole(role) || effectiveDuty(actor) === 'all')),
      );
}
export async function listManagedMembers(actor: AuthUser) {
  const list = await rows<MemberRecord>(
    `SELECT CAST(u.id AS CHAR) id,u.username,u.role,u.parent_id,u.display_name,u.phone,u.admin_duty,u.is_active,u.must_change_pwd,u.last_login_at,u.created_at,
    creator.display_name created_by_name,leader.display_name parent_name,inviter.display_name inviter_name,invitation.label invitation_label,iu.registered_at invited_at,
    (SELECT COUNT(*) FROM users child WHERE child.parent_id=u.id) member_count,
    (SELECT COUNT(*) FROM project_members pm WHERE pm.user_id=u.id AND pm.left_at IS NULL) project_count,
    (SELECT COUNT(*) FROM member_invitations mi JOIN member_invitation_uses mu ON mu.invitation_id=mi.id WHERE mi.owner_user_id=u.id) invited_count,
    CASE WHEN iu.user_id IS NOT NULL THEN 'invitation' WHEN u.created_by IS NOT NULL THEN 'managed' ELSE 'registered' END registration_source
    FROM users u LEFT JOIN users creator ON creator.id=u.created_by LEFT JOIN users leader ON leader.id=u.parent_id
    LEFT JOIN member_invitation_uses iu ON iu.user_id=u.id LEFT JOIN member_invitations invitation ON invitation.id=iu.invitation_id
    LEFT JOIN users inviter ON inviter.id=invitation.owner_user_id
    WHERE ${isStaffRole(actor.role) ? '1=1' : 'u.id=? OR u.parent_id=?'} ORDER BY u.created_at DESC,u.id DESC`,
    isStaffRole(actor.role) ? [] : [actor.sub, actor.sub],
  );
  const memberships = await rows<RowDataPacket>(`SELECT CAST(pm.user_id AS CHAR) user_id,CAST(p.id AS CHAR) id,p.name,p.is_enabled,pm.member_role
    FROM project_members pm JOIN projects p ON p.id=pm.project_id JOIN users u ON u.id=pm.user_id
    WHERE pm.left_at IS NULL AND ${isStaffRole(actor.role) ? '1=1' : '(u.id=? OR u.parent_id=?)'} ORDER BY p.id`, isStaffRole(actor.role) ? [] : [actor.sub,actor.sub]);
  const clients = await memberClientInfo(list.map(member => String(member.id)));
  return list.map((member) => ({
    ...member,
    miniProgram: clients.get(String(member.id)),
    projects: memberships.filter(p => String(p.user_id) === String(member.id)).map(p => ({id:String(p.id),name:p.name,isEnabled:Boolean(p.is_enabled),memberRole:p.member_role})),
    canAssignProjects: canManageMember(actor,member) && canAssignMemberProjects(actor),
    canManage: canManageMember(actor, member),
    editableRoles: canManageMember(actor, member) ? editableMemberRoles(actor) : [],
    permissions: permissionsFor(normalizeRole(member.role)!).filter((p) =>
      member.admin_duty === 'finance'
        ? p === 'audit.view'
        : member.admin_duty === 'operations'
          ? !['staff.manage', 'system.develop'].includes(p)
          : true,
    ),
  }));
}
export interface MemberAccessPatch {
  displayName?: string;
  phone?: string | null;
  role?: Role;
  adminDuty?: 'all' | 'operations' | 'finance';
  isActive?: boolean;
  parentId?: string | null;
  projectIds?: string[];
}
export async function updateMemberAccess(auth: AuthUser, id: string, patch: MemberAccessPatch) {
  await withTransaction(async (c) => {
    const [locked] = await c.query<MemberRecord[]>(
      "SELECT * FROM users WHERE id IN (?,?,?) OR role='developer' ORDER BY id FOR UPDATE",
      [auth.sub, id, patch.parentId ?? null],
    );
    const actor = locked.find((u) => String(u.id) === auth.sub),
      member = locked.find((u) => String(u.id) === id);
    const actorRole = normalizeRole(actor?.role);
    if (!actor?.is_active || !actorRole || !member) throw new AppError(403, 40301, '账号不存在或管理权限已变化');
    const current = { ...auth, role: actorRole, adminDuty: actor.admin_duty };
    if (!canManageMember(current, member)) throw new AppError(403, 40301, '不能修改自己、同级或更高权限的账号');
    const role = patch.role ?? normalizeRole(member.role)!;
    if (!editableMemberRoles(current).includes(role)) throw new AppError(403, 40301, '不能授予此角色');
    if (patch.adminDuty !== undefined && (role !== 'admin' || current.role !== 'developer'))
      throw new AppError(403, 40301, '只有开发者可调整管理员职责');
    const active = patch.isActive ?? Boolean(member.is_active);
    if (
      member.role === 'developer' &&
      (!active || role !== 'developer') &&
      locked.filter((u) => u.role === 'developer' && u.is_active).length <= 1
    )
      throw new AppError(409, 40900, '至少保留一位有效开发者');
    let parentId =
      patch.parentId === undefined ? (member.parent_id == null ? null : String(member.parent_id)) : patch.parentId;
    if (role !== 'creator' && role !== member.role) parentId = null;
    if (patch.parentId !== undefined && parentId !== (member.parent_id == null ? null : String(member.parent_id))) {
      if (!isStaffRole(current.role) || role !== 'creator')
        throw new AppError(403, 40301, '只有运营管理角色可调整达人的所属团队');
      const leader = locked.find((u) => String(u.id) === parentId);
      if (parentId && (!leader?.is_active || leader.role !== 'leader' || parentId === id))
        throw new AppError(422, 42200, '请选择有效的团长');
    }
    const changesBusinessRole = role !== member.role && (!isStaffRole(role) || !isStaffRole(member.role));
    const changesTeam = parentId !== (member.parent_id == null ? null : String(member.parent_id));
    if (changesBusinessRole || changesTeam) {
      const [[children]] = await c.query<RowDataPacket[]>('SELECT id FROM users WHERE parent_id=? LIMIT 1 FOR UPDATE', [
        id,
      ]);
      if (children) throw new AppError(409, 40900, '该账号名下仍有团队成员，请先调整成员归属');
      if (config.enabledModules.includes('zhihu')) {
        const [[binding]] = await c.query<RowDataPacket[]>(
          'SELECT id FROM zh_keyword_bindings WHERE (leader_id=? OR executor_id=?) AND released_at IS NULL AND stop_new_use_at IS NULL LIMIT 1 FOR UPDATE',
          [id, id],
        );
        if (binding) throw new AppError(409, 40900, '该账号仍有使用中的关键词，请先结束或退回后再调整角色或团队');
      }
    }
    const duty =
      role === 'developer'
        ? 'all'
        : role === 'operator'
          ? 'operations'
          : role === 'admin'
            ? (patch.adminDuty ?? (member.role === 'admin' ? member.admin_duty : 'all'))
            : 'all';
    await c.query(
      'UPDATE users SET display_name=?,phone=?,role=?,role_id=(SELECT id FROM roles WHERE role_key=?),admin_duty=?,is_active=?,parent_id=? WHERE id=?',
      [
        patch.displayName ?? member.display_name,
        patch.phone === undefined ? member.phone : patch.phone,
        role,
        role,
        duty,
        active ? 1 : 0,
        parentId,
        id,
      ],
    );
    const projectsChanged = patch.projectIds !== undefined ? await assignMemberProjects(c,current,id,role,patch.projectIds) : false;
    if (role !== member.role || duty !== member.admin_duty || active !== Boolean(member.is_active) || changesTeam || projectsChanged) {
      await c.query(
        "UPDATE login_sessions SET revoked_at=NOW(3),revoke_reason='member_access_changed' WHERE user_id=? AND revoked_at IS NULL",
        [id],
      );
      await c.query(
        "UPDATE token_sessions SET revoked_at=NOW(3),revoke_reason='member_access_changed' WHERE user_id=? AND revoked_at IS NULL",
        [id],
      );
    }
    await writeAudit(
      {
        userId: auth.sub,
        action: 'user.access_update',
        resourceType: 'user',
        resourceId: id,
        detail: { from: member.role, to: role, duty, isActive: active, parentId, projectsChanged },
      },
      c,
    );
  });
}
