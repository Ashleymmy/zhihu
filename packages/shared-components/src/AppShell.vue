<script setup lang="ts">
import type { GlobalRole } from '@zhihu-koc/shared-contracts'
import WorkspaceBadge from './WorkspaceBadge.vue'

export interface ShellNavItem {
  key: string
  label: string
}

defineProps<{
  role: GlobalRole | null
  workspaceLabel: string
  userName: string
  logoutLabel: string
  navItems: ShellNavItem[]
  activeKey: string
}>()

const emit = defineEmits<{
  navigate: [key: string]
  logout: []
}>()
</script>

<template>
  <div class="app-shell">
    <header class="app-shell__header">
      <div class="app-shell__brand">
        <WorkspaceBadge :role="role" :label="workspaceLabel" />
      </div>
      <nav class="app-shell__nav">
        <button
          v-for="item in navItems"
          :key="item.key"
          type="button"
          class="app-shell__nav-item"
          :class="{ 'app-shell__nav-item--active': item.key === activeKey }"
          @click="emit('navigate', item.key)"
        >
          {{ item.label }}
        </button>
      </nav>
      <div class="app-shell__user">
        <span>{{ userName }}</span>
        <button type="button" class="app-shell__logout" @click="emit('logout')">{{ logoutLabel }}</button>
      </div>
    </header>
    <main class="app-shell__body">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.app-shell__header {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 10px 24px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
}
.app-shell__nav {
  display: flex;
  gap: 4px;
  flex: 1;
}
.app-shell__nav-item {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.65);
  cursor: pointer;
}
.app-shell__nav-item:hover {
  background: rgba(0, 0, 0, 0.04);
}
.app-shell__nav-item--active {
  background: #e6f4ff;
  color: #1677ff;
}
.app-shell__user {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}
.app-shell__logout {
  padding: 4px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.app-shell__body {
  flex: 1;
  padding: 24px;
}
</style>
