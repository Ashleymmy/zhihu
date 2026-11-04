<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ToastHost from './ToastHost.vue'

export interface NavItem {
  key: string
  label: string
  path: string
  /** 侧栏角标（待处理数），由使用方按待办路径聚合后传入 */
  badge?: number
}

export interface NavGroup {
  label: string
  items: NavItem[]
  collapsed?: boolean
}

export interface ShellAnnouncement {
  id: string
  title: string
  content: string
}

/** 顶栏待办（来自首页的待办接口），点击直达处理页面 */
export interface ShellTodo {
  key: string
  label: string
  count: number
  path: string
  detail?: string
  actionLabel?: string
}

const props = defineProps<{
  groups: NavGroup[]
  userName: string
  roleLabel: string
  currentPath: string
  announcements?: ShellAnnouncement[]
  /** 不传则不显示待办铃铛（未接通的功能不出现） */
  todos?: ShellTodo[]
  /** 手机底部标签栏；不传则手机端只用侧栏抽屉 */
  mobileTabs?: NavItem[]
}>()

const emit = defineEmits<{
  navigate: [path: string]
  logout: []
}>()

/* ---------- 图标：线性 24 栅格，按导航 key 取 ---------- */
const ICONS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  hall: 'M3 9h18M5 9V5h14v4M5 9v11h14V9M9 13h6',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  works: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  team: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  finance: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01',
  rates: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  projects: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  invite: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6',
  academy: 'M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z',
  me: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  profile: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  roles: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  announcements: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14',
  audit: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 13h6M9 17h4',
  monitor: 'M22 12h-4l-3 9L9 3l-3 9H2',
  database: 'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5',
  invitations: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  dot: 'M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
}
const iconOf = (key: string): string => ICONS[key] ?? ICONS[key.split(/[-_.]/)[0] ?? ''] ?? ICONS.dot ?? ''

/* ---------- 侧栏：桌面端固定为图标栏，第一组常开，其余组可折叠；手机端变抽屉 ---------- */
const mobileOpen = ref(false)
/** 弹出层（待办 / 账号菜单）；切换页面时由下方的路径监听关闭，所以要先声明 */
const popover = ref<'todos' | 'account' | null>(null)
const openGroups = ref<Set<number>>(new Set(props.groups.flatMap((group, i) => group.collapsed ? [] : [i])))

/* ---------- 外观：跟随系统 / 浅色 / 深色，选择记在本机 ---------- */
const theme = ref<'system' | 'light' | 'dark'>(readTheme())
function readTheme(): 'system' | 'light' | 'dark' {
  try { const v = localStorage.getItem('timo.theme'); return v === 'light' || v === 'dark' ? v : 'system' } catch { return 'system' }
}
function applyTheme() {
  const dark = theme.value === 'dark' || (theme.value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : ''
}
function setTheme(next: 'system' | 'light' | 'dark') {
  theme.value = next
  try { localStorage.setItem('timo.theme', next) } catch { /* 隐私模式下不记住偏好 */ }
  applyTheme()
}
applyTheme()
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme.value === 'system') applyTheme() })
watch(() => props.currentPath, () => {
  mobileOpen.value = false
  popover.value = null
})
watch(
  () => props.groups.map((group) => group.label).join('|'),
  () => { openGroups.value = new Set(props.groups.flatMap((group, i) => group.collapsed ? [] : [i])) },
)
function toggleGroup(index: number) {
  if (openGroups.value.has(index)) openGroups.value.delete(index)
  else openGroups.value.add(index)
}

const flatItems = computed(() => props.groups.flatMap((group) => group.items.map(item => ({ ...item, group: group.label }))))
const homeItem = computed(() => flatItems.value[0])
const currentItem = computed(() => flatItems.value.filter((item) => isActive(item.path)).sort((a, b) => b.path.length - a.path.length)[0] ?? homeItem.value)
const isHome = computed(() => !!homeItem.value && currentItem.value?.key === homeItem.value.key)
function isActive(path: string) {
  return props.currentPath === path || props.currentPath.startsWith(path + '/')
}
function handleNav(path: string) {
  emit('navigate', path)
  mobileOpen.value = false
  searchOpen.value = false
  popover.value = null
  searchQuery.value = ''
}

