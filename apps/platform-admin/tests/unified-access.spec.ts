import { describe, expect, it } from 'vitest'
import { fakeUser } from '@zhihu-koc/test-support'
import { canAccessPath, isValidAccount, safeRedirect } from '../src/access'

describe('统一入口与权限', () => {
  it.each(['admin', 'leader', 'creator'] as const)(
    '同一入口接受 %s 角色',
    (role) => {
      expect(isValidAccount(fakeUser({ role }))).toBe(true)
      expect(canAccessPath(fakeUser({ role }), '/dashboard')).toBe(true)
    },
  )
  it('拒绝未登录和未知角色', () => {
    expect(isValidAccount(null)).toBe(false)
    expect(canAccessPath(null, '/dashboard')).toBe(false)
    expect(isValidAccount({ ...fakeUser(), role: 'unknown' } as never)).toBe(
      false,
    )
  })
  it('角色和服务端权限同时满足才显示团队管理', () => {
    const leader = fakeUser({ role: 'leader', permissions: [] })
    for (const path of ['/team', '/TEAM', '/team/'])
      expect(canAccessPath(leader, path)).toBe(false)
    expect(
      canAccessPath({ ...leader, permissions: ['team.view'] }, '/team'),
    ).toBe(true)
    expect(
      canAccessPath(
        fakeUser({ role: 'creator', permissions: ['team.view'] }),
        '/team',
      ),
    ).toBe(false)
  })
  it('达人独有个人资料与入团入口', () => {
    expect(
      canAccessPath(
        fakeUser({ role: 'creator', permissions: ['team.apply'] }),
        '/join-team',
      ),
    ).toBe(true)
    expect(canAccessPath(fakeUser({ role: 'leader' }), '/profile')).toBe(false)
    expect(canAccessPath(fakeUser({ role: 'creator' }), '/system/db')).toBe(
      false,
    )
  })
  it('管理员职责限制仍然生效', () => {
    const finance = fakeUser({
      role: 'admin',
      adminDuty: 'finance',
      permissions: ['team.view'],
    })
    expect(canAccessPath(finance, '/team')).toBe(false)
    expect(canAccessPath(finance, '/finance')).toBe(true)
    const operations = fakeUser({ role: 'admin', adminDuty: 'operations' })
    expect(canAccessPath(operations, '/FINANCE/')).toBe(false)
    expect(canAccessPath(operations, '/system/db')).toBe(false)
  })
})
describe('登录跳转校验', () => {
  it.each([
    'https://example.com',
    '//example.com',
    '/%2fexample.com',
    '/%5cexample.com',
    '/\\example.com',
    '/login',
    '/register?redirect=/team',
    '/%0aexample.com',
    '/%bad',
    null,
  ])('拒绝不安全或循环跳转 %s', (value) => {
    expect(safeRedirect(value)).toBe('/dashboard')
  })
  it('保留站内路径与查询参数', () =>
    expect(safeRedirect('/projects?id=1')).toBe('/projects?id=1'))
})
