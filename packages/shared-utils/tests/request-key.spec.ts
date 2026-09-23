import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequestKey } from '../src'

const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => vi.unstubAllGlobals())

describe('请求幂等键', () => {
  it('支持 HTTPS 提供的原生 randomUUID', () => {
    const expected = '00112233-4455-4677-8899-aabbccddeeff'
    const crypto = {
      randomUUID() { expect(this).toBe(crypto); return expected },
    }
    vi.stubGlobal('crypto', crypto)
    expect(createRequestKey()).toBe(expected)
  })

  it('HTTP 缺少 randomUUID 时仍生成不同的 UUID v4', () => {
    vi.stubGlobal('crypto', { getRandomValues })
    const keys = Array.from({ length: 100 }, () => createRequestKey())
    keys.forEach(key => expect(key).toMatch(uuidV4))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('随机字节全为零或全为一时也保持版本、变体和补零格式', () => {
    for (const byte of [0, 255]) {
      vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(byte) })
      expect(createRequestKey()).toMatch(uuidV4)
    }
  })
})
