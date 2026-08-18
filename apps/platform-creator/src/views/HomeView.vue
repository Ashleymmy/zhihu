<script setup lang="ts">
import { useRouter } from 'vue-router'
import { DEFAULT_LOCALE, createTranslator } from '@zhihu-koc/shared-i18n'
import { WorkspaceBadge } from '@zhihu-koc/shared-components'
import { APP_ROLE } from '../app-config'
import { useAuthStore } from '../stores/auth'

const t = createTranslator(DEFAULT_LOCALE)
const auth = useAuthStore()
const router = useRouter()

const workspaceTitle = t(`workspace.${APP_ROLE}`)

async function logout() {
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="shell">
    <header class="shell__header">
      <WorkspaceBadge :role="APP_ROLE" :label="workspaceTitle" />
      <div class="shell__user">
        <span>{{ auth.user?.displayName }}</span>
        <button type="button" class="shell__logout" @click="logout">{{ t('auth.logout') }}</button>
      </div>
    </header>
    <main class="shell__body">
      <h1>{{ t('nav.overview') }}</h1>
      <p class="shell__placeholder">{{ t('common.empty') }}</p>
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.shell__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
}
.shell__user {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}
.shell__logout {
  padding: 4px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.shell__body {
  flex: 1;
  padding: 24px;
}
.shell__body h1 {
  margin: 0 0 12px;
  font-size: 18px;
}
.shell__placeholder {
  color: rgba(0, 0, 0, 0.45);
}
</style>
