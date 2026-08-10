<template>
  <div class="app-shell">
    <!-- Sidebar -->
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <!-- Logo -->
      <div class="sidebar-logo">
        <div class="logo-mark">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="12 2 22 8 22 16 12 22 2 16 2 8"/></svg>
        </div>
        <transition name="fade-text">
          <div v-if="!sidebarCollapsed" class="logo-text">
            <span class="logo-name">OPC</span>
            <span class="logo-tagline">{{ currentWorkspace }}</span>
          </div>
        </transition>
      </div>

      <!-- Nav -->
      <nav class="sidebar-nav">
        <template v-for="group in navGroups.filter(navGroupVisible)" :key="group.label">
          <!-- 普通分组 -->
          <template v-if="!group.children">
            <div v-if="!sidebarCollapsed" class="nav-group-label">{{ group.label }}</div>
            <div v-else class="nav-group-divider" />
            <router-link
              v-for="item in group.items.filter(navItemVisible)" :key="item.to" :to="item.to"
              class="nav-item" :class="{ active: isActive(item.to) }"
            >
              <span class="nav-icon" v-html="item.icon" />
              <transition name="fade-text">
                <span v-if="!sidebarCollapsed" class="nav-label">{{ item.label }}</span>
              </transition>
              <transition name="fade-text">
                <span v-if="!sidebarCollapsed && item.badge" class="nav-badge">{{ item.badge }}</span>
              </transition>
            </router-link>
          </template>

          <!-- 可折叠父分组（含子分组） -->
          <template v-else>
            <div v-if="!sidebarCollapsed" class="nav-group-parent" @click="toggleGroup(group.label)">
              <span class="nav-group-parent-label">{{ group.label }}</span>
              <svg class="nav-chevron" :class="{ open: openGroups.has(group.label) }"
                   width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
            <div v-else class="nav-group-divider" />

            <transition name="fade-section">
              <div v-if="openGroups.has(group.label) && !sidebarCollapsed" class="nav-subgroups">
                <template v-for="sub in group.children.filter(navSubGroupVisible)" :key="sub.label">
                  <div class="nav-subgroup-label" @click="toggleGroup(group.label + '|' + sub.label)">
                    <span>{{ sub.label }}</span>
                    <svg class="nav-chevron sm" :class="{ open: openGroups.has(group.label + '|' + sub.label) }"
                         width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                  <template v-if="openGroups.has(group.label + '|' + sub.label)">
                    <router-link
                      v-for="item in sub.items.filter(navItemVisible)" :key="item.to" :to="item.to"
                      class="nav-item sub-item" :class="{ active: isActive(item.to) }"
                    >
                      <span class="nav-icon" v-html="item.icon" />
                      <span class="nav-label">{{ item.label }}</span>
                    </router-link>
                  </template>
                </template>
              </div>
            </transition>
          </template>
        </template>
      </nav>

      <!-- Bottom user -->
      <div class="sidebar-footer">
        <div class="sidebar-footer-inner">
          <div class="user-avatar-sm">{{ userInitials }}</div>
          <transition name="fade-text">
            <div v-if="!sidebarCollapsed" class="user-info">
              <span class="user-name">{{ auth.user?.displayName ?? '—' }}</span>
              <span class="user-level">{{ userRole }}</span>
            </div>
          </transition>
          <transition name="fade-text">
            <button v-if="!sidebarCollapsed" class="logout-btn" title="退出登录" @click="handleLogout">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </transition>
        </div>
      </div>

      <!-- Collapse toggle -->
      <button class="collapse-btn" @click="sidebarCollapsed = !sidebarCollapsed">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          :style="{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
    </aside>

    <!-- Main -->
    <div class="main-area">
      <!-- Header -->
      <header class="main-header">
        <div class="header-left">
          <div class="breadcrumb">
            <span class="bc-root">OPC</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            <span class="bc-current">{{ currentPageTitle }}</span>
          </div>
        </div>
        <div class="header-right">
          <div class="header-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input placeholder="全局搜索…" />
          </div>
          <a-popover placement="bottomRight" trigger="click" :overlay-style="{ padding: 0 }">
            <template #content>
              <div class="notif-panel">
                <div class="notif-head">通知</div>
                <div class="notif-empty">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--color-text-disabled)"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  <span>暂无新通知</span>
                </div>
              </div>
            </template>
            <button class="hdr-icon-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              <span class="notif-dot"></span>
            </button>
          </a-popover>
          <router-link to="/dashboard/profile" class="hdr-avatar" title="个人中心">{{ userInitials }}</router-link>
        </div>
      </header>

      <!-- Content -->
      <main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { initials, roleLabel } from '@/utils/format'
