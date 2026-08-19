<script setup lang="ts">
import { RouterView, useRouter } from 'vue-router'
import { AppShell, type NavGroup } from '@zhihu-koc/shared-components'
import { APP_ROLE } from '../app-config'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

const navigation: NavGroup[] = [
  {
    label: '运营',
    items: [
      { key: 'dashboard', label: '数据看板', path: '/dashboard' },
      { key: 'plans', label: '推广计划', path: '/plans' },
    ],
  },
  {
    label: '业务',
    items: [
      { key: 'orders', label: '我的订单', path: '/orders' },
      { key: 'settlements', label: '结算中心', path: '/settlements' },
      { key: 'earnings', label: '收益结算', path: '/earnings' },
    ],
  },
  {
    label: '推广',
    items: [
      { key: 'keywords', label: '关键词回传', path: '/keywords' },
      { key: 'projects', label: '项目管理', path: '/projects' },
      { key: 'zhihu-story', label: '知乎故事', path: '/zhihu-story' },
    ],
  },
  {
    label: '增值',
    items: [
      { key: 'knowledge', label: '我的课堂', path: '/knowledge' },
      { key: 'creative-tools', label: '创意工具坊', path: '/creative-tools' },
    ],
  },
  {
    label: '账户',
    items: [
      { key: 'team', label: '个人信息', path: '/team' },
      { key: 'mcn', label: '申请入团', path: '/mcn' },
    ],
  },
]

const roleLabels: Record<string, string> = { admin: '管理员', leader: '团长', creator: '达人' }

async function onLogout() {
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <AppShell :groups="navigation" :user-name="auth.user?.displayName ?? '达人'" :role-label="roleLabels[APP_ROLE] ?? APP_ROLE" @logout="onLogout">
    <RouterView />
  </AppShell>
</template>
