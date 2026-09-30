/**
 * 角色与权限（与 server/src/auth/permissions.ts 一一对应）。
 * 任何一端新增权限时，两处必须同步——契约测试会校验一致性。
 */

export const GLOBAL_ROLES = ['developer', 'admin', 'operator', 'leader', 'creator'] as const
export type GlobalRole = (typeof GLOBAL_ROLES)[number]

export const PROJECT_MEMBER_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number]

export const ALL_PERMISSIONS = [
  'team.view',
  'team.create_member',
  'team.reset_pwd',
  'team.disable',
  'team.apply',
  'team.review',
  'team.delete',
  'project.manage',
  'audit.view',
  'module.manage',
  'staff.manage',
  'system.develop',
] as const

export type Permission = string

export const ROLE_PERMISSIONS: Record<GlobalRole, readonly Permission[]> = {
  developer: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter(p => p !== 'system.develop'),
  operator: ['team.view', 'team.create_member', 'team.reset_pwd', 'team.disable', 'team.review'],
  leader: ['team.view', 'team.create_member', 'team.reset_pwd', 'team.disable', 'team.review', 'team.delete'],
  creator: ['team.apply'],
}

export const isStaffRole = (role: unknown): boolean => role === 'developer' || role === 'admin' || role === 'operator'
export const businessRole = (role: GlobalRole): 'admin' | 'leader' | 'creator' => isStaffRole(role) ? 'admin' : role as 'leader' | 'creator'
export const ROLE_LABELS: Record<GlobalRole, string> = {developer:'开发者',admin:'管理员',operator:'运营管理员',leader:'团长',creator:'达人'}
export const ROLE_LEVELS: Record<GlobalRole, number> = {developer:50,admin:40,operator:30,leader:20,creator:10}

export function isGlobalRole(value: unknown): value is GlobalRole {
  return typeof value === 'string' && (GLOBAL_ROLES as readonly string[]).includes(value)
}

/** 权限判定以服务端下发的 permissions 为准，本函数仅用于无 permissions 时的兜底推导。 */
export function permissionsFor(role: GlobalRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]]
}

export function hasPermission(permissions: readonly string[] | undefined, permission: Permission): boolean {
  return permissions?.includes(permission) ?? false
}
