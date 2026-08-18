<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DEFAULT_LOCALE, createTranslator } from '@zhihu-koc/shared-i18n'
import { isApiError } from '@zhihu-koc/shared-services'
import { WorkspaceBadge } from '@zhihu-koc/shared-components'
import { APP_ROLE } from '../app-config'
import { useAuthStore } from '../stores/auth'

const t = createTranslator(DEFAULT_LOCALE)
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const username = ref('')
const password = ref('')
const submitting = ref(false)
const errorMessage = ref('')

const workspaceTitle = t(`workspace.${APP_ROLE}`)

async function submit() {
  if (!username.value || !password.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    await auth.login(username.value, password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.replace(redirect)
  } catch (error) {
    if (isApiError(error)) errorMessage.value = error.message
    else if (error instanceof Error) errorMessage.value = error.message
    else errorMessage.value = t('auth.loginFailed')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login">
    <form class="login__card" @submit.prevent="submit">
      <WorkspaceBadge :role="APP_ROLE" :label="workspaceTitle" />
      <h1 class="login__title">{{ t('auth.login') }}</h1>
      <label class="login__field">
        <span>{{ t('auth.username') }}</span>
        <input v-model.trim="username" name="username" autocomplete="username" required />
      </label>
      <label class="login__field">
        <span>{{ t('auth.password') }}</span>
        <input v-model="password" name="password" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="errorMessage" class="login__error" role="alert">{{ errorMessage }}</p>
      <button class="login__submit" type="submit" :disabled="submitting">
        {{ submitting ? t('common.loading') : t('auth.login') }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.login {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 24px;
}
.login__card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(360px, 100%);
  padding: 32px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}
.login__title {
  margin: 0;
  font-size: 20px;
}
.login__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.login__field input {
  padding: 8px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
}
.login__error {
  margin: 0;
  color: #cf1322;
  font-size: 13px;
}
.login__submit {
  padding: 10px 0;
  border: none;
  border-radius: 6px;
  background: #1677ff;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
.login__submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
