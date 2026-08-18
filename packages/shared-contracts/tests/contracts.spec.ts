import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  bffFailureEnvelopeSchema,
  createBffPaginatedEnvelopeSchema,
  createBffSuccessEnvelopeSchema,
  financeGateRejectedSchema,
  hasPermission,
  isGlobalRole,
} from '../src'
import { z } from 'zod'

const envelope = createBffSuccessEnvelopeSchema(z.object({ id: z.string() }))

describe('BFF Envelope', () => {
  it('接受合法的成功响应', () => {
    const parsed = envelope.parse({
      code: 0,
      message: 'ok',
      requestId: 'req-1',
      timestamp: 1_700_000_000,
      data: { id: '1' },
    })
    expect(parsed.data.id).toBe('1')
  })

  it('拒绝缺失 data 的成功响应', () => {
    expect(() => envelope.parse({ code: 0, message: 'ok', requestId: 'req-1', timestamp: 1 })).toThrow()
  })

  it('拒绝显式 undefined 的 data', () => {
    expect(() =>
      envelope.parse({ code: 0, message: 'ok', requestId: 'req-1', timestamp: 1, data: undefined }),
    ).toThrow()
  })

  it('拒绝空白 requestId', () => {
    expect(() =>
      envelope.parse({ code: 0, message: 'ok', requestId: '   ', timestamp: 1, data: { id: '1' } }),
    ).toThrow()
  })

  it('拒绝多余字段（strict）', () => {
    expect(() =>
      envelope.parse({ code: 0, message: 'ok', requestId: 'r', timestamp: 1, data: { id: '1' }, extra: 1 }),
    ).toThrow()
  })

  it('分页响应要求 meta', () => {
    const paginated = createBffPaginatedEnvelopeSchema(z.object({ id: z.string() }))
    const parsed = paginated.parse({
      code: 0,
      message: 'ok',
      requestId: 'r',
      timestamp: 1,
      data: [{ id: '1' }],
      meta: { page: 1, pageSize: 20, total: 1 },
    })
    expect(parsed.meta.total).toBe(1)
    expect(() =>
      paginated.parse({ code: 0, message: 'ok', requestId: 'r', timestamp: 1, data: [] }),
    ).toThrow()
  })

  it('失败响应的 code 不能为 0', () => {
    expect(bffFailureEnvelopeSchema.parse({ code: 40301, message: 'x', requestId: 'r', timestamp: 1 }).code).toBe(40301)
    expect(() => bffFailureEnvelopeSchema.parse({ code: 0, message: 'x', requestId: 'r', timestamp: 1 })).toThrow()
  })
})

describe('财务门禁 50310', () => {
  const base = { code: 50310 as const, message: '财务链路未开放', requestId: 'r', timestamp: 1 }

  it('failedGates 非空即合法', () => {
    expect(financeGateRejectedSchema.parse({ ...base, failedGates: ['D-001-DECISION'] }).failedGates).toEqual([
      'D-001-DECISION',
    ])
  })

  it('拒绝空 failedGates', () => {
    expect(() => financeGateRejectedSchema.parse({ ...base, failedGates: [] })).toThrow()
  })

  it('拒绝重复 gate', () => {
    expect(() =>
      financeGateRejectedSchema.parse({ ...base, failedGates: ['P0-008', 'P0-008'] }),
    ).toThrow(/deduplicated/u)
  })

  it('拒绝未知 gate', () => {
    expect(() => financeGateRejectedSchema.parse({ ...base, failedGates: ['UNKNOWN'] })).toThrow()
  })
})

describe('角色与权限', () => {
  it('admin 拥有全部权限', () => {
    expect(ROLE_PERMISSIONS.admin).toHaveLength(ALL_PERMISSIONS.length)
  })

  it('leader 与 creator 均无 project.manage', () => {
    expect(ROLE_PERMISSIONS.leader).not.toContain('project.manage')
    expect(ROLE_PERMISSIONS.creator).not.toContain('project.manage')
  })

  it('creator 不具备团队与团队收益权限', () => {
    expect(ROLE_PERMISSIONS.creator).not.toContain('team.view')
    expect(ROLE_PERMISSIONS.creator).not.toContain('earning.view_team')
  })

  it('每个角色的权限都在 ALL_PERMISSIONS 内且无重复', () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      expect(new Set(permissions).size, role).toBe(permissions.length)
      for (const permission of permissions) expect(ALL_PERMISSIONS).toContain(permission)
    }
  })

  it('isGlobalRole 拒绝旧角色值', () => {
    expect(isGlobalRole('admin')).toBe(true)
    expect(isGlobalRole('boss')).toBe(false)
    expect(isGlobalRole('member')).toBe(false)
  })

  it('hasPermission 在 permissions 缺失时 fail closed', () => {
    expect(hasPermission(undefined, 'project.manage')).toBe(false)
    expect(hasPermission(['project.manage'], 'project.manage')).toBe(true)
  })
})
