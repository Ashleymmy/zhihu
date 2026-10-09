import type { RouteRecordRaw } from 'vue-router'
export const platformPages: RouteRecordRaw[] = [
  { path: 'income', name: 'income', component: () => import('./views/IncomeView.vue'), meta: { title: '我的收益' } },
  { path: 'tasks', name: 'tasks', component: () => import('./views/TasksView.vue'), meta: { title: '任务' } },
  { path: 'task-hall', name: 'task-hall', component: () => import('./views/TasksView.vue'), meta: { title: '任务大厅' } },
  { path: 'me', name: 'me', component: () => import('./views/MeView.vue'), meta: { title: '我的' } },
  { path: 'academy', name: 'academy', component: () => import('./views/AcademyView.vue'), meta: { title: '学院' } },
  { path: 'rates', name: 'rates', component: () => import('./views/RatesView.vue'), meta: { title: '计费规则' } },
]
