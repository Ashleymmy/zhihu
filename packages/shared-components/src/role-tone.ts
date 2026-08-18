import type { GlobalRole } from '@zhihu-koc/shared-contracts'

/** 角色 → 主题色调（展示层约定，供徽章/标签统一取色）。 */
export const ROLE_TONES: Record<GlobalRole, string> = {
  admin: '#722ed1',
  leader: '#1677ff',
  creator: '#13c2c2',
}

export function roleTone(role: GlobalRole | null | undefined): string {
  if (!role) return '#8c8c8c'
  return ROLE_TONES[role] ?? '#8c8c8c'
}
