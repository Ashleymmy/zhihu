/**
 * 盐选内容榜单类型
 * 来源：docs/03-接口文档.md § 九
 */
import type { PaginationQuery, Pagination } from './common'
import type { RankingType } from '@/constants/enums'

// ─── § 9.1 查询榜单列表 ───────────────────────────────────────────────────────
/**
 * 榜单标签。
 * ⚠️ 此接口直接返回数组，无 { success, msg, data } 外壳。
 */
export interface RankingLabel {
  /**
   * 榜单 id（即 § 9.2 的 rule_id）。
   * ⚠️ 类型是 STRING，但 § 9.2 参数标注为 INT。
   * 保持字符串传递，不要 parseInt（超长数字有精度风险）。
   */
  id:         string
  name:       string
  /** 1 常规书单 / 2 推荐书单 */
  type:       RankingType
  updated_at: string
}

// ─── § 9.2 查询榜单内容数据列表 ───────────────────────────────────────────────
export interface GetRankingContentsQuery extends PaginationQuery {
  /** 榜单 id，由 § 9.1 获取；字符串形式传递 */
  rule_id: string
}

export interface PaidColumn {
  title: string
  url:   string
}

export interface Topic {
  name: string
  url:  string
}

export interface RankingContent {
  id:            string
  title:         string
  url:           string
  paid_column:   PaidColumn
  topic:         Topic[]
  category:      string
  content_type:  string
  /** 以下字段仅 type=2（推荐书单）时有值 */
  content_subjective_level?: string
  /** ⚠️ 官方文档误标为「一级领域」，应为二级领域 */
  bayes_first_category?:     string
  bayes_second_category?:    string
  theme?:                    string
  r_cmd_consume_value?:      string
}

export interface RankingContentsResponse {
  data:       RankingContent[]
  pagination: Pagination
}

// ─── § 9.3 查询榜单内容详情 ───────────────────────────────────────────────────
/**
 * ⚠️ 直接返回对象，无 { success, msg, data } 外壳（与 § 9.1 同）。
 */
export interface RankingContentDetail {
  id:            string
  title:         string
  public_at:     string
  word_count:    number
  section_title: string
  section_url:   string
}

// ─── § 9.4 查询上新内容 ───────────────────────────────────────────────────────
export interface NewContent {
  section_title: string
  well_title:    string
  section_token: string
  /** 多作者用英文逗号分隔 */
  author:        string
  url:           string
  /**
   * 热度值。⚠️ STRING 类型，无热度时为 ""。
   * 排序时需转数字并处理空值。
   */
  hot_value:     string
  /** 多标签用英文逗号分隔，无标签时为 "" */
  topic:         string
  created_at:    string
}
