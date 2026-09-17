import type { GlobalRole } from '@zhihu-koc/shared-contracts'

/** 本角色页面的展示配置；统一入口会在登录后按服务端角色选择此配置。 */
export const APP_ROLE: GlobalRole = 'leader'

/** 顶部导航（key 同路由 name 与 i18n nav.* key）。 */
export const APP_NAV = ['overview', 'plans', 'earnings', 'team', 'projects'] as const
