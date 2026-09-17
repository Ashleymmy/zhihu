import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AuthUser, RegisterReq } from '@zhihu-koc/shared-contracts/core'
import { createCoreApis, createHttpClient } from '@zhihu-koc/shared-services/core'
import { isValidAccount } from '../access'

export const http = createHttpClient({
  baseURL: '/api/v1/core',
  onUnauthorized: () => {
    if (globalThis.location && !/\/(login|register)$/.test(globalThis.location.pathname)) {
      globalThis.location.href = import.meta.env.BASE_URL + 'login'
    }
  },
})
export const apis = createCoreApis(http)
export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const initialized = ref(false)
  const loggedIn = computed(() => user.value !== null)
  let restoreTask: Promise<void> | null = null
  let validationTask: Promise<void> | null = null

  async function validateSession(): Promise<void> {
    validationTask ??= (async () => {
      try {
        const current = await apis.auth.me()
        if (!isValidAccount(current)) throw new Error('账号角色异常，请联系管理员')
        user.value = current
      } catch (error) {
        user.value = null
        http.tokens.set(null)
        throw error
      } finally { validationTask = null }
    })()
    return validationTask
  }
  async function login(username: string, password: string): Promise<void> {
    user.value = null
    http.tokens.set(null)
    const result = await apis.auth.login({ username, password })
    http.tokens.set(result.token)
    // /me provides current role and permissions; never infer these from local storage or the URL.
    await validateSession()
    initialized.value = true
  }
  async function register(input: RegisterReq): Promise<void> {
    await apis.auth.register(input)
  }
  async function restore(): Promise<void> {
    if (initialized.value) return
    restoreTask ??= (async () => {
      try {
        if (!http.tokens.get() && !await http.refresh()) return
        await validateSession()
      } catch { user.value = null }
      finally { initialized.value = true; restoreTask = null }
    })()
    return restoreTask
  }
  async function logout(): Promise<void> {
    await apis.auth.logout().catch(() => undefined)
    http.tokens.set(null)
    user.value = null
  }
  return { user, initialized, loggedIn, login, register, restore, validateSession, logout }
})
