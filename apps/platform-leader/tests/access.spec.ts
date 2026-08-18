import { describe, expect, it } from 'vitest'
import { fakeUser } from '@zhihu-koc/test-support'
import { checkWorkspaceAccess } from '../src/access'
import { APP_ROLE } from '../src/app-config'

describe(`workspace 门禁（${APP_ROLE}）`, () => {
  it('本角色放行', () => {
    expect(checkWorkspaceAccess(fakeUser({ role: APP_ROLE }))).toBe('ok')
  })

  it('其余两个角色一律拒绝', () => {
    const others = (['admin', 'leader', 'creator'] as const).filter((role) => role !== APP_ROLE)
    for (const role of others) {
      expect(checkWorkspaceAccess(fakeUser({ role })), role).toBe('wrong-workspace')
    }
  })

  it('未登录 fail closed', () => {
    expect(checkWorkspaceAccess(null)).toBe('unauthenticated')
    expect(checkWorkspaceAccess(undefined)).toBe('unauthenticated')
  })
})
