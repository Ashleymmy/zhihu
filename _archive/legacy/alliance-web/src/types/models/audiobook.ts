/**
 * 有声书类型
 * 来源：docs/03-接口文档.md § 十
 */
import type { PaginationQuery, Pagination } from './common'
import type { Topic } from './ranking'

// ─── § 10.1 查询有声书列表 ────────────────────────────────────────────────────
export interface GetAudioBookListQuery extends PaginationQuery {
  // limit 也应支持，文档未列但返回里有该字段（联调验证）
}

export interface AudioBook {
  title:          string
  content_type:   string
  paid_column_url: string
  audio_book_url: string
  topic:          Topic[]
  /** 用于 § 10.2 获取音频下载地址 */
  section_id:     string
  /** 集数 */
  episodes:       number
}

export interface AudioBookListResponse {
  data:       AudioBook[]
  pagination: Pagination
}

// ─── § 10.2 查询有声书音频地址 ───────────────────────────────────────────────
/**
 * ⚠️ 返回的 URL 是带签名的时效链接，不要缓存或入库长期保存。
 */
export interface AudioDownloadUrl {
  url: string
}
