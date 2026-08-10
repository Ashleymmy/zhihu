/**
 * 代理渠道服务
 * 来源：docs/03-接口文档.md § 五
 *
 * ⚠️ 这是最优先实现的模块，因为几乎所有接口都需要 channel_id。
 */
import { apiGet } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'
import type {
  AgentChannel,
  SecondChannel,
  GetSecondChannelsQuery,
  PaginatedResponse,
} from '@/types/models'

/**
 * § 5.1 查询代理商渠道信息（一代渠道）
 *
 * 无分页，一次返回全部。结果应缓存（store 层实现），不要每个页面都请求。
 */
export function getAgentChannels(): Promise<AgentChannel[]> {
  return apiGet<AgentChannel[]>(API_PATHS.AGENT_CHANNELS)
}

/**
 * § 5.2 查询二代渠道
 *
 * 需要一代 channel_id，返回其下的二代渠道列表（带分页）。
 */
export function getSecondChannels(
  query: GetSecondChannelsQuery,
): Promise<PaginatedResponse<SecondChannel>> {
  return apiGet<PaginatedResponse<SecondChannel>>(API_PATHS.SECOND_CHANNELS, {
    params: query,
  })
}
