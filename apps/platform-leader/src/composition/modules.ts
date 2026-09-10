import type { Router, RouteRecordRaw } from 'vue-router'
export async function installBusinessRoutes(router: Router, enabled: string[]) {
  if (import.meta.env.VITE_OPC_CORE_ONLY === '1') return []
  const removers: Array<() => void> = []
  const loaders: Record<string, () => Promise<RouteRecordRaw[]>> = {
    zhihu: async () => (await import('../modules/zhihu/routes')).zhihuRoutes,
  }
  for (const id of enabled) {
    const load = loaders[id]
    if (load) for (const route of await load()) removers.push(router.addRoute('shell', route))
  }
  return removers
}
