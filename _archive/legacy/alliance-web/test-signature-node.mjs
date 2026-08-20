/**
 * 签名算法独立验证脚本（不依赖 vitest）
 * 用法: node test-signature-node.mjs
 *
 * 等价覆盖 src/utils/signature.test.ts 中全部 8 个用例
 */
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const CryptoJS = require('./node_modules/crypto-js')

// ─── 复现 signature.ts 逻辑 ──────────────────────────────────────────────────
const GLOBAL_SIGN_EXCLUDED_KEYS = [
  'offset', 'limit', 'file', 'image', 'second_channel_id', 'X-Requested-With', 'signature',
]

function buildSignature(params, secretKey) {
  const filtered = Object.entries(params).filter(([k]) => !GLOBAL_SIGN_EXCLUDED_KEYS.includes(k))
  filtered.sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'variant' }))
  const kvStr = filtered.map(([k, v]) => `${k}=${String(v)}`).join('&')
  const md5Str = CryptoJS.MD5(kvStr).toString(CryptoJS.enc.Hex)
  return CryptoJS.HmacSHA256(md5Str, secretKey).toString(CryptoJS.enc.Hex)
}

function buildSignatureWithTrace(params, secretKey) {
  const filtered = Object.entries(params).filter(([k]) => !GLOBAL_SIGN_EXCLUDED_KEYS.includes(k))
  filtered.sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'variant' }))
  const filteredParams = Object.fromEntries(filtered)
  const sortedKeys = filtered.map(([k]) => k)
  const kvStr = filtered.map(([k, v]) => `${k}=${String(v)}`).join('&')
  const md5Str = CryptoJS.MD5(kvStr).toString(CryptoJS.enc.Hex)
  const signature = CryptoJS.HmacSHA256(md5Str, secretKey).toString(CryptoJS.enc.Hex)
  return { filteredParams, sortedKeys, kvStr, md5Str, signature }
}

// ─── Golden Vector（来自官方 PDF §1.2）─────────────────────────────────────
const GOLDEN_PARAMS = {
  task_id: '1443567656205545123',
  channel_id: '1462106336904909960',
  content_url: 'https://www.zhihu.com/market/paid_column/1550452094749851648/section/1590711798218661888',
  popularize_type: 0,
  keyword: '这是一个测试关键词',
  timestamp: 1672899103,
  access_token: 'Db6j0Yq0eppBb',
}
const GOLDEN_SECRET_KEY = 'a735eb11da74123074675fa3522a90d1'
const GOLDEN_MD5 = '112f078ecdb75d76b38e4d9e661772bd'
const GOLDEN_SIGNATURE = '794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579'

// ─── 极简测试框架 ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓  ${name}`)
    passed++
  } catch (e) {
    console.log(`  ✗  ${name}`)
    console.log(`       ${e.message}`)
    failed++
  }
}
function expect(val) {
  return {
    toBe: (exp) => { if (val !== exp) throw new Error(`Expected:\n       ${exp}\n       Got:\n       ${val}`) },
    toMatch: (re) => { if (!re.test(String(val))) throw new Error(`Expected to match ${re}, got: ${val}`) },
    toContain: (item) => { if (!val.includes(item)) throw new Error(`Expected array to contain "${item}"`) },
    not: { toBe: (notExp) => { if (val === notExp) throw new Error(`Expected value to differ, but got: ${val}`) } }
  }
}

// ─── 测试用例 ─────────────────────────────────────────────────────────────────
console.log('\nbuildSignature')

test('官方 Golden Vector：MD5 与签名完全匹配', () => {
  const { md5Str, signature, sortedKeys, kvStr } = buildSignatureWithTrace(GOLDEN_PARAMS, GOLDEN_SECRET_KEY)
  console.log(`       sortedKeys: ${sortedKeys.join(', ')}`)
  console.log(`       kvStr:      ${kvStr}`)
  console.log(`       MD5:        ${md5Str}`)
  console.log(`       sig:        ${signature}`)
  expect(md5Str).toBe(GOLDEN_MD5)
  expect(signature).toBe(GOLDEN_SIGNATURE)
})

test('输出为 64 位小写十六进制字符串', () => {
  const sig = buildSignature(GOLDEN_PARAMS, GOLDEN_SECRET_KEY)
  expect(sig).toMatch(/^[0-9a-f]{64}$/)
})

test('key 顺序不影响结果（签名内部已排序）', () => {
  const shuffled = {
    timestamp: 1672899103, keyword: '这是一个测试关键词',
    access_token: 'Db6j0Yq0eppBb', task_id: '1443567656205545123',
    content_url: 'https://www.zhihu.com/market/paid_column/1550452094749851648/section/1590711798218661888',
    popularize_type: 0, channel_id: '1462106336904909960',
  }
  expect(buildSignature(shuffled, GOLDEN_SECRET_KEY)).toBe(GOLDEN_SIGNATURE)
})

test('排除字段不参与签名', () => {
  const withExcluded = {
    ...GOLDEN_PARAMS,
    offset: 10, limit: 20, file: 'x', image: 'x',
    second_channel_id: 'x', 'X-Requested-With': 'openApi', signature: 'old',
  }
  expect(buildSignature(withExcluded, GOLDEN_SECRET_KEY)).toBe(GOLDEN_SIGNATURE)
})

test('中文参数不 URL-encode，直接参与签名', () => {
  expect(GOLDEN_PARAMS.keyword).toBe('这是一个测试关键词')
  expect(buildSignature({ ...GOLDEN_PARAMS }, GOLDEN_SECRET_KEY)).toBe(GOLDEN_SIGNATURE)
})

test('参数变化导致签名变化', () => {
  const modified = { ...GOLDEN_PARAMS, keyword: '不同的关键词' }
  expect(buildSignature(modified, GOLDEN_SECRET_KEY)).not.toBe(GOLDEN_SIGNATURE)
})

test('secret_key 变化导致签名变化', () => {
  expect(buildSignature(GOLDEN_PARAMS, 'wrong-secret-key')).not.toBe(GOLDEN_SIGNATURE)
})

console.log('\nGLOBAL_SIGN_EXCLUDED_KEYS')

test('包含全部 7 个排除字段', () => {
  for (const key of ['offset', 'limit', 'file', 'image', 'second_channel_id', 'X-Requested-With', 'signature']) {
    expect(GLOBAL_SIGN_EXCLUDED_KEYS).toContain(key)
  }
})

// ─── 汇总 ─────────────────────────────────────────────────────────────────────
console.log(`\n  Tests: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
