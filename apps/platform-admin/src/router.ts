import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { workspace } from './stores/platform'
import { installBusinessRoutes } from './composition/modules'
import { canAccessPath } from './access'

const workspaceLoaders = {
  admin: () => import('./workspace-routes'),
  leader: () => import('../../platform-leader/src/workspace-routes'),
  creator: () => import('../../platform-creator/src/workspace-routes'),
}
export function createAppRouter(
  history: RouterHistory = createWebHistory(import.meta.env.BASE_URL),
) {
  const router = createRouter({
    history,
    routes: [
      {
        path: '/login',
        name: 'login',
        component: () => import('./views/LoginView.vue'),
        meta: { requiresAuth: false, title: '登录' },
      },
      {
        path: '/register',
        name: 'register',
        component: () => import('./views/LoginView.vue'),
        meta: { requiresAuth: false, title: '注册' },
      },
      {
        path: '/',
        name: 'shell',
        component: () => import('./layouts/ShellLayout.vue'),
        meta: { requiresAuth: true },
        children: [],
      },
      {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: () => import('./views/UnavailableView.vue'),
        meta: { requiresAuth: true },
      },
    ],
  })
  let installedFor = ''
  let removeRoutes: Array<() => void> = []
  function resetRoutes() {
    removeRoutes.forEach((remove) => remove())
    removeRoutes = []
    installedFor = ''
    workspace.modules.value = []
    workspace.projectId.value = ''
  }
  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    if (!auth.initialized) await auth.restore()
    else if (auth.loggedIn) await auth.validateSession().catch(() => undefined)
    if (!auth.loggedIn || !auth.user) {
      resetRoutes()
      return to.meta.requiresAuth === false
        ? true
        : { name: 'login', query: { redirect: to.fullPath } }
    }
    const identity = JSON.stringify([
      auth.user.id,
      auth.user.role,
      auth.user.adminDuty,
      auth.user.permissions,
    ])
    if (installedFor !== identity) {
      resetRoutes()
      const { workspaceRoutes } = await workspaceLoaders[auth.user.role]()
      removeRoutes = workspaceRoutes.map((record) =>
        router.addRoute('shell', record),
      )
      try {
        await workspace.refreshModules()
        removeRoutes.push(
          ...(await installBusinessRoutes(
            router,
            workspace.modules.value
              .filter((m) => m.status === 'enabled')
              .map((m) => m.id),
            auth.user.role,
          )),
        )
      } catch {
        workspace.modules.value = []
      }
      installedFor = identity
      // Resolve again against this account's route table, including after a role change.
      return to.fullPath
    }
    if (
      to.meta.requiresAuth === false ||
      to.name === 'not-found' ||
      !canAccessPath(auth.user, to.path)
    )
      return '/dashboard'
    if (
      to.meta.moduleId &&
      !workspace.modules.value.some(
        (m) => m.id === to.meta.moduleId && m.status === 'enabled',
      )
    )
      return '/modules'
    if (
      auth.user.role === 'admin' &&
      auth.user.adminDuty === 'finance' &&
      to.name === 'dashboard'
    ) {
      const enabled = workspace.modules.value.filter(
        (m) => m.status === 'enabled',
      )
      if (enabled.length === 1) return enabled[0]!.entryPath
    }
    return true
  })
  return router
}