/* ---------- 顶部：问候、日期、待办、账号菜单 ---------- */
const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'
})
const today = computed(() => {
  const d = new Date()
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${'日一二三四五六'[d.getDay()]}`
})
const initials = computed(() => props.userName.slice(0, 1) || '我')
const todoTotal = computed(() => (props.todos ?? []).reduce((sum, todo) => sum + todo.count, 0))
function togglePopover(name: 'todos' | 'account') { popover.value = popover.value === name ? null : name }
function onDocClick(event: MouseEvent) {
  if (popover.value && !(event.target as HTMLElement).closest('.shell-popover, [data-popover-trigger]')) popover.value = null
}

/* ---------- 公告：本会话内可关闭 ---------- */
const dismissedAnnouncements = ref<Set<string>>(new Set())
const visibleAnnouncements = computed(() => (props.announcements ?? []).filter((a) => !dismissedAnnouncements.value.has(a.id)))
function dismissAnnouncement(id: string) {
  const next = new Set(dismissedAnnouncements.value)
  next.add(id)
  dismissedAnnouncements.value = next
}

/* ---------- Ctrl K 快速导航 ---------- */
const searchOpen = ref(false)
const searchQuery = ref('')
const searchIndex = ref(0)
const searchResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return flatItems.value
  return flatItems.value.filter((item) => `${item.label}${item.group}${item.path}`.toLowerCase().includes(q))
})
watch(searchQuery, () => { searchIndex.value = 0 })
function openSearch() {
  searchQuery.value = ''
  searchIndex.value = 0
  searchOpen.value = true
}
function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') { event.preventDefault(); searchIndex.value = Math.min(searchResults.value.length - 1, searchIndex.value + 1) }
  else if (event.key === 'ArrowUp') { event.preventDefault(); searchIndex.value = Math.max(0, searchIndex.value - 1) }
  else if (event.key === 'Enter') { const item = searchResults.value[searchIndex.value]; if (item) handleNav(item.path) }
}
function onGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    searchOpen.value ? (searchOpen.value = false) : openSearch()
  } else if (event.key === 'Escape') {
    popover.value = null
    mobileOpen.value = false
  }
}
onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <div class="studio-app" :data-menu-open="mobileOpen" :data-has-tabs="!!mobileTabs?.length">
    <aside class="studio-nav" aria-label="主导航">
      <div class="studio-brand">
        <button type="button" class="studio-mark" aria-label="回到首页" @click="handleNav(homeItem?.path ?? '/dashboard')">T</button>
        <div class="shell-label">
          <strong>TIMO</strong><span>{{ roleLabel }}</span>
        </div>
        <button type="button" class="nav-close" aria-label="关闭菜单" @click="mobileOpen = false">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <nav class="studio-nav-scroll">
        <div v-for="(group, gi) in groups" :key="group.label" class="studio-nav-group">
          <button
            v-if="gi > 0"
            type="button"
            class="nav-group-trigger"
            :data-state="openGroups.has(gi) ? 'open' : 'closed'"
            :aria-expanded="openGroups.has(gi)"
            @click="toggleGroup(gi)"
          >
            <span>{{ group.label }}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <template v-if="gi === 0 || openGroups.has(gi)">
            <button
              v-for="item in group.items"
              :key="item.key"
              type="button"
              class="studio-nav-item"
              :data-active="currentItem?.key === item.key"
              :aria-current="currentItem?.key === item.key ? 'page' : undefined"
              @click="handleNav(item.path)"
            >
              <svg class="shell-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="iconOf(item.key)" /></svg>
              <span class="shell-label">{{ item.label }}</span>
              <span v-if="item.badge" class="n">{{ item.badge > 99 ? '99+' : item.badge }}</span>
            </button>
          </template>
        </div>
      </nav>
      <div class="nav-utility">
        <div class="shell-pop-anchor rail-me">
          <button type="button" class="header-initials" data-popover-trigger :aria-expanded="popover === 'account'" aria-label="账号菜单" @click="togglePopover('account')">{{ initials }}</button>
          <span class="shell-label rail-me-name"><b>{{ userName }}</b><small>{{ roleLabel }}</small></span>
          <div v-if="popover === 'account'" class="shell-popover shell-account" role="menu">
            <div class="shell-account-head"><span class="header-initials" aria-hidden="true">{{ initials }}</span><div><b>{{ userName }}</b><small>{{ roleLabel }}</small></div></div>
            <button type="button" role="menuitem" @click="handleNav('/me')">我的</button>
            <button type="button" role="menuitem" @click="handleNav('/account/security')">账号安全</button>
            <div class="shell-theme" role="group" aria-label="外观">
              <span>外观</span>
              <div class="seg">
                <button v-for="t in ([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const)" :key="t[0]" type="button" :class="{ on: theme === t[0] }" @click="setTheme(t[0])">{{ t[1] }}</button>
              </div>
            </div>
            <button type="button" role="menuitem" class="danger" @click="popover = null; emit('logout')">退出登录</button>
          </div>
        </div>
      </div>
    </aside>
    <div class="studio-backdrop" @click="mobileOpen = false" />

    <section class="studio-content-shell">
      <header class="studio-header" :data-home="isHome">
        <div class="header-context">
          <button type="button" class="menu-toggle" aria-label="打开菜单" @click="mobileOpen = !mobileOpen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <div v-if="isHome" class="shell-greet">
            <h1>{{ greeting }}，{{ userName }}</h1>
            <p>{{ roleLabel }} · {{ today }}</p>
          </div>
          <div v-else class="shell-greet shell-greet-compact">
            <strong>{{ currentItem?.label ?? roleLabel }}</strong>
            <span>{{ currentItem?.group ? currentItem.group + ' · ' : '' }}{{ userName }}</span>
          </div>
        </div>
        <div class="header-controls">
          <button type="button" class="quiet-search" @click="openSearch">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.2" y2="16.2" /></svg>
            <span>搜索页面</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div v-if="todos" class="shell-pop-anchor">
            <button type="button" class="shell-icon-btn" data-popover-trigger :aria-expanded="popover === 'todos'" :aria-label="todoTotal ? `待办 ${todoTotal} 项` : '待办'" @click="togglePopover('todos')">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" /></svg>
              <span v-if="todoTotal" class="shell-badge">{{ todoTotal > 99 ? '99+' : todoTotal }}</span>
            </button>
            <div v-if="popover === 'todos'" class="shell-popover shell-todos" role="dialog" aria-label="待办">
              <p class="shell-pop-title">现在要做<span v-if="todos.length">{{ todos.length }} 项</span></p>
              <button v-for="todo in todos" :key="todo.key" type="button" class="shell-todo" @click="handleNav(todo.path)">
                <span class="shell-todo-count">{{ todo.count }}</span>
                <span class="shell-todo-text"><b>{{ todo.label }}</b><small v-if="todo.detail">{{ todo.detail }}</small></span>
                <span class="shell-todo-go">{{ todo.actionLabel ?? '去处理' }} →</span>
              </button>
              <div v-if="!todos.length" class="shell-pop-empty">
                <b>都处理完了</b>
                <span>新的待办会出现在这里。</span>
                <button type="button" class="ghost-aurora" @click="handleNav(homeItem?.path ?? '/dashboard')">回到首页</button>
              </div>
            </div>
          </div>
        </div>
      </header>
      <main class="studio-page">
        <div v-if="visibleAnnouncements.length" class="announce-stack">
          <div v-for="a in visibleAnnouncements" :key="a.id" class="announce-bar">
            <span class="announce-tag">公告</span>
            <strong>{{ a.title }}</strong>
            <span class="announce-body">{{ a.content }}</span>
            <button type="button" class="announce-close" aria-label="关闭公告" @click="dismissAnnouncement(a.id)">×</button>
          </div>
        </div>
        <slot />
      </main>
    </section>

    <!-- 手机底部标签栏 -->
    <nav v-if="mobileTabs?.length" class="shell-tabbar" aria-label="快捷导航">
      <button
        v-for="tab in mobileTabs"
        :key="tab.key"
        type="button"
        :data-active="isActive(tab.path)"
        :aria-current="isActive(tab.path) ? 'page' : undefined"
        @click="handleNav(tab.path)"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="iconOf(tab.key)" /></svg>
        <span>{{ tab.label }}</span>
      </button>
    </nav>

    <!-- 全局提示与撤销 -->
    <ToastHost />

    <!-- Ctrl K 快速导航 -->
    <div v-if="searchOpen" class="quicknav-overlay" @click.self="searchOpen = false">
      <div class="quicknav-panel" role="dialog" aria-label="快速导航">
        <div class="quicknav-input">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.2" y2="16.2" /></svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索页面或功能"
            autofocus
            @keydown="onSearchKeydown"
            @keydown.esc="searchOpen = false"
          />
          <kbd>Esc</kbd>
        </div>
        <div class="quicknav-list">
          <p class="quicknav-caption">{{ searchQuery ? '匹配页面' : '全部页面' }}</p>
          <template v-if="searchResults.length">
            <button
              v-for="(item, i) in searchResults"
              :key="item.key"
              type="button"
              class="quicknav-item"
              :data-active="i === searchIndex"
              @mouseenter="searchIndex = i"
              @click="handleNav(item.path)"
            >
              <span class="quicknav-main">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="iconOf(item.key)" /></svg>
                {{ item.label }}
              </span>
              <small>{{ item.group }}</small>
            </button>
          </template>
          <p v-else class="quicknav-empty">没有匹配的页面，换个关键词试试。</p>
        </div>
      </div>
    </div>
  </div>
</template>
