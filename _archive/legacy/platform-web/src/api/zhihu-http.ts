/**
 * 知乎联盟 API 专用 Axios 实例
 * baseURL: /api  → Vite proxy → mock-server / BFF
 * 浏览器只携带登录 JWT；知乎签名统一由 BFF 生成。
 */
import axios from 'axios'
import type { AxiosResponse, AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios'
import { message } from 'ant-design-vue'

interface ZhihuRequestConfig extends AxiosRequestConfig {
  suppressErrorMessage?: boolean
}

// ── 大整数安全解析（Snowflake ID 精度保护）────────────────────────
function safeJsonParse(raw: string): unknown {
  try {
    const patched = raw.replace(/(?<=[:{,\[]\s*)(\d{16,})(?=\s*[,}\]\r\n])/g, '"$1"')
    return JSON.parse(patched)
  } catch {
    return JSON.parse(raw)
  }
}

// ── BFF 登录凭证拦截器 ────────────────────────────────────────────
function authInterceptor(cfg: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  const token = localStorage.getItem('token')
  if (token && cfg.headers) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
}

// ── 响应归一化拦截器 ──────────────────────────────────────────────
function successInterceptor(res: AxiosResponse): unknown {
  const body = res.data
  if (body instanceof Blob)  return body
  if (Array.isArray(body))   return body
  if (body && typeof body === 'object' && 'success' in body) {
    if ((body as any).success === false) {
      const msg = ((body as any).error as any)?.message ?? (body as any).msg ?? '请求失败'
      if (!(res.config as ZhihuRequestConfig).suppressErrorMessage) message.error(msg)
      return Promise.reject(new Error(msg))
    }
    if ('time_range'  in body) return body
    if ('pagination'  in body) return body
    return (body as any).data ?? body
  }
  return body
}

function errorInterceptor(err: AxiosError): Promise<never> {
  const s = err.response?.status
  const d = err.response?.data as Record<string, unknown> | undefined
  const apiMsg = d?.error ? ((d.error as any).message as string) : undefined
  let msg = apiMsg ?? err.message
  if (s === 401) msg = '未授权，access_token 无效或已过期'
  else if (s === 403) msg = '接口未授权，请联系知乎运营申请开通权限'
  else if (s === 404) msg = '上游接口返回 404，请确认接口路径或功能是否可用'
  else if (s === 429) msg = '请求过于频繁，已触发限流'
  else if (!err.response) msg = '网络连接失败，请检查网络'
  if (!(err.config as ZhihuRequestConfig | undefined)?.suppressErrorMessage) message.error(msg)
  return Promise.reject(err)
}

// ── Axios 实例 ─────────────────────────────────────────────────────
const zhihuHttp = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
  transformResponse: [(d: unknown) => typeof d === 'string' ? safeJsonParse(d) : d],
})

zhihuHttp.interceptors.request.use(authInterceptor)
zhihuHttp.interceptors.response.use(successInterceptor as any, errorInterceptor)

export function zhGet<T>(url: string, params?: object, config?: ZhihuRequestConfig): Promise<T> {
  return zhihuHttp.get(url, { ...config, params }) as unknown as Promise<T>
}
export function zhPost<T>(url: string, data?: unknown, cfg?: object): Promise<T> {
  return zhihuHttp.post(url, data, cfg) as unknown as Promise<T>
}
export function zhPut<T>(url: string, data?: unknown): Promise<T> {
  return zhihuHttp.put(url, data) as unknown as Promise<T>
}

export default zhihuHttp
