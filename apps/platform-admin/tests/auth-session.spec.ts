import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fakeUser } from '@zhihu-koc/test-support'
const mocks = vi.hoisted(() => ({ me: vi.fn(), login: vi.fn(), setToken: vi.fn() }))
vi.mock('@zhihu-koc/shared-services/core', () => ({
  createHttpClient: () => ({ tokens: { get: () => 'session-token', set: mocks.setToken }, refresh: vi.fn() }),
  createCoreApis: () => ({ auth: { me: mocks.me, login: mocks.login } }),
  isApiError: (error: unknown) => !!error && typeof error === 'object' && 'code' in error,
}))
import { useAuthStore } from '../src/stores/auth'
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })
it.each([429, 503, undefined])('keeps an existing login on a temporary validation failure (%s)', async status => {
  const auth = useAuthStore(); mocks.login.mockResolvedValue({ token: 'session-token' }); mocks.me.mockResolvedValue(fakeUser({ role: 'creator' }))
  await auth.login('creator', 'unused'); mocks.setToken.mockClear()
  mocks.me.mockRejectedValue({ code: 'TEMPORARY', message: '稍后重试', status })
  await expect(auth.validateSession()).rejects.toMatchObject({ code: 'TEMPORARY' })
  expect(auth.loggedIn).toBe(true); expect(mocks.setToken).not.toHaveBeenCalled()
})
it('clears a revoked login and rejects a malformed role', async () => {
  const auth = useAuthStore(); mocks.me.mockResolvedValue(fakeUser({ role: 'creator' })); await auth.validateSession()
  mocks.me.mockRejectedValue({ code: 40101, message: '请重新登录', status: 401 })
  await expect(auth.validateSession()).rejects.toMatchObject({ status: 401 }); expect(auth.loggedIn).toBe(false); expect(mocks.setToken).toHaveBeenCalledWith(null)
  mocks.me.mockResolvedValue({ ...fakeUser(), role: 'unknown' })
  await expect(auth.validateSession()).rejects.toMatchObject({ code: 'INVALID_ACCOUNT' }); expect(auth.loggedIn).toBe(false)
})
