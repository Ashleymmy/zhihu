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
        name: 'home',
        component: () => import('./views/HomeView.vue'),
        meta: { requiresAuth: true },
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
    if (to.name === 'login' && auth.loggedIn) return { name: 'home' }
    return true
  })

  return router
}
