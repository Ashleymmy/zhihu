import type { RouteRecordRaw } from 'vue-router'
export const platformPages: RouteRecordRaw[] = [
  { path: 'me', name: 'me', component: () => import('./views/MeView.vue'), meta: { title: '我的' } },
  { path: 'academy', name: 'academy', component: () => import('./views/AcademyView.vue'), meta: { title: '学院' } },
  { path: 'rates', name: 'rates', component: () => import('./views/RatesView.vue'), meta: { title: '计费规则' } },
]
