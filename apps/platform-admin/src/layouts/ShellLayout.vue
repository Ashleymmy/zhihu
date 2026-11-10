<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppShell, type NavGroup, type ShellAnnouncement, type ShellTodo } from '@zhihu-koc/shared-components'
import { useAuthStore, apis, http } from '../stores/auth'
import { workspace } from '../stores/platform'
import { mobileTabs, workspaceNavigation } from '../navigation'
import { ROLE_LABELS } from '@zhihu-koc/shared-contracts/core'
import type { ReminderItem } from '@zhihu-koc/shared-contracts/core'
import { createReminderApi } from '@zhihu-koc/shared-services/core'
import { createReminderInbox } from '../reminder-inbox'
import BusinessEvidenceReminderDrawer from '../components/BusinessEvidenceReminderDrawer.vue'
const auth = useAuthStore(),
  route = useRoute(),
  router = useRouter(),
  announcements = ref<ShellAnnouncement[]>([])
/** 侧栏角标：把待办数按路径聚合到导航项（精确或前缀匹配） */
const navigation = computed<NavGroup[]>(() => {
  const base = workspaceNavigation(auth.user, workspace.modules.value.some(m => m.status === 'enabled'))
  const list = todosError.value ? undefined : todos.value
  if (!list?.length) return base
  return base.map(group => ({
    ...group,
    items: group.items.map(item => {
      let badge = 0
      for (const todo of list) {
        if (todo.path && (todo.path === item.path || todo.path.startsWith(item.path + '/'))) badge += todo.count
      }
      return badge ? { ...item, badge } : item
    }),
  }))
})
const tabs = computed(() => mobileTabs(auth.user, navigation.value))
const inbox=createReminderInbox(createReminderApi(http))
watch(()=>[auth.user?.id,auth.user?.role,auth.user?.adminDuty].join(':'),()=>{
  inbox.reset(auth.user?[auth.user.id,auth.user.role,auth.user.adminDuty].join(':'):'')
  void inbox.load()
},{immediate:true})
let reminderTimer:ReturnType<typeof setInterval>|undefined
function refreshReminders() { if(document.visibilityState==='visible') void inbox.load() }
onMounted(()=>{reminderTimer=setInterval(refreshReminders,60000);window.addEventListener('focus',refreshReminders)})
onBeforeUnmount(()=>{clearInterval(reminderTimer);window.removeEventListener('focus',refreshReminders);inbox.reset('')})
async function openReminder(item:ReminderItem) { if(await inbox.read(item,true)) await router.push(item.path) }

/* 顶栏待办：复用首页的待办接口；读取失败时不显示铃铛，切换页面时最多每分钟刷新一次 */
interface DashboardTodo { kind: string; count: number; label: string; actor: string; actionLabel: string; path: string }
interface DashboardOverview { groups: { id: string; name: string; services: { accountId: string; todos: DashboardTodo[] }[] }[]; todos?: DashboardTodo[] }
const todos = ref<ShellTodo[] | undefined>()
const todosError = ref('')
let todosLoadedAt = 0
let todosGeneration=0
async function loadTodos(force = false) {
  if (!auth.user || (!force && Date.now() - todosLoadedAt < 60_000)) return
  todosLoadedAt = Date.now()
  const current=++todosGeneration
  try {
    const data = await http.get<DashboardOverview>('/dashboard')
    if(current!==todosGeneration)return
    todos.value = data.groups.flatMap(project => project.services.flatMap(service => service.todos.map(todo => ({
      key: `${project.id}:${service.accountId}:${todo.kind}`,
      label: todo.label,
      count: todo.count,
      path: todo.path,
      detail: `${project.name} · ${todo.actor}`,
      actionLabel: todo.actionLabel,
    })))).concat((data.todos ?? []).map(todo => ({
      key: `platform:${todo.kind}`,
      label: todo.label,
      count: todo.count,
      path: todo.path,
      detail: `平台 · ${todo.actor}`,
      actionLabel: todo.actionLabel,
    })))
    todosError.value = ''
  } catch { if(current===todosGeneration)todosError.value = '待办暂未更新，下面保留上次读取的内容。请重新读取确认最新进度。' }
}
watch(()=>[auth.user?.id,auth.user?.role,auth.user?.adminDuty].join(':'),()=>{todosGeneration++;todos.value=undefined;todosError.value='';todosLoadedAt=0;void loadTodos(true)})
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
    :todos-error="todosError"
    :reminders="inbox.list.value"
    :reminders-unread="inbox.unread.value"
    :reminders-error="inbox.error.value"
    :reminders-loading="inbox.loading.value"
    :reminders-has-more="(inbox.list.value?.length ?? 0) < inbox.total.value"
    :reminders-state="inbox.state.value"
    :mobile-tabs="tabs"
    @navigate="router.push"
    @logout="logout"
    @refresh-todos="loadTodos(true)"
    @refresh-reminders="inbox.load()"
    @more-reminders="inbox.load(true)"
    @reminder-state="inbox.select"
    @open-reminder="openReminder"
    @read-reminder="inbox.read"
    ><router-view :key="auth.user?.id + '-' + auth.user?.role + '-' + auth.user?.adminDuty + '-' + route.path"
  /><BusinessEvidenceReminderDrawer @updated="inbox.load();loadTodos(true)" /></AppShell>
</template>
