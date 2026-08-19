import type { GlobalRole } from '@zhihu-koc/shared-contracts'

/** 本应用允许的全局角色——三端各自锁定一个角色，跨角色登录 fail closed。 */
export const APP_ROLE: GlobalRole = 'creator'

/** 顶部导航（key 同路由 name 与 i18n nav.* key）。 */
export const APP_NAV = ['overview', 'plans', 'earnings', 'projects'] as const
