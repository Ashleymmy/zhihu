/**
 * 签名算法实现
 * docs/04-签名机制.md §3
 *
 * ⚠️  安全边界：
 *   - 本模块仅用于本地开发（VITE_ENABLE_LOCAL_SIGN=true）
 *   - 生产环境 secret_key 必须由 BFF 持有，前端不得接触
 */
import CryptoJS from 'crypto-js'

/** 不参与签名的字段（docs/04-签名机制.md §2.2 & docs/01-架构设计.md）*/
export const GLOBAL_SIGN_EXCLUDED_KEYS: readonly string[] = [
  'offset',
  'limit',
  'file',
  'image',
  'second_channel_id',
  'X-Requested-With',
  'signature',
]

/**
 * 构建签名
 *
 * 步骤：
 *  ① 入参已含 access_token + timestamp（调用方注入）
 *  ② 排除不参与签名的字段
 *  ③ 按 key 字典序（ASCII 升序）排序
 *  ④ 拼接 key=value&key=value（不 URL-encode，中文原样）
 *  ⑤ MD5 → 小写
 *  ⑥ HmacSHA256(md5String, secretKey) → hex 小写
 *
 * @param params   包含 access_token / timestamp 在内的完整请求参数
 * @param secretKey 签名密钥（本地开发专用，生产由 BFF 持有）
 * @returns 十六进制小写签名字符串
 */
export function buildSignature(
  params: Record<string, unknown>,
  secretKey: string,
): string {
  // ② 过滤排除字段
  const filtered = Object.entries(params).filter(
    ([key]) => !GLOBAL_SIGN_EXCLUDED_KEYS.includes(key),
  )

  // ③ 字典序排序
  filtered.sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'variant' }))

  // ④ 拼接 kv 字符串（不编码，原样）
  const kvStr = filtered
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&')

  // ⑤ MD5 小写
  const md5Str = CryptoJS.MD5(kvStr).toString(CryptoJS.enc.Hex)

  // ⑥ HmacSHA256
  const signature = CryptoJS.HmacSHA256(md5Str, secretKey).toString(CryptoJS.enc.Hex)

  return signature
}

/**
 * 带调试跟踪信息的签名构建（开发调试专用）
 */
export function buildSignatureWithTrace(
  params: Record<string, unknown>,
  secretKey: string,
): {
  filteredParams: Record<string, unknown>
  sortedKeys: string[]
  kvStr: string
  md5Str: string
  signature: string
} {
  const filtered = Object.entries(params).filter(
    ([key]) => !GLOBAL_SIGN_EXCLUDED_KEYS.includes(key),
  )
  filtered.sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'variant' }))

  const filteredParams = Object.fromEntries(filtered)
  const sortedKeys = filtered.map(([key]) => key)
  const kvStr = filtered.map(([key, value]) => `${key}=${String(value)}`).join('&')
  const md5Str = CryptoJS.MD5(kvStr).toString(CryptoJS.enc.Hex)
  const signature = CryptoJS.HmacSHA256(md5Str, secretKey).toString(CryptoJS.enc.Hex)

  return { filteredParams, sortedKeys, kvStr, md5Str, signature }
}
