import type { RouteRecordRaw } from 'vue-router'
import {
  PlatformDashboard,
  ModuleDirectory,
  PublicFinance,
} from '@zhihu-koc/shared-components'
export const workspaceRoutes: RouteRecordRaw[] = [
  { path: '', redirect: '/dashboard' },
  {
    path: 'dashboard',
    name: 'dashboard',
    component: PlatformDashboard,
    meta: { title: '工作台' },
  },
  {
    path: 'modules',
    name: 'modules',
    component: ModuleDirectory,
    meta: { title: '业务模块' },
  },
  {
    path: 'finance',
    name: 'finance',
    component: PublicFinance,
    meta: { title: '财务中心' },
  },
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
]
