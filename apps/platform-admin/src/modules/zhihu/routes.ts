import { defineComponent } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import type { GlobalRole } from '@zhihu-koc/shared-contracts/core'
import { useAuthStore } from './context'

// 财务旧页已合并进平台「财务 / 我的收益」，路由保留并由 ModuleNavigation 展示合并说明与历史记录。
const mergedStub = defineComponent({ render: () => null })

const isStaff = (role: GlobalRole) =>
  role === 'admin' || role === 'developer' || role === 'operator'

function operationsTitle(role: GlobalRole) {
  return role === 'creator' ? '我的关键词' : role === 'leader' ? '团队业务' : '运营管理'
}

function retiredFinanceRoutes(role: GlobalRole): RouteRecordRaw[] {
  if (role === 'operator') return []
  const staff = isStaff(role)
  const titles: Record<string, string> = {
    settlements: staff ? '结算管理' : '结算中心',
    earnings: '收益结算',
    withdrawals: role === 'creator' ? '提现申请' : '提现审批',
    appeals: '财务申诉',
    'data-import': '历史邮件 / Excel 导入',
  }
  const paths = staff
    ? ['settlements', 'earnings', 'withdrawals', 'appeals', 'data-import']
    : ['settlements', 'earnings', 'withdrawals', 'appeals']
  return paths.map((path) => ({
    path,
    name: `zhihu-${path}`,
    component: mergedStub,
    meta: { moduleId: 'zhihu', title: titles[path] },
  }))
}

export function modulePagesFor(role: GlobalRole, duty = 'all'): RouteRecordRaw[] {
  const staff = isStaff(role)
  if (role === 'operator') duty = 'operations'
  const title = operationsTitle(role)
  const pages: RouteRecordRaw[] = []
  if (!(staff && duty === 'finance')) {
    const works = role === 'creator'
      ? () => import('./views/StoryWorksViewCreator.vue')
      : () => import('./views/StoryWorksView.vue')
    pages.push(
      { path: 'operations', name: 'zhihu-operations', component: () => import('./views/ExclusiveView.vue'), meta: { moduleId: 'zhihu', section: 'operations', title } },
      { path: 'keywords', name: 'zhihu-keywords', component: () => import('./views/ExclusiveView.vue'), meta: { moduleId: 'zhihu', title } },
      { path: 'works', name: 'zhihu-story-works', component: works, meta: { moduleId: 'zhihu', title: '作品管理' } },
      { path: 'works/new', name: 'zhihu-register-work', component: works, meta: { moduleId: 'zhihu', title: '登记作品' } },
    )
  }
  if (staff && duty !== 'finance') {
    pages.push({ path: 'salt', name: 'zhihu-salt', component: () => import('./views/ProjectContentTools.vue'), meta: { moduleId: 'zhihu', tool: 'salt', title: '盐选榜单' } })
    if (role !== 'operator') pages.push({ path: 'risk', name: 'zhihu-risk', component: () => import('./views/ExclusiveView.vue'), meta: { moduleId: 'zhihu', section: 'risk', pageKind: 'risk', title: '风险举报' } })
  }
  if (staff && duty !== 'operations') {
    pages.push({ path: 'finance', name: 'zhihu-finance', component: () => import('./views/ExclusiveView.vue'), meta: { moduleId: 'zhihu', section: 'finance', title: '财务做账' } })
  }
  if (!staff) {
    pages.push({ path: 'wallet', name: 'zhihu-wallet', redirect: (to) => ({ path: '/income', query: to.query }) })
  }
  pages.push(...retiredFinanceRoutes(role))
  return pages
}

export function zhihuRoutesFor(role: GlobalRole, dutyOverride?: string): RouteRecordRaw[] {
  const duty = dutyOverride ?? (role === 'operator'
    ? 'operations'
    : role === 'admin'
      ? (useAuthStore().user?.adminDuty ?? 'all')
      : 'all')
  const pages = modulePagesFor(role, duty)
  const routes: RouteRecordRaw[] = [
    {
      path: 'modules/zhihu',
      component: () => import('./ModuleLayout.vue'),
      meta: { moduleId: 'zhihu' },
      children: [
        { path: '', redirect: duty === 'finance' ? '/modules/zhihu/finance' : '/modules/zhihu/operations' },
        ...pages,
      ],
    },
  ]
  // 旧分享链接别名，只保留仍存在的目标页。
  const aliasTargets: Record<string, string> = {
    settlements: '/modules/zhihu/settlements',
    'data-import': '/modules/zhihu/data-import',
    appeals: '/modules/zhihu/appeals',
    withdrawals: '/modules/zhihu/withdrawals',
    earnings: '/modules/zhihu/earnings',
    keywords: '/modules/zhihu/keywords',
  }
  const available = new Set(pages.map((page) => page.path))
  for (const [alias, target] of Object.entries(aliasTargets)) {
    if (!available.has(target.replace('/modules/zhihu/', ''))) continue
    routes.push({ path: alias, redirect: (to) => ({ path: target, query: to.query, hash: to.hash }) })
  }
  return routes
}
