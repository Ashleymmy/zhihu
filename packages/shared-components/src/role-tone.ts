import type { GlobalRole } from '@zhihu-koc/shared-contracts'

/** 角色 → 主题色调（展示层约定，供徽章/标签统一取色）。 */
export const ROLE_TONES: Record<GlobalRole, string> = {
  developer: '#6e4fa8',
  operator: '#a86a12',
  admin: '#b5532f',
  leader: '#2d63ae',
  creator: '#2f7d4f',
}

export function roleTone(role: GlobalRole | null | undefined): string {
  if (!role) return '#87867f'
  return ROLE_TONES[role] ?? '#87867f'
}
