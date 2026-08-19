<script setup lang="ts">
import { computed, ref } from 'vue'

export interface NavItem {
  key: string
  label: string
  path: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

const props = defineProps<{
  groups: NavGroup[]
  userName: string
  roleLabel: string
  currentPath: string
}>()

const emit = defineEmits<{
  navigate: [path: string]
  logout: []
}>()

const mobileOpen = ref(false)
const openGroups = ref<Set<number>>(new Set(props.groups.map((_, i) => i)))

function toggleGroup(index: number) {
  if (openGroups.value.has(index)) openGroups.value.delete(index)
  else openGroups.value.add(index)
}

function handleNav(path: string) {
  emit('navigate', path)
  mobileOpen.value = false
}

function isActive(path: string) {
  return props.currentPath === path || props.currentPath.startsWith(path + '/')
}

const initials = computed(() => props.userName.slice(0, 2).toUpperCase())
</script>

<template>
  <div class="studio-app" :data-menu-open="mobileOpen">
    <aside class="studio-nav">
      <div class="studio-brand">
        <span class="studio-mark">O</span>
        <div><strong>OPC</strong><span>OPERATIONS</span></div>
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
          <div><span class="crumb">{{ roleLabel }}</span><h1>{{ $slots.header?.() ?? '' }}</h1></div>
        </div>
        <div class="header-controls">
          <div class="quiet-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input type="text" placeholder="搜索..." />
          </div>
          <button type="button" class="notification-button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
            <i />
          </button>
        </div>
      </header>
      <main class="studio-page"><slot /></main>
    </section>
  </div>
</template>
