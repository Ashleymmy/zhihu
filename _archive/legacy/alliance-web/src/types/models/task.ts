/**
 * 推广任务类型
 * 来源：docs/03-接口文档.md § 七
 */
import type { PaginationQuery, Pagination } from './common'
import type { PopularizeTaskStatus } from '@/constants/enums'

// ─── § 7.1 查询推广任务列表 ───────────────────────────────────────────────────
export interface GetPopularizeTasksQuery extends PaginationQuery {
  channel_id: string
}

export interface PopularizeTask {
  /**
   * 任务 id。
   * ⚠️ 字段名是 `id`，不是 `task_id`。
   * 传给 § 3.1 创建计划时要做字段映射：`task_id = task.id`
   */
  id:             string
  product_name:   string
  task_name:      string
  /** '开启' | '过期' | '暂停' */
  status:         PopularizeTaskStatus
  pay_caliber:    string
  /** '长期有效' 或具体时间字符串，不要尝试 parse */
  expiry_time:    string
  /**
   * 推广限额。'无' 或具体值。
   * ⚠️ 字段名与分页 limit 相同，但语义完全不同（这里是推广限额）
   */
  limit:          string
  /** 多个媒体用中文顿号 `、` 分隔的单一字符串，如需数组请按 `、` 分割 */
  media_platform: string
  attribution:    string
}

/**
 * ⚠️ data 可能为 null，前端必须做空值兜底。
 */
export interface PopularizeTaskListResponse {
  data:       PopularizeTask[] | null
  pagination: Pagination
}
