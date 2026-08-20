/**
 * 请求签名拦截器
 * docs/01-架构设计.md §4.2 / docs/04-签名机制.md §3
 *
 * 自动在每个请求中注入：
 *  - access_token（来自环境变量）
 *  - timestamp（秒级）
 *  - signature（由 buildSignature 计算）
 *
 * ⚠️  VITE_ENABLE_LOCAL_SIGN=false 时本拦截器跳过签名注入，
 *    由 BFF 后端负责（生产环境强制要求）
 */
import type { InternalAxiosRequestConfig } from 'axios'
import { buildSignature } from '@/utils/signature'

const ACCESS_TOKEN = import.meta.env.VITE_ACCESS_TOKEN as string
const SECRET_KEY = import.meta.env.VITE_SECRET_KEY as string
const ENABLE_LOCAL_SIGN = import.meta.env.VITE_ENABLE_LOCAL_SIGN === 'true'

export function signInterceptor(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  // 生产模式不在前端签名
  if (!ENABLE_LOCAL_SIGN) return config

  const timestamp = Math.floor(Date.now() / 1000)

  // 提取需要签名的参数（GET → params，POST/PUT → data）
  // 注意：snake_case 不转换，签名对大小写敏感
  const rawParams: Record<string, unknown> =
    config.method?.toUpperCase() === 'GET'
      ? { ...(config.params ?? {}) }
      : { ...(config.data ?? {}) }

  // 注入鉴权字段
  rawParams.access_token = ACCESS_TOKEN
  rawParams.timestamp = timestamp

  // 计算签名
  const signature = buildSignature(rawParams, SECRET_KEY)

  // 写回（Form-Data 由上层自行处理，这里只处理 JSON / Query）
  if (config.method?.toUpperCase() === 'GET') {
    config.params = { ...rawParams, signature }
  } else {
    // JSON body
    if (config.data instanceof FormData) {
      // Form-Data 场景：access_token / timestamp / signature 由调用方显式附加
      // 拦截器不修改 FormData，避免破坏文件流
    } else {
      config.data = { ...rawParams, signature }
    }
  }

  return config
}
