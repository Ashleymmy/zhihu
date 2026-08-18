import { describe, expect, it } from 'vitest'
import { fakeUser, failureEnvelope, successEnvelope } from '../src'

describe('test-support 夹具', () => {
  it('fakeUser 生成递增且不重复的 ID', () => {
    const first = fakeUser()
    const second = fakeUser({ role: 'admin' })
    expect(first.id).not.toBe(second.id)
    expect(second.role).toBe('admin')
  })

  it('envelope 夹具符合唯一 Envelope 形状', () => {
    const success = successEnvelope({ ok: true })
    expect(success.code).toBe(0)
    expect(success.requestId.length).toBeGreaterThan(0)
    const failure = failureEnvelope(40301)
    expect(failure.code).toBe(40301)
  })
})