import { canAccess, workspaceLabel, type AccessKey } from '@/access'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const sidebarCollapsed = ref(false)
// 默认展开知乎及所有子组
const openGroups = ref<Set<string>>(new Set([
  '知乎',
  '知乎|推广', '知乎|工作台', '知乎|盐选内容库', '知乎|结算', '知乎|创意中心', '知乎|风控',
]))
function toggleGroup(key: string) {
  const next = new Set(openGroups.value)
  if (next.has(key)) { next.delete(key) } else { next.add(key) }
  openGroups.value = next
}

const userInitials = computed(() => initials(auth.user?.displayName ?? ''))
const userRole = computed(() => roleLabel(auth.user?.role ?? ''))
const currentWorkspace = computed(() => workspaceLabel(auth.user?.role))

interface NavItem    { to: string; label: string; icon: string; badge?: string; access?: AccessKey; localOnly?: boolean }
interface NavSubGroup { label: string; items: NavItem[] }
interface NavGroup   { label: string; items: NavItem[]; children?: NavSubGroup[] }

// 与 router/index.ts 的守卫保持一致：z-* 默认需要 allianceAdmin，localOnly 页面豁免
const accessForItem = (item: NavItem): AccessKey | undefined =>
  item.access
  ?? (item.to.startsWith('/dashboard/z-') && !item.localOnly ? 'allianceAdmin' : undefined)

const navItemVisible = (item: NavItem) => canAccess(auth.user, accessForItem(item))
const navSubGroupVisible = (group: NavSubGroup) => group.items.some(navItemVisible)
const navGroupVisible = (group: NavGroup) =>
  group.items.some(navItemVisible) || group.children?.some(navSubGroupVisible) === true

