<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppShell, type NavGroup, type ShellAnnouncement, type ShellTodo } from '@zhihu-koc/shared-components'
import { useAuthStore, apis, http } from '../stores/auth'
import { workspace } from '../stores/platform'
import { mobileTabs, workspaceNavigation } from '../navigation'
import { ROLE_LABELS } from '@zhihu-koc/shared-contracts/core'
const auth = useAuthStore(),
  route = useRoute(),
  router = useRouter(),
  announcements = ref<ShellAnnouncement[]>([])
const navigation = computed<NavGroup[]>(() => workspaceNavigation(auth.user, workspace.modules.value.some(m => m.status === 'enabled')))
const tabs = computed(() => mobileTabs(auth.user, navigation.value))

/* 顶栏待办：复用首页的待办接口；读取失败时不显示铃铛，切换页面时最多每分钟刷新一次 */
interface DashboardTodo { kind: string; count: number; label: string; actor: string; actionLabel: string; path: string }
interface DashboardOverview { groups: { id: string; name: string; services: { accountId: string; todos: DashboardTodo[] }[] }[] }
const todos = ref<ShellTodo[] | undefined>()
let todosLoadedAt = 0
async function loadTodos(force = false) {
  if (!auth.user || (!force && Date.now() - todosLoadedAt < 60_000)) return
  todosLoadedAt = Date.now()
  try {
    const data = await http.get<DashboardOverview>('/dashboard')
    todos.value = data.groups.flatMap(project => project.services.flatMap(service => service.todos.map(todo => ({
      key: `${project.id}:${service.accountId}:${todo.kind}`,
      label: todo.label,
      count: todo.count,
      path: todo.path,
      detail: `${project.name} · ${todo.actor}`,
      actionLabel: todo.actionLabel,
    }))))
  } catch { /* 保留上一次的结果 */ }
}
watch(() => route.path, () => { void loadTodos() })
onMounted(async () => {
  void loadTodos(true)
  try {
    announcements.value = await apis.announcements.active()
  } catch {}
})
async function logout() {
  await auth.logout()
  workspace.projectId.value = ''
  workspace.modules.value = []
  await router.replace('/login')
}
</script>
<template>
  <AppShell
    :groups="navigation"
    :user-name="auth.user?.displayName ?? ''"
    :role-label="auth.user ? (auth.user.role==='admin' && auth.user.adminDuty==='finance'?'财务管理员':ROLE_LABELS[auth.user.role]) : ''"
    :current-path="route.path"
    :announcements="announcements"
    :todos="todos"
    :mobile-tabs="tabs"
    @navigate="router.push"
    @logout="logout"
    ><router-view :key="auth.user?.id + '-' + auth.user?.role + '-' + auth.user?.adminDuty"
  /></AppShell>
</template>
