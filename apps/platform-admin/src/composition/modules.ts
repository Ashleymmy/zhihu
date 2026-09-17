import type { Router, RouteRecordRaw } from 'vue-router'
import type { GlobalRole } from '@zhihu-koc/shared-contracts/core'
export async function installBusinessRoutes(router: Router, enabled: string[], role: GlobalRole = 'admin') {
  if (import.meta.env.VITE_OPC_CORE_ONLY === '1') return []
  const removers: Array<() => void> = []
  const loaders: Record<string, () => Promise<RouteRecordRaw[]>> = {
    zhihu: async () => {
      if (role === 'leader') return (await import('../../../platform-leader/src/modules/zhihu/routes')).zhihuRoutes
      if (role === 'creator') return (await import('../../../platform-creator/src/modules/zhihu/routes')).zhihuRoutes
      return (await import('../modules/zhihu/routes')).zhihuRoutes
    },
  }
  for (const id of enabled) {
    const load = loaders[id]
    if (load) for (const route of await load()) removers.push(router.addRoute('shell', route))
  }
  return removers
}
