/**
 * 权限常量 — 与 server/src/auth/permissions.ts 保持同步
 */
export const Perms = {
  // 计划
  PLAN_CREATE: 'plan.create',
  PLAN_EDIT:   'plan.edit',
  PLAN_DELETE: 'plan.delete',
  // 词条
  KEYWORD_BIND: 'keyword.bind',
  // 作品
  COMPOSITION_CREATE: 'composition.create',
  COMPOSITION_EDIT:   'composition.edit',
  // 回调
  CALLBACK_CONFIG: 'callback.config',
  CALLBACK_SECRET: 'callback.secret',
  // 团队
  TEAM_VIEW:          'team.view',
  TEAM_CREATE_MEMBER: 'team.create_member',
  TEAM_RESET_PWD:     'team.reset_pwd',
  TEAM_DISABLE:       'team.disable',
  // 收益
  EARNING_VIEW_SELF: 'earning.view_self',
  EARNING_VIEW_TEAM: 'earning.view_team',
  EARNING_VIEW_ALL:  'earning.view_all',
  // 提现
  WITHDRAW_APPLY:   'withdraw.apply',
  WITHDRAW_APPROVE: 'withdraw.approve',
  // 运营
  PROJECT_MANAGE: 'project.manage',
  AUDIT_VIEW:     'audit.view',
} as const

export type PermKey = typeof Perms[keyof typeof Perms]

/**
 * usePermission composable
 *
 * 用法：
 *   const { can, cannot } = usePermission()
 *   v-if="can(Perms.PLAN_CREATE)"
 *   v-if="cannot(Perms.WITHDRAW_APPROVE)"
 */
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

export function usePermission() {
  const auth = useAuthStore()

  const can = (permission: PermKey | string): boolean =>
    auth.user?.permissions?.includes(permission) ?? false

  const cannot = (permission: PermKey | string): boolean => !can(permission)

  // 快捷计算属性
  const canManagePlans      = computed(() => can(Perms.PLAN_CREATE))
  const canManageTeam       = computed(() => can(Perms.TEAM_VIEW))
  const canApproveWithdraw  = computed(() => can(Perms.WITHDRAW_APPROVE))
  const canViewTeamEarnings = computed(() => can(Perms.EARNING_VIEW_TEAM))
  const canManageCallbacks  = computed(() => can(Perms.CALLBACK_CONFIG))
  const canManageProject    = computed(() => can(Perms.PROJECT_MANAGE))
  const canViewAudit        = computed(() => can(Perms.AUDIT_VIEW))

  return {
    can, cannot,
    canManagePlans, canManageTeam, canApproveWithdraw,
    canViewTeamEarnings, canManageCallbacks, canManageProject, canViewAudit,
  }
}
