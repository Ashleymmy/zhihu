import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard',    name: 'dashboard',    component: () => import('@/views/DashboardView.vue') },
    { path: '/channels',     name: 'channels',     component: () => import('@/views/ChannelsView.vue') },
    { path: '/tasks',        name: 'tasks',        component: () => import('@/views/TasksView.vue') },
    { path: '/plans',        name: 'plans',        component: () => import('@/views/PlansView.vue') },
    { path: '/compositions', name: 'compositions', component: () => import('@/views/CompositionsView.vue') },
    { path: '/report',       name: 'report',       component: () => import('@/views/ReportView.vue') },
    { path: '/ranking',      name: 'ranking',      component: () => import('@/views/RankingView.vue') },
    { path: '/intercept',    name: 'intercept',    component: () => import('@/views/InterceptView.vue') },
    { path: '/risk',         name: 'risk',         component: () => import('@/views/RiskView.vue') },
    { path: '/audiobook',    name: 'audiobook',    component: () => import('@/views/AudiobookView.vue') },
    { path: '/comic',        name: 'comic',        component: () => import('@/views/ComicView.vue') },
    { path: '/content-tag',  name: 'content-tag',  component: () => import('@/views/ContentTagView.vue') },
  ],
})

export default router

