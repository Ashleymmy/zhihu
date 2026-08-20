/**
 * 代理渠道类型
 * 来源：docs/03-接口文档.md § 五
 *
 * ⚠️ 这是最优先实现的模块，因为几乎所有接口都需要 channel_id。
 */
import type { PaginationQuery } from './common'

// ─── § 5.1 查询代理商渠道信息 ─────────────────────────────────────────────────
/** 一代渠道 */
export interface AgentChannel {
  channel_id:   string
  channel_name: string
}

// ─── § 5.2 查询二代信息 ───────────────────────────────────────────────────────
/** 二代渠道（字段名与一代相同，语义不同） */
export interface SecondChannel {
  channel_id:   string
  channel_name: string
}

export interface GetSecondChannelsQuery extends PaginationQuery {
  /** 一代渠道 id（由 § 5.1 获取） */
  channel_id: string
}
