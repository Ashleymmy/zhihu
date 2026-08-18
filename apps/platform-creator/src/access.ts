import type { AuthUser } from '@zhihu-koc/shared-contracts'
import { APP_ROLE } from './app-config'

export type WorkspaceAccess = 'ok' | 'wrong-workspace' | 'unauthenticated'

/**
 * 工作台访问判定（fail closed）：
 * 只有角色与本应用完全一致才放行；未登录、角色缺失、跨角色一律拒绝。
 */
export function checkWorkspaceAccess(user: AuthUser | null | undefined): WorkspaceAccess {
  if (!user) return 'unauthenticated'
  if (user.role !== APP_ROLE) return 'wrong-workspace'
  return 'ok'
}
