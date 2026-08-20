import type { AuthUser } from '@/types/api'

export type AccessKey =
  | 'plan'
  | 'keyword'
  | 'composition'
  | 'analytics'
  | 'earnings'
  | 'callbacks'
  | 'team'
  | 'allianceAdmin'

const accessPermissions: Record<AccessKey, string> = {
  plan: 'plan.create',
  keyword: 'keyword.bind',
  composition: 'composition.create',
  analytics: 'earning.view_self',
  earnings: 'earning.view_self',
  callbacks: 'callback.config',
  team: 'team.view',
  allianceAdmin: 'project.manage',
}

export function canAccess(user: AuthUser | null, access?: AccessKey): boolean {
  if (!access) return true
  if (!user) return false
  return user.permissions?.includes(accessPermissions[access]) ?? false
}

export function workspaceLabel(role?: AuthUser['role']): string {
  if (role === 'admin') return 'Admin 管理后台'
  if (role === 'leader') return '团长 / 运营工作台'
  if (role === 'creator') return 'KOC 达人工作台'
  return '运营平台'
}
