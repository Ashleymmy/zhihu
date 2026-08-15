import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useMetaStore } from '@/stores/meta'
import { canAccess, type AccessKey } from '@/access'

const router = createRouter({
  history: createWebHistory((import.meta as any).env.BASE_URL),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/PublicLayout.vue'),
      children: [
        { path: '', name: 'landing', component: () => import('@/views/public/LandingView.vue'), meta: { requiresAuth: false } },
        { path: 'login', name: 'login', component: () => import('@/views/public/LoginView.vue'), meta: { requiresAuth: false } },
      ],
    },
    {
      path: '/dashboard',
      component: () => import('@/layouts/DashboardLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/dashboard/overview' },
        { path: 'overview',  name: 'dashboard-overview',  component: () => import('@/views/dashboard/OverviewView.vue'),  meta: { requiresAuth: true } },
        { path: 'campaigns', name: 'dashboard-campaigns', component: () => import('@/views/dashboard/CampaignsView.vue'), meta: { requiresAuth: true, access: 'plan' } },
        { path: 'keywords',  name: 'dashboard-keywords',  component: () => import('@/views/dashboard/KeywordsView.vue'),  meta: { requiresAuth: true, access: 'keyword' } },
        { path: 'callbacks', name: 'dashboard-callbacks', component: () => import('@/views/dashboard/CallbacksView.vue'), meta: { requiresAuth: true, access: 'callbacks' } },
        { path: 'analytics', name: 'dashboard-analytics', component: () => import('@/views/dashboard/AnalyticsView.vue'), meta: { requiresAuth: true, access: 'analytics' } },
        { path: 'earnings',  name: 'dashboard-earnings',  component: () => import('@/views/dashboard/EarningsView.vue'),  meta: { requiresAuth: true, access: 'earnings' } },
        { path: 'tools',     name: 'dashboard-tools',     component: () => import('@/views/dashboard/ToolsView.vue'),     meta: { requiresAuth: true } },
        { path: 'team',      name: 'dashboard-team',      component: () => import('@/views/dashboard/TeamView.vue'),      meta: { requiresAuth: true, access: 'team' } },
        // ── 知乎联盟 ──────────────────────────────────────────────
        { path: 'z-tasks',        name: 'z-tasks',        component: () => import('@/views/dashboard/ZhihuTasksView.vue'),       meta: { requiresAuth: true, access: 'plan' } },
        { path: 'z-plans',        name: 'z-plans',        component: () => import('@/views/dashboard/ZhihuPlansView.vue'),       meta: { requiresAuth: true } },
        { path: 'z-compositions', name: 'z-compositions', component: () => import('@/views/dashboard/ZhihuCompositionsView.vue'), meta: { requiresAuth: true } },
        { path: 'z-report',       name: 'z-report',       component: () => import('@/views/dashboard/ZhihuReportView.vue'),      meta: { requiresAuth: true } },
        { path: 'z-ranking',      name: 'z-ranking',      component: () => import('@/views/dashboard/ZhihuRankingView.vue'),     meta: { requiresAuth: true } },
        { path: 'z-intercept',    name: 'z-intercept',    component: () => import('@/views/dashboard/ZhihuInterceptView.vue'),   meta: { requiresAuth: true } },
        { path: 'z-risk',         name: 'z-risk',         component: () => import('@/views/dashboard/ZhihuRiskView.vue'),        meta: { requiresAuth: true } },
        { path: 'z-audiobook',    name: 'z-audiobook',    component: () => import('@/views/dashboard/ZhihuAudiobookView.vue'),   meta: { requiresAuth: true } },
        { path: 'z-comic',        name: 'z-comic',        component: () => import('@/views/dashboard/ZhihuComicView.vue'),       meta: { requiresAuth: true } },
        { path: 'z-content-tag',  name: 'z-content-tag',  component: () => import('@/views/dashboard/ZhihuContentTagView.vue'),  meta: { requiresAuth: true } },
        // ── 新增页面 ─────────────────────────────────────────────
        { path: 'z-products',        name: 'z-products',        component: () => import('@/views/dashboard/ZhihuProductsView.vue'),      meta: { requiresAuth: true } },
        { path: 'z-materials',       name: 'z-materials',       component: () => import('@/views/dashboard/ZhihuMaterialsView.vue'),     meta: { requiresAuth: true } },
        { path: 'z-content-search',  name: 'z-content-search',  component: () => import('@/views/dashboard/ZhihuContentSearchView.vue'), meta: { requiresAuth: true } },
        // 只读 BFF earningsApi（非联盟接口），故按 earnings 门控而非默认的 allianceAdmin
        { path: 'z-settlement',      name: 'z-settlement',      component: () => import('@/views/dashboard/ZhihuSettlementView.vue'),    meta: { requiresAuth: true, access: 'earnings' } },
        // 纯本地创意工具：零网络调用，不依赖知乎联盟接口，故豁免 allianceAdmin 默认门控
        { path: 'z-writing-tool',    name: 'z-writing-tool',    component: () => import('@/views/dashboard/ZhihuWritingToolView.vue'),   meta: { requiresAuth: true, localOnly: true } },
        { path: 'z-rewrite',         name: 'z-rewrite',         component: () => import('@/views/dashboard/ZhihuRewriteView.vue'),       meta: { requiresAuth: true, localOnly: true } },
        { path: 'profile',           name: 'dashboard-profile', component: () => import('@/views/dashboard/ProfileView.vue'),            meta: { requiresAuth: true } },
      ],
    },
  ],
})

// ─── Navigation guard ─────────────────────────────────────────
router.beforeEach(async (to, _from, next) => {
  const auth = useAuthStore()
  const meta = useMetaStore()

  // Redirect already-authenticated user away from login
  if (to.name === 'login' && auth.isLoggedIn) {
    return next({ path: '/dashboard/overview' })
  }

  // Require auth for protected routes
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return next({ name: 'login', query: { redirect: to.fullPath } })
  }

  // Hydrate user profile on first protected navigation
  if (auth.isLoggedIn && !auth.user) {
    try {
      await auth.fetchMe()
    } catch {
      auth.logout()
      return next({ name: 'login' })
    }
  }

  // Fire-and-forget: load enums once after auth is confirmed
  if (auth.isLoggedIn) {
    meta.loadEnums()
  }

  // /dashboard/z-* 默认视作知乎联盟页面（服务端 allianceRouter 要求 project.manage）。
  // meta.localOnly 的页面无任何联盟依赖，豁免该默认门控。
  const allianceFallback = to.path.startsWith('/dashboard/z-') && !to.meta.localOnly
  const access = (to.meta.access as AccessKey | undefined)
    ?? (allianceFallback ? 'allianceAdmin' : undefined)
  if (access && !canAccess(auth.user, access)) {
    return next({ path: '/dashboard/overview', query: { denied: to.fullPath } })
  }

  next()
})

export default router
