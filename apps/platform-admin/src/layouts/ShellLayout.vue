<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppShell, type NavGroup, type ShellAnnouncement } from '@zhihu-koc/shared-components'
import { useAuthStore, apis } from '../stores/auth'
import { workspace } from '../stores/platform'
import { workspaceNavigation } from '../navigation'
import { ROLE_LABELS } from '@zhihu-koc/shared-contracts/core'
const auth = useAuthStore(),
  route = useRoute(),
  router = useRouter(),
  announcements = ref<ShellAnnouncement[]>([])
const navigation = computed<NavGroup[]>(() => workspaceNavigation(auth.user, workspace.modules.value.some(m => m.status === 'enabled')))
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
