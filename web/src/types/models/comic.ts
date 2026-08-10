/**
 * 漫剧内容类型
 * 来源：docs/03-接口文档.md § 十二
 */
import type { PaginationQuery, Pagination } from './common'

// ─── § 12.1 查询漫剧剧目列表 ─────────────────────────────────────────────────
export interface GetComicDramaListQuery extends PaginationQuery {
  title?: string
}

export interface ComicDrama {
  title:      string
  /** 用于 § 12.2 查剧集 */
  drama_id:   string
  story_url:  string
  tab_artwork: string
}

export interface ComicDramaListResponse {
  data:       ComicDrama[]
  pagination: Pagination
}

// ─── § 12.2 查询漫剧剧集列表 ─────────────────────────────────────────────────
export interface GetComicEpisodesQuery extends PaginationQuery {}

export interface ComicEpisode {
  id:    string
  title: string
  /**
   * 是否付费。⚠️ 官方未说明 0/1 语义，联调后回填。
   * 推测 0=免费 1=付费。
   */
  is_pay:           number
  video_url:         string
  /**
   * 抖音视频地址。
   * ⚠️ 官方原文：「不保证有值或者值有效，取决于媒体内容状态」。
   * 前端必须校验 URL 合法性再渲染，不要直接假定可播放。
   */
  douyin_video_url:  string
}

export interface ComicEpisodesResponse {
  data:       ComicEpisode[]
  pagination: Pagination
}
