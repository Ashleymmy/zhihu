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
        meta: { requiresAuth: false, title: '登录' },
      },
      {
        path: '/',
        component: () => import('./layouts/ShellLayout.vue'),
        meta: { requiresAuth: true },
        children: [
          { path: '', redirect: '/dashboard' },
          // ── 数据看板 ──
          { path: 'dashboard', name: 'dashboard', component: () => import('./views/DashboardView.vue'), meta: { title: '数据看板' } },
          // ── 订单管理 ──
          { path: 'orders', name: 'orders', component: () => import('./views/OrdersView.vue'), meta: { title: '订单管理' } },
          // ── 结算管理 ──
          { path: 'settlements', name: 'settlements', component: () => import('./views/SettlementView.vue'), meta: { title: '结算管理' } },
          { path: 'withdrawals', name: 'withdrawals', component: () => import('./views/WithdrawalsView.vue'), meta: { title: '提现审批' } },
          // ── 推广管理 ──
          { path: 'plans', name: 'plans', component: () => import('./views/PlansView.vue'), meta: { title: '推广计划' } },
          { path: 'keywords', name: 'keywords', component: () => import('./views/KeywordsView.vue'), meta: { title: '关键词回传' } },
          { path: 'callbacks', name: 'callbacks', component: () => import('./views/CallbackConfigView.vue'), meta: { title: '回传配置' } },
          // ── 创意工具坊 ──
          { path: 'creative-tools', name: 'creative-tools', component: () => import('./views/CreativeToolsView.vue'), meta: { title: '创意工具坊' } },
          // ── 项目管理 ──
          { path: 'projects', name: 'projects', component: () => import('./views/ProjectsView.vue'), meta: { title: '项目管理' } },
          { path: 'zhihu-story', name: 'zhihu-story', component: () => import('./views/ZhihuStoryView.vue'), meta: { title: '知乎故事' } },
          // ── 知识付费 ──
          { path: 'knowledge', name: 'knowledge', component: () => import('./views/KnowledgePayView.vue'), meta: { title: '知识付费' } },
          // ── 账户管理 ──
          { path: 'team', name: 'team', component: () => import('./views/TeamView.vue'), meta: { title: '用户管理' } },
          { path: 'mcn', name: 'mcn', component: () => import('./views/McnView.vue'), meta: { title: 'MCN管理' } },
          { path: 'sub-accounts', name: 'sub-accounts', component: () => import('./views/SubAccountView.vue'), meta: { title: '子账号管理' } },
          // ── 数据分析 ──
          { path: 'analytics', name: 'analytics', component: () => import('./views/AnalyticsView.vue'), meta: { title: '数据分析' } },
          // ── 系统工具 ──
          { path: 'system', name: 'system', component: () => import('./views/SystemToolsView.vue'), meta: { title: '系统工具' } },
          { path: 'audit-log', name: 'audit-log', component: () => import('./views/AuditLogView.vue'), meta: { title: '审计日志' } },
          // ── 收益 ──
          { path: 'earnings', name: 'earnings', component: () => import('./views/EarningsView.vue'), meta: { title: '收益结算' } },
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
    if (to.name === 'login' && auth.loggedIn) return { name: 'dashboard' }
    return true
  })

  return router
}
