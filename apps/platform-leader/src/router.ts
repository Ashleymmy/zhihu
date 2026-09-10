import { createRouter, createWebHistory } from 'vue-router'
import { PlatformDashboard, ModuleDirectory, PublicFinance } from '@zhihu-koc/shared-components'
import { useAuthStore } from './stores/auth'
import { workspace } from './stores/platform'
import { installBusinessRoutes } from './composition/modules'
export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
      {
        path: '/login',
        name: 'login',
        component: () => import('./views/LoginView.vue'),
        meta: { requiresAuth: false, title: '登录' },
      },
      {
        path: '/',
        name: 'shell',
        component: () => import('./layouts/ShellLayout.vue'),
        meta: { requiresAuth: true },
        children: [
          { path: '', redirect: '/dashboard' },
          { path: 'dashboard', name: 'dashboard', component: PlatformDashboard, meta: { title: '工作台' } },
          { path: 'modules', name: 'modules', component: ModuleDirectory, meta: { title: '业务模块' } },
          { path: 'finance', name: 'finance', component: PublicFinance, meta: { title: '财务中心' } },
          {
            path: 'projects',
            name: 'projects',
            component: () => import('./views/ProjectsView.vue'),
            meta: { title: '项目管理' },
          },
          {
            path: 'team',
            name: 'team',
            component: () => import('./views/TeamView.vue'),
            meta: { title: '达人管理' },
          },
          {
            path: 'mcn',
            name: 'mcn',
            component: () => import('./views/McnView.vue'),
            meta: { title: 'MCN管理' },
          },
          {
            path: ':pathMatch(.*)*',
            name: 'not-found',
            component: () => import('./views/UnavailableView.vue'),
            meta: { title: '页面不可用' },
          },
        ],
      },
    ],
  })
  let installedFor: object | null = null
  let removeRoutes: Array<() => void> = []
  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    if (!auth.initialized) await auth.restore()
    if (!auth.loggedIn) {
      installedFor = null
      removeRoutes.forEach((remove) => remove())
      removeRoutes = []
      workspace.modules.value = []
      workspace.projectId.value = ''
    }
    if (to.meta.requiresAuth !== false && !auth.loggedIn)
      return { name: 'login', query: { redirect: to.fullPath } }
    if (auth.loggedIn && installedFor !== auth.user) {
      try {
        removeRoutes.forEach((remove) => remove())
        removeRoutes = []
        await workspace.refreshModules()
        removeRoutes = await installBusinessRoutes(
          router,
          workspace.modules.value.filter((m) => m.status === 'enabled').map((m) => m.id),
        )
        installedFor = auth.user
        if (to.name === 'not-found') return to.fullPath
      } catch {
        return to.name === 'dashboard' ? true : { name: 'dashboard' }
      }
    }
    if (
      to.meta.moduleId &&
      !workspace.modules.value.some((m) => m.id === to.meta.moduleId && m.status === 'enabled')
    )
      return '/modules'
    if (to.name === 'login' && auth.loggedIn) return { name: 'dashboard' }
    return true
  })
  return router
}
