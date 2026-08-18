/**
 * 角色与权限（与 server/src/auth/permissions.ts 一一对应）。
 * 任何一端新增权限时，两处必须同步——契约测试会校验一致性。
 */

export const GLOBAL_ROLES = ['admin', 'leader', 'creator'] as const
export type GlobalRole = (typeof GLOBAL_ROLES)[number]

export const PROJECT_MEMBER_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number]

export const ALL_PERMISSIONS = [
  'plan.create',
  'plan.edit',
  'plan.delete',
  'keyword.bind',
  'callback.config',
  'callback.secret',
  'composition.create',
  'composition.edit',
  'team.view',
  'team.create_member',
  'team.reset_pwd',
  'team.disable',
  'earning.view_self',
  'earning.view_team',
  'earning.view_all',
  'withdraw.apply',
  'withdraw.approve',
  'project.manage',
  'audit.view',
] as const

export type Permission = (typeof ALL_PERMISSIONS)[number]

export const ROLE_PERMISSIONS: Record<GlobalRole, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,
  leader: [
    'plan.create',
    'plan.edit',
    'plan.delete',
    'keyword.bind',
    'composition.create',
    'composition.edit',
    'team.view',
    'team.create_member',
    'team.reset_pwd',
    'team.disable',
    'earning.view_self',
    'earning.view_team',
    'withdraw.apply',
  ],
  creator: [
    'plan.create',
    'plan.edit',
    'plan.delete',
    'keyword.bind',
    'composition.create',
    'composition.edit',
    'earning.view_self',
    'withdraw.apply',
  ],
}

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
