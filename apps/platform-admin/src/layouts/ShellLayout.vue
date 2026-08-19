<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { AppShell, type ShellNavItem } from '@zhihu-koc/shared-components'
import { DEFAULT_LOCALE, createTranslator, type MessageKey } from '@zhihu-koc/shared-i18n'
import { APP_NAV, APP_ROLE } from '../app-config'
import { useAuthStore } from '../stores/auth'

const t = createTranslator(DEFAULT_LOCALE)
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const navItems = computed<ShellNavItem[]>(() =>
  APP_NAV.map((key) => ({ key, label: t(`nav.${key}` as MessageKey) })),
)
const activeKey = computed(() => String(route.name ?? ''))

async function onLogout() {
  await auth.logout()
  await router.replace({ name: 'login' })
}

function onNavigate(key: string) {
  void router.push({ name: key })
}
</script>

<template>
  <AppShell
    :role="APP_ROLE"
    :workspace-label="t(`workspace.${APP_ROLE}`)"
    :user-name="auth.user?.displayName ?? ''"
    :logout-label="t('auth.logout')"
    :nav-items="navItems"
    :active-key="activeKey"
    @navigate="onNavigate"
    @logout="onLogout"
  >
    <RouterView />
  </AppShell>
</template>
