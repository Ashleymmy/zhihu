/**
 * 批量任务服务
 * 来源：docs/03-接口文档.md § 六
 */
import { apiGet } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'

/**
 * § 6.1 查询批量任务结果
 *
 * ⚠️ 返回文件流（Blob），不是 JSON。
 * 任务未完成时接口报错，轮询逻辑要把它当作「继续等待」而非失败。
 */
export function getBatchTaskResult(batchTaskId: string): Promise<Blob> {
  return apiGet<Blob>(API_PATHS.BATCH_TASK_RESULT(batchTaskId), {
    responseType: 'blob',
  })
}

/**
 * 触发浏览器下载 Blob
 * ⚠️ 必须 revokeObjectURL，否则 Blob 一直占内存不释放。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
