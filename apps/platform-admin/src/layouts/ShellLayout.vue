<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppShell, type NavGroup, type ShellAnnouncement } from '@zhihu-koc/shared-components'
import { useAuthStore, apis } from '../stores/auth'
import { workspace } from '../stores/platform'
const auth = useAuthStore(),
  route = useRoute(),
  router = useRouter(),
  announcements = ref<ShellAnnouncement[]>([])
const navigation = computed<NavGroup[]>(() => {
  const groups: NavGroup[] = [
    {
      label: 'OPC',
      items: [
        { key: 'dashboard', label: '工作台', path: '/dashboard' },
        { key: 'projects', label: '业务项目', path: '/projects' },
        { key: 'modules', label: '业务模块', path: '/modules' },
        { key: 'finance', label: '财务中心', path: '/finance' },
      ],
    },
    {
      label: '组织',
      items: [
        { key: 'team', label: '团队与成员', path: '/team' },
        { key: 'mcn', label: '运营账户', path: '/mcn' },
      ],
    },
    {
      label: '系统',
      items: [
        { key: 'monitor', label: '账号监控', path: '/system/monitor' },
        { key: 'announcements', label: '系统公告', path: '/system/announcements' },
        { key: 'audit', label: '审计日志', path: '/audit-log' },
        { key: 'database', label: '数据库状态', path: '/system/db' },
      ],
    },
  ]
  const enabled = workspace.modules.value.filter((m) => m.status === 'enabled')
  if (enabled.length)
    groups.push({
      label: '已接入业务',
      items: enabled.map((m) => ({ key: m.id, label: m.name, path: m.entryPath })),
    })
  return groups
})
onMounted(async () => {
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
    :role-label="auth.user?.role === 'admin' ? '管理员' : auth.user?.role === 'leader' ? '团长' : '达人'"
    :current-path="route.path"
    :announcements="announcements"
    @navigate="router.push"
    @logout="logout"
    ><router-view
  /></AppShell>
</template>
