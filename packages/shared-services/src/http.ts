import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'
import type { RefreshResp } from '@zhihu-koc/shared-contracts'
import { createSessionTokenStore, type TokenStore } from './token-store'

export interface ApiError {
  code: string | number
  message: string
  status?: number
  requestId?: string
  /** 财务门禁拒绝（50310）时列出的未通过 Gate。 */
  failedGates?: string[]
}

export function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value
}

export interface HttpClientOptions {
  baseURL?: string
  tokenStore?: TokenStore
  /** Access Token 失效且 refresh 也失败时的回调（通常跳登录页）。 */
  onUnauthorized?: () => void
  timeout?: number
}

export interface HttpClient {
  get<T>(url: string, params?: object): Promise<T>
  post<T>(url: string, data?: unknown): Promise<T>
  /** multipart 上传（FormData），axios 会自动带上 boundary */
  postForm<T>(url: string, form: FormData): Promise<T>
  put<T>(url: string, data?: unknown): Promise<T>
  patch<T>(url: string, data?: unknown): Promise<T>
  del<T>(url: string): Promise<T>
  tokens: TokenStore
  /** 主动刷新 Access Token；并发调用会共享同一次请求。 */
  refresh(): Promise<boolean>
}

interface RawEnvelope<T> {
  code: number
  data: T
  message: string
  requestId?: string
  failedGates?: string[]
}

const REFRESH_PATH = '/auth/refresh'

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const tokens = options.tokenStore ?? createSessionTokenStore()
  const instance: AxiosInstance = axios.create({
    baseURL: options.baseURL ?? '/api/v1',
    timeout: options.timeout ?? 15_000,
    headers: { 'Content-Type': 'application/json' },
    // Refresh Cookie 是 HttpOnly 的，必须带上凭据才能完成轮换。
    withCredentials: true,
  })

  instance.interceptors.request.use((config) => {
    const token = tokens.get()
    if (token && config.headers) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  // 并发 401 只触发一次 refresh，避免 Refresh Token 轮换被判定为重放。
  let refreshInFlight: Promise<boolean> | null = null

  async function refresh(): Promise<boolean> {
    refreshInFlight ??= (async () => {
      try {
        const response = await instance.request<RawEnvelope<RefreshResp>>({
          method: 'POST',
          url: REFRESH_PATH,
          // 刷新自身不允许再触发刷新。
          headers: { Authorization: '' },
        })
        if (response.data.code !== 0) return false
        tokens.set(response.data.data.token)
        return true
      } catch {
        tokens.set(null)
        return false
      } finally {
        refreshInFlight = null
      }
    })()
    return refreshInFlight
  }

  function normalizeError(raw: any): ApiError {
    if (isApiError(raw) && !(raw as { isAxiosError?: boolean }).isAxiosError) return raw
    const status: number | undefined = raw?.response?.status
    const body = raw?.response?.data
    const message =
      status === 403 && !body?.message ? '没有权限执行该操作' : (body?.message ?? raw?.message ?? '网络错误')
    return {
      code: body?.code ?? 'NETWORK_ERROR',
      message,
      status,
      requestId: body?.requestId,
      failedGates: Array.isArray(body?.failedGates) ? body.failedGates : undefined,
    }
  }

  async function request<T>(config: AxiosRequestConfig, retried = false): Promise<T> {
    try {
      const response = await instance.request<RawEnvelope<T>>(config)
      const envelope = response.data
      if (envelope.code !== 0) {
        throw {
          code: envelope.code,
          message: envelope.message ?? '请求失败',
          status: response.status,
          requestId: envelope.requestId,
          failedGates: envelope.failedGates,
        } satisfies ApiError
      }
      return envelope.data
    } catch (raw: any) {
      const status: number | undefined = raw?.response?.status
      const isRefreshCall = config.url === REFRESH_PATH

      if (status === 401 && !retried && !isRefreshCall) {
        const refreshed = await refresh()
        if (refreshed) return request<T>(config, true)
        options.onUnauthorized?.()
      } else if (status === 401 && (retried || isRefreshCall)) {
        tokens.set(null)
        options.onUnauthorized?.()
      }

      throw normalizeError(raw)
    }
  }

  return {
    get: (url, params) => request({ method: 'GET', url, params }),
    post: (url, data) => request({ method: 'POST', url, data }),
    postForm: (url, form) =>
      request({ method: 'POST', url, data: form, headers: { 'Content-Type': 'multipart/form-data' } }),
    put: (url, data) => request({ method: 'PUT', url, data }),
    patch: (url, data) => request({ method: 'PATCH', url, data }),
    del: (url) => request({ method: 'DELETE', url }),
    tokens,
    refresh,
  }
}
