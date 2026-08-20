<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export interface NavItem {
  key: string
  label: string
  path: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export interface ShellAnnouncement {
  id: string
  title: string
  content: string
}

const props = defineProps<{
  groups: NavGroup[]
  userName: string
  roleLabel: string
  currentPath: string
  announcements?: ShellAnnouncement[]
}>()

const emit = defineEmits<{
  navigate: [path: string]
  logout: []
}>()

const mobileOpen = ref(false)
const searchOpen = ref(false)
const searchQuery = ref('')
const openGroups = ref<Set<number>>(new Set(props.groups.map((_, i) => i)))

/** 拍平导航，为每个条目分配全局序号（01 / 02 / ...） */
const flatItems = computed(() =>  props.groups.flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.label })),
  ),
)

const currentItem = computed(() =>
  flatItems.value.find((item) => isActive(item.path)) ?? flatItems.value[0],
)

const currentIndex = computed(() => {
  const idx = flatItems.value.findIndex((item) => item.key === currentItem.value?.key)
  return idx >= 0 ? String(idx + 1).padStart(2, '0') : '01'
})

/* 公告：本会话内可关闭 */
const dismissedAnnouncements = ref<Set<string>>(new Set())
const visibleAnnouncements = computed(() =>
  (props.announcements ?? []).filter((a) => !dismissedAnnouncements.value.has(a.id)),
)
function dismissAnnouncement(id: string) {
  const next = new Set(dismissedAnnouncements.value)
  next.add(id)
  dismissedAnnouncements.value = next
}

const searchResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return flatItems.value
  return flatItems.value.filter((item) =>
    `${item.label}${item.group}${item.path}`.toLowerCase().includes(q),
  )
})

function toggleGroup(index: number) {
  if (openGroups.value.has(index)) openGroups.value.delete(index)
  else openGroups.value.add(index)
}

function handleNav(path: string) {
  emit('navigate', path)
  mobileOpen.value = false
  searchOpen.value = false
  searchQuery.value = ''
}

function isActive(path: string) {
  return props.currentPath === path || props.currentPath.startsWith(path + '/')
}

function openSearch() {
  searchQuery.value = ''
  searchOpen.value = true
}

function onSearchKeydown(event: KeyboardEvent) {
  const first = searchResults.value[0]
  if (event.key === 'Enter' && first) {
    handleNav(first.path)
  }
}

function onGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    searchOpen.value ? (searchOpen.value = false) : openSearch()
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown))

const initials = computed(() => props.userName.slice(0, 2).toUpperCase())
</script>

<template>
  <div class="studio-app" :data-menu-open="mobileOpen">
    <aside class="studio-nav">
      <div class="studio-brand">
        <span class="studio-mark">O</span>
        <div><strong>OPC</strong><span>Desk / {{ roleLabel }}</span></div>
      </div>
      <nav class="studio-nav-scroll">
        <div v-for="(group, gi) in groups" :key="group.label" class="studio-nav-group">
          <button type="button" class="nav-group-trigger" :data-state="openGroups.has(gi) ? 'open' : 'closed'" @click="toggleGroup(gi)">
            {{ group.label }}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          <template v-if="openGroups.has(gi)">
            <button v-for="item in group.items" :key="item.key" type="button" class="studio-nav-item" :data-active="isActive(item.path)" @click="handleNav(item.path)">
              {{ item.label }}
            </button>
          </template>
        </div>
      </nav>
      <div class="nav-utility">
        <button type="button" class="utility-link" @click="emit('logout')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          退出登录
        </button>
        <div class="account-chip">
          <span>{{ initials }}</span>
          <div><strong>{{ userName }}</strong><small>{{ roleLabel }}</small></div>
        </div>
      </div>
    </aside>
    <div class="studio-backdrop" @click="mobileOpen = false" />
    <section class="studio-content-shell">
      <header class="studio-header">
        <div class="header-context">
          <button type="button" class="menu-toggle" @click="mobileOpen = !mobileOpen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <span class="crumb">{{ currentItem?.label ?? roleLabel }} / {{ currentIndex }}</span>
        </div>
        <div class="header-controls">
          <button type="button" class="quiet-search" @click="openSearch">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <span>搜索</span>
            <kbd>⌘K</kbd>
          </button>
        </div>
      </header>
      <main class="studio-page">
        <div v-if="visibleAnnouncements.length" class="announce-stack">
          <div v-for="a in visibleAnnouncements" :key="a.id" class="announce-bar">
            <span class="announce-tag">公告</span>
            <strong>{{ a.title }}</strong>
            <span class="announce-body">{{ a.content }}</span>
            <button type="button" class="announce-close" @click="dismissAnnouncement(a.id)">×</button>
          </div>
        </div>
        <slot />
      </main>
    </section>

    <!-- ⌘K 快速导航 -->
    <div v-if="searchOpen" class="quicknav-overlay" @click.self="searchOpen = false">
      <div class="quicknav-panel" role="dialog" aria-label="快速导航">
        <div class="quicknav-input">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索页面或功能"
            autofocus
            @keydown="onSearchKeydown"
            @keydown.esc="searchOpen = false"
          />
        </div>
        <div class="quicknav-list">
          <p class="quicknav-caption">{{ searchQuery ? '匹配页面' : '全部页面' }}</p>
          <template v-if="searchResults.length">
            <button
              v-for="item in searchResults"
              :key="item.key"
              type="button"
              class="quicknav-item"
              @click="handleNav(item.path)"
            >
              <span>{{ item.label }}</span>
              <small>{{ item.group }}</small>
            </button>
          </template>
          <p v-else class="quicknav-empty">没有匹配记录。</p>
        </div>
      </div>
    </div>
  </div>
</template>
