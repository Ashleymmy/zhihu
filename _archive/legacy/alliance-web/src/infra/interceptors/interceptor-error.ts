/**
 * 响应归一化与错误处理拦截器
 * docs/01-架构设计.md §4.3
 *
 * 处理四种响应格式：
 *  1. 标准  { success, msg, data }（无分页）→ 返回 data
 *  2. 标准  { success, msg, data, pagination } → 返回完整 body（保留 pagination）
 *  3. 裸数组（§ 9.1 查询榜单列表）→ 原样返回
 *  4. Blob 文件流（§ 6.1 批量任务）→ 原样返回
 *
 * ⚠️ 修复（2026-08-04）：带 pagination 的响应必须返回完整 body，
 *    否则 store 层访问 res.data / res.pagination 时会得到 undefined。
 */
import type { AxiosResponse, AxiosError } from 'axios'
import { ElMessage } from 'element-plus'

export function responseSuccessInterceptor(response: AxiosResponse): unknown {
  const body = response.data

  // Blob 文件流（批量任务结果，§ 6.1）
  if (body instanceof Blob) return body

  // 裸数组（榜单列表，§ 9.1）
  if (Array.isArray(body)) return body

  // 标准外壳
  if (body && typeof body === 'object' && 'success' in body) {
    if (body.success === false) {
      const msg = body.error?.message ?? body.msg ?? '请求失败'
      ElMessage.error(msg)
      return Promise.reject(new Error(msg))
    }
    // §8.1 投放实时数据：time_range 在顶层，需保留完整 body
    if ('time_range' in body) return body
    // 带分页的列表响应（§7.1 §4.4 §5.2 等）：pagination 不能丢，返回完整 body
    // store 层通过 res.data 取列表、res.pagination 取分页信息
    if ('pagination' in body) return body
    return body.data ?? body
  }

  // 其他格式（直接对象，如 § 9.3）
  return body
}

export function responseErrorInterceptor(error: AxiosError): Promise<never> {
  const status = error.response?.status
  const data = error.response?.data as Record<string, unknown> | undefined
  const apiMessage = data?.error
    ? (data.error as Record<string, unknown>).message as string
    : undefined

  let message = apiMessage ?? error.message

  if (status === 401) message = '未授权，access_token 无效或已过期'
  else if (status === 403) message = '接口未授权，请联系知乎运营申请开通权限'
  else if (status === 404) message = '接口不存在（404），该账号可能未开通此功能权限'
  else if (status === 429) message = '请求过于频繁，已触发限流'
  else if (status === 500) message = '服务器内部错误'
  else if (!error.response) message = '网络连接失败，请检查网络'

  ElMessage.error(message)
  return Promise.reject(error)
}
