import type { RouteRecordRaw } from 'vue-router'
export const modulePages: RouteRecordRaw[] = [
  {
    path: 'dashboard',
    name: 'zhihu-dashboard',
    component: () => import('./views/DashboardView.vue'),
    meta: { moduleId: 'zhihu', title: '数据看板' },
  },
  {
    path: 'orders',
    name: 'zhihu-orders',
    component: () => import('./views/OrdersView.vue'),
    meta: { moduleId: 'zhihu', title: '订单管理' },
  },
  {
    path: 'withdrawals',
    name: 'zhihu-withdrawals',
    component: () => import('./views/WithdrawalsView.vue'),
    meta: { moduleId: 'zhihu', title: '提现申请' },
  },
  {
    path: 'appeals',
    name: 'zhihu-appeals',
    component: () => import('./views/AppealsView.vue'),
    meta: { moduleId: 'zhihu', title: '财务申诉' },
  },
  {
    path: 'settlements',
    name: 'zhihu-settlements',
    component: () => import('./views/SettlementView.vue'),
    meta: { moduleId: 'zhihu', title: '结算中心' },
  },
  {
    path: 'plans',
    name: 'zhihu-plans',
    component: () => import('./views/PlansView.vue'),
    meta: { moduleId: 'zhihu', title: '推广计划' },
  },
  {
    path: 'keywords',
    name: 'zhihu-keywords',
    component: () => import('./views/KeywordsView.vue'),
    meta: { moduleId: 'zhihu', title: '关键词回传' },
  },
  {
    path: '',
    name: 'zhihu-zhihu-story',
    component: () => import('./views/ZhihuStoryView.vue'),
    meta: { moduleId: 'zhihu', title: '知乎故事' },
  },
  {
    path: 'works',
    name: 'zhihu-story-works',
    component: () => import('./views/StoryWorksView.vue'),
    meta: { moduleId: 'zhihu', title: '作品管理' },
  },
  {
    path: 'tasks',
    name: 'zhihu-story-tasks',
    component: () => import('./views/StoryTasksView.vue'),
    meta: { moduleId: 'zhihu', title: '任务列表' },
  },
  {
    path: 'salt',
    name: 'zhihu-story-salt',
    component: () => import('./views/StorySaltView.vue'),
    meta: { moduleId: 'zhihu', title: '盐选榜单' },
  },
  {
    path: 'comments',
    name: 'zhihu-story-comments',
    component: () => import('./views/StoryInterceptView.vue'),
    meta: { moduleId: 'zhihu', title: '评论截流' },
  },
  {
    path: 'risk',
    name: 'zhihu-story-risk',
    component: () => import('./views/StoryRiskView.vue'),
    meta: { moduleId: 'zhihu', title: '风险举报' },
  },
  {
    path: 'media',
    name: 'zhihu-story-media',
    component: () => import('./views/StoryMediaView.vue'),
    meta: { moduleId: 'zhihu', title: '有声书漫画' },
  },
  {
    path: 'tags',
    name: 'zhihu-story-tags',
    component: () => import('./views/StoryTagView.vue'),
    meta: { moduleId: 'zhihu', title: '内容标签' },
  },
  {
    path: 'products',
    name: 'zhihu-story-products',
    component: () => import('./views/StoryProductsView.vue'),
    meta: { moduleId: 'zhihu', title: '产品库' },
  },
  {
    path: 'assets',
    name: 'zhihu-story-assets',
    component: () => import('./views/StoryModuleView.vue'),
    meta: { moduleId: 'zhihu', title: '素材库', storyModule: 'assets' },
  },
  {
    path: 'earnings',
    name: 'zhihu-earnings',
    component: () => import('./views/EarningsView.vue'),
    meta: { moduleId: 'zhihu', title: '收益结算' },
  },
  {
    path: 'creative-tools',
    name: 'zhihu-creative-tools',
    component: () => import('./views/CreativeToolsView.vue'),
    meta: { moduleId: 'zhihu', title: '创意工具坊' },
  },
  {
    path: 'knowledge',
    name: 'zhihu-knowledge',
    component: () => import('./views/KnowledgePayView.vue'),
    meta: { moduleId: 'zhihu', title: '我的课堂' },
  },
]
export const zhihuRoutes: RouteRecordRaw[] = [
  {
    path: 'modules/zhihu',
    component: () => import('./ModuleLayout.vue'),
    meta: { moduleId: 'zhihu' },
    children: modulePages,
  },
  { path: 'orders', redirect: (to) => ({ path: '/modules/zhihu/orders', query: to.query, hash: to.hash }) },
  {
    path: 'withdrawals',
    redirect: (to) => ({ path: '/modules/zhihu/withdrawals', query: to.query, hash: to.hash }),
  },
  { path: 'appeals', redirect: (to) => ({ path: '/modules/zhihu/appeals', query: to.query, hash: to.hash }) },
  {
    path: 'settlements',
    redirect: (to) => ({ path: '/modules/zhihu/settlements', query: to.query, hash: to.hash }),
  },
  { path: 'plans', redirect: (to) => ({ path: '/modules/zhihu/plans', query: to.query, hash: to.hash }) },
  {
    path: 'keywords',
    redirect: (to) => ({ path: '/modules/zhihu/keywords', query: to.query, hash: to.hash }),
  },
  { path: 'zhihu-story', redirect: (to) => ({ path: '/modules/zhihu/', query: to.query, hash: to.hash }) },
  {
    path: 'zhihu-story/plans',
    redirect: (to) => ({ path: '/modules/zhihu/plans', query: to.query, hash: to.hash }),
  },
  {
    path: 'zhihu-story/works',
    redirect: (to) => ({ path: '/modules/zhihu/works', query: to.query, hash: to.hash }),
  },
  {
    path: 'zhihu-story/tasks',
    redirect: (to) => ({ path: '/modules/zhihu/tasks', query: to.query, hash: to.hash }),
  },
  {
    path: 'zhihu-story/salt',
    redirect: (to) => ({ path: '/modules/zhihu/salt', query: to.query, hash: to.hash }),
  },
  {
    path: 'zhihu-story/comments',
    redirect: (to) => ({ path: '/modules/zhihu/comments', query: to.query, hash: to.hash }),
  },
  {
    path: 'zhihu-story/risk',
    redirect: (to) => ({ path: '/modules/zhihu/risk', query: to.query, hash: to.hash }),
  },
  {
    path: 'zhihu-story/media',
    redirect: (to) => ({ path: '/modules/zhihu/media', query: to.query, hash: to.hash }),
  },
  {
    path: 'zhihu-story/tags',
    redirect: (to) => ({ path: '/modules/zhihu/tags', query: to.query, hash: to.hash }),
  },
  {
    path: 'zhihu-story/products',
    redirect: (to) => ({ path: '/modules/zhihu/products', query: to.query, hash: to.hash }),
  },
  {
    path: 'zhihu-story/assets',
    redirect: (to) => ({ path: '/modules/zhihu/assets', query: to.query, hash: to.hash }),
  },
  {
    path: 'earnings',
    redirect: (to) => ({ path: '/modules/zhihu/earnings', query: to.query, hash: to.hash }),
  },
  {
    path: 'creative-tools',
    redirect: (to) => ({ path: '/modules/zhihu/creative-tools', query: to.query, hash: to.hash }),
  },
  {
    path: 'knowledge',
    redirect: (to) => ({ path: '/modules/zhihu/knowledge', query: to.query, hash: to.hash }),
  },
]
