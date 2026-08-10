/**
 * 内容标签类型
 * 来源：docs/03-接口文档.md § 十三
 */
import type { BatchTaskResponse } from './common'

// ─── § 13.1 单个内容标签查询 ──────────────────────────────────────────────────
export interface GetContentTagQuery {
  /** 内容链接，仅支持回答/文章 */
  url:  string
  /** 要查的标签，多选英文逗号分隔（ContentTagType 枚举值） */
  tags: string
}

/**
 * ⚠️ 返回的 JSON key 是中文。
 * 所有字段可选，内容取决于请求的 tags 参数。
 */
export interface ContentTagResult {
  '兴趣'?:    string
  '一级领域'?: string
  '内容等级'?: string
}

// ─── § 13.2 内容标签批量查询（Form-Data） ───────────────────────────────────
/** § 13.2 返回 batch_task_id，查 § 6.1 获取结果 */
export type BatchContentTagResponse = BatchTaskResponse
