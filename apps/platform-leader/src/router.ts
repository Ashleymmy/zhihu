import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'

export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: '/login',
        name: 'login',
        component: () => import('./views/LoginView.vue'),
        meta: { requiresAuth: false },
      },
      {
        path: '/',
        component: () => import('./layouts/ShellLayout.vue'),
        meta: { requiresAuth: true },
        children: [
          { path: '', name: 'overview', component: () => import('./views/OverviewView.vue') },
          { path: 'plans', name: 'plans', component: () => import('./views/PlansView.vue') },
          { path: 'earnings', name: 'earnings', component: () => import('./views/EarningsView.vue') },
          { path: 'team', name: 'team', component: () => import('./views/TeamView.vue') },
          { path: 'projects', name: 'projects', component: () => import('./views/ProjectsView.vue') },
        ],
      },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  })

  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    if (!auth.initialized) await auth.restore()
    if (to.meta.requiresAuth !== false && !auth.loggedIn) {
      return { name: 'login', query: { redirect: to.fullPath } }
    }
    if (to.name === 'login' && auth.loggedIn) return { name: 'overview' }
    return true
  })

  return router
}