const fullNavGroups: NavGroup[] = [
  {
    label: '总览',
    items: [
      { to: '/dashboard/overview', label: '数据总览', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>` },
      { to: '/dashboard/analytics', label: '数据分析', access: 'analytics', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>` },
    ],
  },
  {
    label: '推广管理',
    items: [
      { to: '/dashboard/campaigns', label: '推广计划', access: 'plan', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>` },
      { to: '/dashboard/keywords', label: '编词与回传', access: 'keyword', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="13" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`, badge: '5' },
      { to: '/dashboard/callbacks', label: '回传配置', access: 'callbacks', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>` },
    ],
  },
  {
    label: '收益 & 工具',
    items: [
      { to: '/dashboard/earnings', label: '收益管理', access: 'earnings', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>` },
      { to: '/dashboard/team',     label: '子账号与团队', access: 'team', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` },
      { to: '/dashboard/tools',    label: '工具箱',   icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>` },
    ],
  },
  {
    label: '知乎',
    items: [],
    children: [
      {
        label: '推广',
        items: [
          { to: '/dashboard/z-tasks',    label: '任务列表',   icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>` },
          { to: '/dashboard/z-products', label: '选品内容库', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>` },
        ],
      },
      {
        label: '工作台',
        items: [
          { to: '/dashboard/z-plans',        label: '计划管理', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>` },
          { to: '/dashboard/z-compositions', label: '作品管理', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>` },
          { to: '/dashboard/z-materials',    label: '素材管理', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>` },
          { to: '/dashboard/z-report',       label: '实时数据', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>` },
        ],
      },
      {
        label: '盐选内容库',
        items: [
          { to: '/dashboard/z-content-search', label: '内容详情搜索', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>` },
          { to: '/dashboard/z-ranking',        label: '常规书单',   icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="18 20 18 10"/><polyline points="12 20 12 4"/><polyline points="6 20 6 14"/></svg>` },
          { to: '/dashboard/z-ranking-recommend', label: '推荐书单', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>` },
          { to: '/dashboard/z-audiobook',      label: '有声书库',   icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>` },
          { to: '/dashboard/z-comic',          label: '漫剧内容',   icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>` },
        ],
      },
      {
        label: '结算',
        items: [
          { to: '/dashboard/z-settlement', label: '结算单', access: 'earnings', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>` },
        ],
      },
      {
        label: '创意中心',
        items: [
          { to: '/dashboard/z-writing-tool', label: '文案模板工具', localOnly: true, icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>` },
          { to: '/dashboard/z-rewrite',      label: '本地快速改写', localOnly: true, icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>` },
        ],
      },
      {
        label: '风控',
        items: [
          { to: '/dashboard/z-content-tag', label: '内容标签', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>` },
          { to: '/dashboard/z-intercept',   label: '截流举报', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>` },
          { to: '/dashboard/z-risk',        label: '风险词',   icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>` },
        ],
      },
    ],
  },
]

const workerZhihuGroup: NavGroup = {
  label: '知乎',
  items: [],
  children: [
    {
      label: '推广',
      items: [
        { to: '/dashboard/z-tasks', label: '任务列表', access: 'plan', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>` },
      ],
    },
    {
      label: '工作台',
      items: [
        { to: '/dashboard/campaigns', label: '计划管理', access: 'plan', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>` },
        { to: '/dashboard/keywords', label: '作品管理', access: 'composition', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>` },
        { to: '/dashboard/analytics', label: '实时数据', access: 'analytics', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>` },
      ],
    },
    {
      label: '结算',
      items: [
        { to: '/dashboard/earnings', label: '收益与提现', access: 'earnings', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>` },
      ],
    },
    {
      label: '创意中心',
      items: [
        { to: '/dashboard/z-writing-tool', label: '文案模板工具', localOnly: true, icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>` },
        { to: '/dashboard/z-rewrite',      label: '本地快速改写', localOnly: true, icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>` },
      ],
    },
  ],
}

const baseNavGroups = fullNavGroups.filter(group => group.label !== '知乎')
const adminZhihuGroup = fullNavGroups.find(group => group.label === '知乎')
const navGroups = computed<NavGroup[]>(() => {
  const zhihuGroup = canAccess(auth.user, 'allianceAdmin') ? adminZhihuGroup : workerZhihuGroup
  return zhihuGroup ? [...baseNavGroups, zhihuGroup] : baseNavGroups
})

const routeTitleMap: Record<string, string> = {
  '/dashboard/overview':           '数据总览',
  '/dashboard/analytics':          '数据分析',
  '/dashboard/campaigns':          '推广计划',
  '/dashboard/keywords':           '词条管理',
  '/dashboard/callbacks':          '绑词回传',
  '/dashboard/earnings':           '收益管理',
  '/dashboard/team':               '团队管理',
  '/dashboard/tools':              '工具箱',
  '/dashboard/profile':           '个人中心',
  '/dashboard/z-tasks':            '任务列表',
  '/dashboard/z-products':         '选品内容库',
  '/dashboard/z-plans':            '计划管理',
  '/dashboard/z-compositions':     '作品管理',
  '/dashboard/z-materials':        '素材管理',
  '/dashboard/z-report':           '实时数据',
  '/dashboard/z-content-search':   '内容详情搜索',
  '/dashboard/z-ranking':          '常规书单',
  '/dashboard/z-ranking-recommend':'推荐书单',
  '/dashboard/z-audiobook':        '有声书库',
  '/dashboard/z-comic':            '漫剧内容',
  '/dashboard/z-settlement':       '结算单',
  '/dashboard/z-writing-tool':     '文案模板工具',
  '/dashboard/z-rewrite':          '本地快速改写',
  '/dashboard/z-content-tag':      '内容标签',
  '/dashboard/z-intercept':        '截流举报',
  '/dashboard/z-risk':             '风险词',
}

const currentPageTitle = computed(() => routeTitleMap[route.path] ?? '控制台')
const isActive = (to: string) => route.path.startsWith(to)
const handleLogout = async () => { await auth.logout(); router.push('/login') }
</script>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  background: var(--color-bg-primary);
  overflow: hidden;
}

