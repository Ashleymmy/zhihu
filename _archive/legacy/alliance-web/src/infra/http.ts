/**
 * Axios HTTP 客户端
 * docs/01-架构设计.md §4（基础设施层）
 *
 * 统一的请求入口，挂载签名拦截器和响应归一化拦截器。
 * 所有 Service 层函数通过此实例发起请求，不直接使用 axios 默认实例。
 */
import axios from 'axios'
import { signInterceptor } from './interceptors/interceptor-sign'
import {
  responseSuccessInterceptor,
  responseErrorInterceptor,
} from './interceptors/interceptor-error'

/**
 * 大整数安全 JSON 解析（防止 Snowflake ID 精度丢失）
 *
 * 知乎 API 的 plan_id / composition_id 等字段是 18~19 位的 Snowflake 整数，
 * 远超 JavaScript Number.MAX_SAFE_INTEGER（2^53 ≈ 9×10^15）。
 * 若直接用 JSON.parse，末尾 3~4 位会被截断为 0，导致 ID 与服务端不符，
 * 进而引发「计划未找到」「作品未找到」等难以定位的业务错误。
 *
 * 修复方式：在 JSON.parse 之前，用正则把 JSON 文本中所有 ≥16 位裸整数
 * 替换为字符串字面量，完全绕开 IEEE-754 精度限制。
 */
function safeJsonParse(raw: string): unknown {
  try {
    // 匹配 JSON 值位置（: 或 [ 或 , 之后）的 16 位以上纯数字，替换为带引号的字符串
    // 使用 lookbehind / lookahead，不消耗分隔符，支持连续多个大整数
    const patched = raw.replace(
      /(?<=[:{,\[]\s*)(\d{16,})(?=\s*[,}\]\r\n])/g,
      '"$1"',
    )
    return JSON.parse(patched)
  } catch {
    // 降级：仍用原始 JSON.parse（不应走到这里）
    return JSON.parse(raw)
  }
}

const http = axios.create({
  // 开发环境经 Vite proxy /api → https://open.zhihu.com
  baseURL: '/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
  // ⚠️ 替换默认的 JSON.parse，防止大整数精度丢失
  transformResponse: [
    (data: unknown) => typeof data === 'string' ? safeJsonParse(data) : data,
  ],
})

// 请求拦截：注入 access_token / timestamp / signature
http.interceptors.request.use(signInterceptor)

// 响应拦截：归一化数据 / 统一错误提示
http.interceptors.response.use(
  responseSuccessInterceptor as Parameters<typeof http.interceptors.response.use>[0],
  responseErrorInterceptor,
)

export default http

/**
 * 带类型的 HTTP 快捷方法
 * 响应拦截器已剥离 { success, msg, data } 外壳，
 * 用这些快捷方法可以得到正确的返回类型，不需要在每个 service 里手动 cast。
 */
import type { AxiosRequestConfig } from 'axios'

export function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return http.get(url, config) as unknown as Promise<T>
}

export function apiPost<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return http.post(url, data, config) as unknown as Promise<T>
}

export function apiPut<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return http.put(url, data, config) as unknown as Promise<T>
}
