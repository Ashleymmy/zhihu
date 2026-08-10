import { defineStore } from 'pinia'
import { authApi } from '@/api/auth'
import type { AuthUser } from '@/types/api'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') as string | null,
    user: null as AuthUser | null,
    loading: false,
  }),

  getters: {
    isLoggedIn: (s) => !!s.token,
    role: (s) => s.user?.role,
    isBoss: (s) => s.user?.role === 'boss',
    isLeader: (s) => s.user?.role === 'leader' || s.user?.role === 'boss',
    permissions: (s): string[] => s.user?.permissions ?? [],
    can: (s) => (permission: string): boolean =>
      s.user?.permissions?.includes(permission) ?? false,
  },

  actions: {
    async login(username: string, password: string) {
      this.loading = true
      try {
        const resp = await authApi.login({ username, password })
        this.token = resp.token
        this.user = resp.user
        localStorage.setItem('token', resp.token)
      } finally {
        this.loading = false
      }
    },

    async fetchMe() {
      if (this.user) return
      const me = await authApi.me()
      this.user = me
    },

    async logout() {
      try {
        await authApi.logout()
      } catch {
        // ignore server-side errors on logout
      } finally {
        this.token = null
        this.user = null
        localStorage.removeItem('token')
      }
    },
  },
})
