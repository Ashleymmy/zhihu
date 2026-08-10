import axios from 'axios'
import type { AxiosInstance, AxiosRequestConfig } from 'axios'

// ─── Envelope shape returned by every BFF endpoint ───────────
// Backend returns: { code: 0, data: T, message: 'ok' }  (code 0 = success)
// Error responses use HTTP status codes (401/403/422/500) + JSON body
interface Envelope<T = unknown> {
  code: number
  data: T
  message: string
}

export interface ApiError {
  code: string | number
  message: string
  status?: number
}

const BASE_URL = ((import.meta as any).env.VITE_API_BASE_URL as string) || '/api/v1'

const instance: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
})

// ─── Attach JWT on every request ─────────────────────────────
instance.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token')
  if (token && cfg.headers) {
    cfg.headers.Authorization = `Bearer ${token}`
  }
  return cfg
})

// ─── Central request wrapper with envelope unwrap ────────────
async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const res = await instance.request<Envelope<T>>(config)
    const env = res.data

    // Backend success: code === 0
    if (env.code !== 0) {
      const err: ApiError = { code: env.code, message: env.message ?? '请求失败', status: res.status }
      throw err
    }

    return env.data
  } catch (raw: any) {
    // Already-normalized error — rethrow as-is
    if ((raw.code !== undefined) && raw.message && !raw.isAxiosError) throw raw

    const status: number | undefined = raw.response?.status
    const bffCode: number | string = raw.response?.data?.code ?? 'NETWORK_ERROR'
    const bffMsg: string = raw.response?.data?.message ?? raw.message ?? '网络错误'

    if (status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }

    // 403：已登录但权限不足（如 requirePermission 拦截）。不跳转——当前会话仍然有效，
    // 只把后端信息兜底成可读文案，避免把 Axios 的 "Request failed with status code 403" 抛给用户。
    const message = status === 403 && !raw.response?.data?.message
      ? '没有权限执行该操作'
      : bffMsg

    const err: ApiError = { code: bffCode, message, status }
    throw err
  }
}

// ─── Typed HTTP helpers ───────────────────────────────────────
export const http = {
  get: <T>(url: string, params?: object) =>
    request<T>({ method: 'GET', url, params }),

  post: <T>(url: string, data?: unknown) =>
    request<T>({ method: 'POST', url, data }),

  put: <T>(url: string, data?: unknown) =>
    request<T>({ method: 'PUT', url, data }),

  patch: <T>(url: string, data?: unknown) =>
    request<T>({ method: 'PATCH', url, data }),

  del: <T>(url: string) =>
    request<T>({ method: 'DELETE', url }),
}
