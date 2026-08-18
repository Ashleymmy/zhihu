import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AuthUser } from '@zhihu-koc/shared-contracts'
import { createApis, createHttpClient, isApiError } from '@zhihu-koc/shared-services'
import { DEFAULT_LOCALE, createTranslator } from '@zhihu-koc/shared-i18n'
import { checkWorkspaceAccess } from '../access'

const translate = createTranslator(DEFAULT_LOCALE)

const http = createHttpClient({
  onUnauthorized: () => {
    // 会话彻底失效（refresh 也失败）时回到登录页。
    if (globalThis.location && !globalThis.location.pathname.endsWith('/login')) {
      globalThis.location.href = '/login'
    }
  },
})

export const apis = createApis(http)

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const initialized = ref(false)
  const loggedIn = computed(() => user.value !== null)

  /** 登录并强制校验工作台角色；跨角色登录立即登出并抛错（fail closed）。 */
  async function login(username: string, password: string): Promise<void> {
    const result = await apis.auth.login({ username, password })
    if (checkWorkspaceAccess(result.user) !== 'ok') {
      http.tokens.set(null)
      await apis.auth.logout().catch(() => undefined)
      throw new Error(translate('auth.wrongWorkspace'))
    }
    http.tokens.set(result.token)
    user.value = result.user
  }

  /** 应用启动时恢复会话：优先用现有 Token 拉 me，失败再尝试 refresh。 */
  async function restore(): Promise<void> {
    if (initialized.value) return
    initialized.value = true
    try {
      if (!http.tokens.get()) {
        const refreshed = await http.refresh()
        if (!refreshed) return
      }
      const me = await apis.auth.me()
      if (checkWorkspaceAccess(me) !== 'ok') {
        http.tokens.set(null)
        return
      }
      user.value = me
    } catch (error) {
      if (isApiError(error) && error.status === 401) return
      // 网络抖动等场景保持未登录态，由路由守卫引导到登录页。
    }
  }

  async function logout(): Promise<void> {
    await apis.auth.logout().catch(() => undefined)
    http.tokens.set(null)
    user.value = null
  }

  return { user, loggedIn, initialized, login, restore, logout }
})
