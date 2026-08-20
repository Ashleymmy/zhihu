/**
 * 通用类型
 * 来源：docs/03-接口文档.md § 零（通用约定）
 */

// ─── 分页 ────────────────────────────────────────────────────────────────────
/**
 * 统一分页结构
 * ⚠️ is_first / is_end 不是所有接口都返回，设为可选。
 * 判断「是否还有下一页」用 offset + limit < total 兜底，不依赖 is_end。
 */
export interface Pagination {
  total:    number
  offset:   number
  limit:    number
  is_first?: boolean
  is_end?:   boolean
}

export interface PaginationQuery {
  offset?: number
  limit?:  number
}

// ─── 响应包装 ─────────────────────────────────────────────────────────────────
/** 标准成功响应 */
export interface ApiResponse<T = unknown> {
  success: boolean
  msg:     string
  data:    T
}

/** 带分页的列表响应 */
export interface PaginatedResponse<T> {
  data:       T[]
  pagination: Pagination
}

/** 带分页 + 可能 null 的列表响应（§ 7.1 data 可能为 null）*/
export interface NullablePaginatedResponse<T> {
  data:       T[] | null
  pagination: Pagination
}

// ─── 错误 ────────────────────────────────────────────────────────────────────
export interface ApiError {
  error: {
    code:    number
    name:    string
    message: string
  }
}

// ─── 批量任务 ─────────────────────────────────────────────────────────────────
export interface BatchTaskResponse {
  batch_task_id: string
}
