/**
 * 签名算法单元测试
 * docs/05-测试文档.md §4.1 / docs/04-签名机制.md §4（Golden Vector）
 *
 * Golden Vector（来自官方 PDF §1.2，已用 Python 脚本验证）：
 *   access_token = Db6j0Yq0eppBb
 *   secret_key   = a735eb11da74123074675fa3522a90d1
 *   MD5          = 112f078ecdb75d76b38e4d9e661772bd
 *   signature    = 794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579
 */
import { describe, it, expect } from 'vitest'
import { buildSignature, buildSignatureWithTrace, GLOBAL_SIGN_EXCLUDED_KEYS } from '@/utils/signature'

// Golden Vector 参数（官方示例）
const GOLDEN_PARAMS = {
  task_id: '1443567656205545123',
  channel_id: '1462106336904909960',
  content_url:
    'https://www.zhihu.com/market/paid_column/1550452094749851648/section/1590711798218661888',
  popularize_type: 0,
  keyword: '这是一个测试关键词',
  timestamp: 1672899103,
  access_token: 'Db6j0Yq0eppBb',
}

const GOLDEN_SECRET_KEY = 'a735eb11da74123074675fa3522a90d1'
const GOLDEN_MD5 = '112f078ecdb75d76b38e4d9e661772bd'
const GOLDEN_SIGNATURE =
  '794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579'

describe('buildSignature', () => {
  it('官方 Golden Vector：MD5 与签名完全匹配', () => {
    const { md5Str, signature } = buildSignatureWithTrace(
      GOLDEN_PARAMS as Record<string, unknown>,
      GOLDEN_SECRET_KEY,
    )
    expect(md5Str).toBe(GOLDEN_MD5)
    expect(signature).toBe(GOLDEN_SIGNATURE)
  })

  it('输出为 64 位小写十六进制字符串', () => {
    const sig = buildSignature(GOLDEN_PARAMS as Record<string, unknown>, GOLDEN_SECRET_KEY)
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })

  it('key 顺序不影响结果（签名内部已排序）', () => {
    const shuffled = {
      timestamp: 1672899103,
      keyword: '这是一个测试关键词',
      access_token: 'Db6j0Yq0eppBb',
      task_id: '1443567656205545123',
      content_url:
        'https://www.zhihu.com/market/paid_column/1550452094749851648/section/1590711798218661888',
      popularize_type: 0,
      channel_id: '1462106336904909960',
    }
    const sig = buildSignature(shuffled as Record<string, unknown>, GOLDEN_SECRET_KEY)
    expect(sig).toBe(GOLDEN_SIGNATURE)
  })

  it('排除字段不参与签名', () => {
    const withExcluded = {
      ...GOLDEN_PARAMS,
      offset: 10,
      limit: 20,
      file: 'should-not-sign',
      image: 'should-not-sign',
      second_channel_id: 'should-not-sign',
      'X-Requested-With': 'openApi',
      signature: 'old-value',
    }
    const sig = buildSignature(withExcluded as Record<string, unknown>, GOLDEN_SECRET_KEY)
    expect(sig).toBe(GOLDEN_SIGNATURE)
  })

  it('中文参数不 URL-encode，直接参与签名', () => {
    // keyword 含中文，签名结果应与 Golden Vector 一致（不编码）
    const params = { ...GOLDEN_PARAMS }
    expect(params.keyword).toBe('这是一个测试关键词')
    const sig = buildSignature(params as Record<string, unknown>, GOLDEN_SECRET_KEY)
    expect(sig).toBe(GOLDEN_SIGNATURE)
  })

  it('参数变化导致签名变化', () => {
    const modified = { ...GOLDEN_PARAMS, keyword: '不同的关键词' }
    const sig = buildSignature(modified as Record<string, unknown>, GOLDEN_SECRET_KEY)
    expect(sig).not.toBe(GOLDEN_SIGNATURE)
  })

  it('secret_key 变化导致签名变化', () => {
    const sig = buildSignature(GOLDEN_PARAMS as Record<string, unknown>, 'wrong-secret-key')
    expect(sig).not.toBe(GOLDEN_SIGNATURE)
  })
})

describe('GLOBAL_SIGN_EXCLUDED_KEYS', () => {
  it('包含全部 7 个排除字段', () => {
    const expected = ['offset', 'limit', 'file', 'image', 'second_channel_id', 'X-Requested-With', 'signature']
    for (const key of expected) {
      expect(GLOBAL_SIGN_EXCLUDED_KEYS).toContain(key)
    }
  })
})
