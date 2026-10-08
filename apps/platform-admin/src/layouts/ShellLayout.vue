<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppShell, type NavGroup, type ShellAnnouncement } from '@zhihu-koc/shared-components'
import { useAuthStore, apis } from '../stores/auth'
import { workspace } from '../stores/platform'
import { canAccessPath } from '../access'
import { ROLE_LABELS } from '@zhihu-koc/shared-contracts/core'
const auth = useAuthStore(),
  route = useRoute(),
  router = useRouter(),
  announcements = ref<ShellAnnouncement[]>([])
const hasTeam = ref(false)
watch(() => [auth.user?.id, auth.user?.role, auth.user?.parentId].join(':'), async (identity) => {
  hasTeam.value = false
  if (auth.user?.role !== 'creator') return
  try {
    const affiliation = await apis.team.myAffiliation()
    if ([auth.user?.id, auth.user?.role, auth.user?.parentId].join(':') === identity)
      hasTeam.value = !!affiliation.team
  } catch { /* The team page offers a retry if its details cannot be loaded. */ }
}, { immediate: true })
const navigation = computed<NavGroup[]>(() => {
  const groups: NavGroup[] = [
    {
      label: '工作空间',
      items: [
        { key: 'dashboard', label: '工作台', path: '/dashboard' },
        { key: 'projects', label: '业务项目', path: '/projects' },
        { key: 'modules', label: '业务模块', path: '/modules' },
        { key: 'finance', label: '财务中心', path: '/finance' },
        { key: 'security', label: '账号安全', path: '/account/security' },
      ],
    },
    {
      label: '组织',
      items: [
        { key: 'team', label: '团队与成员', path: '/team' },
        { key: 'invitations', label: '邀请链接', path: '/invitations' },
        { key: 'mcn', label: '运营账户', path: '/mcn' },
      ],
    },
    {
      label: '系统',
      items: [
        { key: 'roles', label: '角色与账号', path: '/system/roles' },
        { key: 'monitor', label: '运维监控', path: '/system/monitor' },
        { key: 'announcements', label: '系统公告', path: '/system/announcements' },
        { key: 'audit', label: '审计日志', path: '/audit-log' },
        { key: 'database', label: '数据库状态', path: '/system/db' },
      ],
    },
  ]
  if (auth.user?.role === 'creator') groups.push({ label: '个人', items: [
    { key: 'profile', label: '个人资料', path: '/profile' },
    { key: 'join-team', label: hasTeam.value ? '我的团队' : '加入团队', path: '/join-team' },
  ] })
  const enabled = workspace.modules.value.filter((m) => m.status === 'enabled')
  if (enabled.length)
    groups.push({
      label: '已接入业务',
      items: enabled.map((m) => m.id === 'zhihu' ? {
        key: m.id, label: m.name, path: '/modules/zhihu', children: [
          ...(auth.user?.adminDuty === 'finance' ? [] : [{ key: 'zhihu-story', label: '知乎故事', path: '/modules/zhihu/history' }]),
          { key: 'zhihu-more', label: '更多功能', path: '/modules/zhihu/more' },
        ],
      } : ({ key: m.id, label: m.name, path: m.entryPath })),
    })
  return groups.map(group => ({ ...group, items: group.items.filter(item => canAccessPath(auth.user, item.path)) })).filter(group => group.items.length)

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
    :role-label="auth.user ? (auth.user.role==='admin' && auth.user.adminDuty==='finance'?'财务管理员':ROLE_LABELS[auth.user.role]) : ''"
    :current-path="route.path"
    :announcements="announcements"
    @navigate="router.push"
    @logout="logout"
    ><router-view :key="auth.user?.id + '-' + auth.user?.role + '-' + auth.user?.adminDuty"
  /></AppShell>
</template>
