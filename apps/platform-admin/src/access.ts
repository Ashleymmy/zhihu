import { isGlobalRole, type AuthUser } from '@zhihu-koc/shared-contracts/core'
export type WorkspaceAccess = 'ok' | 'invalid-role' | 'unauthenticated'
/** All known account roles share the same application entry. */
export function checkWorkspaceAccess(
  user: Pick<AuthUser, 'role'> | null | undefined,
): WorkspaceAccess {
  if (!user) return 'unauthenticated'
  return isGlobalRole(user.role) ? 'ok' : 'invalid-role'
}
export function isValidAccount(user: AuthUser | null | undefined): boolean {
  return checkWorkspaceAccess(user) === 'ok'
}
export function canAccessPath(user: AuthUser | null, path: string): boolean {
  if (!isValidAccount(user) || !user) return false
  path = path.toLowerCase().replace(/\/+$/, '') || '/'
  const has = (permission: string) =>
    user.permissions?.includes(permission) ?? false
  const duty = user.role === 'admin' ? (user.adminDuty ?? 'all') : 'all'
  if (
    duty === 'finance' &&
    !['/dashboard', '/finance', '/modules'].includes(path) &&
    !path.startsWith('/modules/')
  )
    return false
  if (
    duty === 'operations' &&
    (path === '/finance' ||
      path.startsWith('/system/') ||
      path === '/audit-log')
  )
    return false
  if (path === '/team') return user.role !== 'creator' && has('team.view')
  if (path === '/mcn') return user.role !== 'creator'
  if (path === '/join-team') return user.role === 'creator' && has('team.apply')
  if (path === '/profile') return user.role === 'creator'
  if (path.startsWith('/system/'))
    return user.role === 'admin' && duty === 'all'
  if (path === '/audit-log')
    return user.role === 'admin' && duty === 'all' && has('audit.view')
  return true
}
export function safeRedirect(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    /[\\\x00-\x20]/.test(value) ||
    value.startsWith('//')
  )
    return '/dashboard'
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return '/dashboard'
  }
  if (
    decoded.startsWith('//') ||
    /[\\\x00-\x20]/.test(decoded) ||
    /^\/(login|register)([/?#]|$)/.test(decoded)
  )
    return '/dashboard'
  return value
}
