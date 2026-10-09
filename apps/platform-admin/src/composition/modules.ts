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
    if (load) {
      const routes = await load()
      for (const route of routes) removers.push(router.addRoute('shell', route))
      // Business composition supplies pages; the shell only knows platform destinations.
      if (id === 'zhihu') {
        const operations = routes.flatMap(route => route.children ?? []).find(route => route.path === 'operations')
        if (operations?.component) {
          const pages = [
            { path: 'works', title: role === 'leader' ? '作品跟进' : '作品记录', section: 'operations', pageKind: 'works', tab: 'works' },
            { path: 'data-issues', title: '数据待办', section: 'operations', pageKind: 'issues', tab: 'issues' },
            { path: 'finance', title: '财务', section: 'finance', pageKind: 'finance', tab: 'keywords' },
          ]
          for (const page of pages) removers.push(router.addRoute('shell', { path: page.path, name: page.path,
            component: operations.component, meta: { ...page, moduleId: id } }))
        }
      }
    }
  }
  return removers
}
