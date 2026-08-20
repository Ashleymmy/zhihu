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
    label: '团队',
    items: [
      { key: 'team', label: '达人管理', path: '/team' },
      { key: 'mcn', label: 'MCN管理', path: '/mcn' },
    ],
  },
]

const roleLabels: Record<string, string> = { admin: '管理员', leader: '团长', creator: '达人' }

function onNavigate(path: string) { router.push(path) }
async function onLogout() {
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <AppShell :groups="navigation" :user-name="auth.user?.displayName ?? '团长'" :role-label="roleLabels[APP_ROLE] ?? APP_ROLE" :current-path="currentPath"
    :announcements="announcements" @navigate="onNavigate" @logout="onLogout">
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
  </AppShell>
</template>
