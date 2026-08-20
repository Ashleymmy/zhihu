/**
 * 推广计划类型
 * 来源：docs/03-接口文档.md § 三
 */
import type { PaginationQuery, BatchTaskResponse } from './common'

// ─── § 3.1 单个创建推广计划 ──────────────────────────────────────────────────
export interface CreatePlanRequest {
  task_id:         string
  channel_id:      string
  content_url:     string
  /** 推广方式，目前固定传 0 */
  popularize_type: number
  /** 仅支持单个关键词，不含逗号/空格等分隔符 */
  keyword:         string
  /** 二代渠道 id，可选；⚠️ 不参与签名 */
  second_channel_id?: string
}

export interface CreatePlanResponse {
  plan_id: string
}

// ─── § 3.2 批量创建推广计划（Form-Data） ────────────────────────────────────
export interface BatchCreatePlanFormFields {
  task_id:          string
  channel_id:       string
  /** 推广方式，目前固定传 0 */
  popularize_type:  number
  /** 二代渠道 id，可选；不参与签名 */
  second_channel_id?: string
}

/** § 3.2 返回 batch_task_id，查 § 6.1 获取结果 */
export type BatchCreatePlanResponse = BatchTaskResponse

// ─── 计划列表查询（§ 附录 A 中作为依赖，暂无专用列表接口）───────────────────
export interface PlanQuery extends PaginationQuery {
  channel_id: string
}
