<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { AppShell, type NavGroup, type ShellAnnouncement } from '@zhihu-koc/shared-components'
import { APP_ROLE } from '../app-config'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const currentPath = computed(() => route.path)

const announcements = ref<ShellAnnouncement[]>([])
onMounted(async () => {
  try { announcements.value = await apis.announcements.active() } catch { /* 公告加载失败不阻塞工作台 */ }
})

const navigation: NavGroup[] = [
  {
    label: '运营',
    items: [
      { key: 'dashboard', label: '数据看板', path: '/dashboard' },
      { key: 'plans', label: '推广计划', path: '/plans' },
      { key: 'analytics', label: '数据分析', path: '/analytics' },
    ],
  },
  {
    label: '业务',
    items: [
      { key: 'orders', label: '订单管理', path: '/orders' },
      { key: 'settlements', label: '结算管理', path: '/settlements' },
      { key: 'withdrawals', label: '提现审批', path: '/withdrawals' },
      { key: 'earnings', label: '收益结算', path: '/earnings' },
    ],
  },
  {
    label: '推广',
    items: [
      { key: 'keywords', label: '关键词回传', path: '/keywords' },
      { key: 'callbacks', label: '回传配置', path: '/callbacks' },
      { key: 'projects', label: '项目管理', path: '/projects' },
      { key: 'zhihu-story', label: '知乎故事', path: '/zhihu-story' },
    ],
  },
  {
    label: '增值',
    items: [
      { key: 'knowledge', label: '知识付费', path: '/knowledge' },
      { key: 'creative-tools', label: '创意工具坊', path: '/creative-tools' },
    ],
  },
  {
    label: '账户',
    items: [
      { key: 'team', label: '用户管理', path: '/team' },
      { key: 'mcn', label: 'MCN管理', path: '/mcn' },
      { key: 'sub-accounts', label: '子账号管理', path: '/sub-accounts' },
    ],
  },
  {
    label: '系统',
    items: [
      { key: 'system', label: '系统工具', path: '/system' },
      { key: 'audit-log', label: '审计日志', path: '/audit-log' },
    ],
  },
]

const roleLabels: Record<string, string> = {
  admin: '管理员',
  leader: '团长',
  creator: '达人',
}

function onNavigate(path: string) {
  router.push(path)
}

async function onLogout() {
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <AppShell
    :groups="navigation"
    :user-name="auth.user?.displayName ?? '管理员'"
    :role-label="roleLabels[APP_ROLE] ?? APP_ROLE"
    :current-path="currentPath"
    :announcements="announcements"
    @navigate="onNavigate"
    @logout="onLogout"
  >
    <RouterView />
  </AppShell>
</template>