/* ── Sidebar ── */
.sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border);
  transition: width var(--transition-base), min-width var(--transition-base);
  overflow: hidden;
  z-index: var(--z-fixed);
  flex-shrink: 0;
}
.sidebar.collapsed { width: var(--sidebar-collapsed-width); min-width: var(--sidebar-collapsed-width); }

.sidebar-logo {
  display: flex; align-items: center; gap: 10px;
  padding: 18px 16px 16px;
  border-bottom: 1px solid var(--color-border);
  min-height: 60px; flex-shrink: 0;
}
.logo-mark {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px;
  background: var(--color-accent); border-radius: 7px; flex-shrink: 0;
  box-shadow: 0 0 16px rgba(99,102,241,0.4);
}
.logo-text { display: flex; flex-direction: column; line-height: 1; white-space: nowrap; }
.logo-name { font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--color-text-primary); letter-spacing: 0.06em; }
.logo-tagline { font-size: 10px; color: var(--color-text-disabled); margin-top: 2px; letter-spacing: 0.08em; }

.sidebar-nav { flex: 1; padding: 8px 8px; overflow-y: auto; overflow-x: hidden; }
.nav-group-label { padding: 14px 8px 4px; font-size: 9.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-text-disabled); white-space: nowrap; }
.nav-group-divider { height: 1px; background: var(--color-border); margin: 8px 4px; }
.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 7.5px 10px; border-radius: var(--radius-md);
  color: var(--color-text-tertiary); font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all var(--transition-fast);
  white-space: nowrap; overflow: hidden; text-decoration: none; position: relative;
}
.nav-item:hover { background: var(--color-bg-hover); color: var(--color-text-secondary); }
.nav-item.active { background: var(--color-accent-subtle); color: var(--color-accent); }
.nav-item.active::before {
  content: ''; position: absolute; left: 0; top: 6px; bottom: 6px;
  width: 2.5px; background: var(--color-accent); border-radius: 0 2px 2px 0;
}
.nav-icon { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex-shrink: 0; }
.nav-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.nav-badge { background: var(--color-accent-muted); color: var(--color-accent); font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: var(--radius-full); flex-shrink: 0; }

.sidebar-footer { border-top: 1px solid var(--color-border); padding: 8px 8px; flex-shrink: 0; }
.sidebar-footer-inner { display: flex; align-items: center; gap: 10px; padding: 7px; border-radius: var(--radius-md); overflow: hidden; }
.user-avatar-sm { width: 28px; height: 28px; border-radius: 50%; background: var(--gradient-accent); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: white; flex-shrink: 0; }
.user-info { display: flex; flex-direction: column; flex: 1; overflow: hidden; line-height: 1; white-space: nowrap; }
.user-name { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
.user-level { font-size: 10px; color: var(--color-text-disabled); margin-top: 3px; }
.logout-btn { background: none; border: none; padding: 4px; color: var(--color-text-disabled); cursor: pointer; border-radius: var(--radius-sm); transition: color var(--transition-fast); flex-shrink: 0; display: flex; }
.logout-btn:hover { color: var(--color-error); }

.collapse-btn {
  position: absolute; top: 17px; right: -11px;
  width: 22px; height: 22px;
  background: var(--color-bg-elevated); border: 1px solid var(--color-border-hover);
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--color-text-tertiary); transition: all var(--transition-fast); z-index: 10;
}
.collapse-btn:hover { background: var(--color-accent-subtle); color: var(--color-accent); border-color: var(--color-accent-border); }

