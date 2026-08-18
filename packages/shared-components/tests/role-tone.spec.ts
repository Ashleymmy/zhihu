import { describe, expect, it } from 'vitest'
import { ROLE_TONES, roleTone } from '../src/role-tone'

describe('roleTone', () => {
  it('三个角色各有稳定色调', () => {
    expect(new Set(Object.values(ROLE_TONES)).size).toBe(3)
    expect(roleTone('admin')).toBe(ROLE_TONES.admin)
  })

  it('空角色降级为中性色', () => {
    expect(roleTone(null)).toBe('#8c8c8c')
    expect(roleTone(undefined)).toBe('#8c8c8c')
  })
})