/* ── Main ── */
.main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
.main-header {
  height: var(--header-height); flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 28px;
  background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border);
}
.breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--color-text-tertiary); }
.bc-root { color: var(--color-text-disabled); }
.bc-current { color: var(--color-text-primary); font-weight: 500; }
.header-right { display: flex; align-items: center; gap: 8px; }
.header-search {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 12px;
  background: var(--color-bg-tertiary); border: 1px solid var(--color-border);
  border-radius: var(--radius-full); color: var(--color-text-disabled);
  transition: border-color var(--transition-fast);
}
.header-search:focus-within { border-color: var(--color-accent); }
.header-search input { background: none; border: none; outline: none; font-size: 12.5px; color: var(--color-text-secondary); width: 150px; }
.header-search input::placeholder { color: var(--color-text-disabled); }
.hdr-icon-btn {
  position: relative; width: 32px; height: 32px;
  background: var(--color-bg-tertiary); border: 1px solid var(--color-border);
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast);
}
.hdr-icon-btn:hover { border-color: var(--color-border-hover); color: var(--color-text-secondary); }
.notif-dot { position: absolute; top: 7px; right: 7px; width: 5.5px; height: 5.5px; background: var(--color-error); border-radius: 50%; border: 1.5px solid var(--color-bg-secondary); }
.hdr-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--gradient-accent); display: flex; align-items: center; justify-content: center; font-size: 10.5px; font-weight: 700; color: white; cursor: pointer; text-decoration: none; transition: box-shadow var(--transition-fast); }
.hdr-avatar:hover { box-shadow: var(--shadow-glow); }
.notif-panel { width: 280px; background: var(--color-bg-elevated); border-radius: var(--radius-lg); overflow: hidden; }
.notif-head { padding: 12px 16px; font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); border-bottom: 1px solid var(--color-border); }
.notif-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 16px; color: var(--color-text-disabled); font-size: 13px; }
.main-content { flex: 1; overflow-y: auto; overflow-x: hidden; padding: var(--content-padding); background: var(--color-bg-primary); }

/* Transitions */
.fade-text-enter-active { transition: opacity 0.15s, transform 0.15s; }
.fade-text-leave-active { transition: opacity 0.08s, transform 0.08s; }
.fade-text-enter-from { opacity: 0; transform: translateX(-5px); }
.fade-text-leave-to   { opacity: 0; transform: translateX(-5px); }
.fade-section-enter-active { transition: opacity 0.18s, transform 0.18s; }
.fade-section-leave-active { transition: opacity 0.12s, transform 0.12s; }
.fade-section-enter-from { opacity: 0; transform: translateY(-4px); }
.fade-section-leave-to   { opacity: 0; transform: translateY(-4px); }
.page-enter-active {
  transition: opacity 0.26s cubic-bezier(0.4,0,0.2,1),
              transform 0.26s cubic-bezier(0.4,0,0.2,1);
}
.page-leave-active {
  transition: opacity 0.16s cubic-bezier(0.4,0,0.2,1),
              transform 0.16s cubic-bezier(0.4,0,0.2,1);
}
.page-enter-from { opacity: 0; transform: translateY(18px); }
.page-leave-to   { opacity: 0; transform: translateY(-6px); }

/* ── 折叠父分组 ── */
.nav-group-parent {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 8px 4px;
  font-size: 13px; font-weight: 600; letter-spacing: 0.02em;
  color: var(--color-text-secondary);
  cursor: pointer; user-select: none;
  transition: color var(--transition-fast);
}
.nav-group-parent:hover { color: var(--color-text-tertiary); }
.nav-group-parent-label { white-space: nowrap; }
.nav-chevron {
  flex-shrink: 0; color: var(--color-text-disabled);
  transition: transform 0.2s cubic-bezier(0.4,0,0.2,1);
}
.nav-chevron.open { transform: rotate(180deg); }
.nav-chevron.sm   { width: 10px; height: 10px; }

/* ── 子分组 ── */
.nav-subgroups { overflow: hidden; }
.nav-subgroup-label {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px 3px;
  font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: rgba(148,163,184,0.6);
  cursor: pointer; user-select: none;
  transition: color var(--transition-fast);
}
.nav-subgroup-label:hover { color: var(--color-text-disabled); }

/* ── 缩进子菜单项 ── */
.nav-item.sub-item {
  padding-left: 20px;
}
</style>
