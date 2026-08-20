/**
 * 盐选内容榜单服务
 * 来源：docs/03-接口文档.md § 九
 */
import { apiGet } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'
import type {
  RankingLabel,
  GetRankingContentsQuery,
  RankingContentsResponse,
  RankingContentDetail,
  NewContent,
} from '@/types/models'

/** § 9.1 查询榜单列表（直接返回数组，无外壳） */
export function getRankingLabels(): Promise<RankingLabel[]> {
  return apiGet<RankingLabel[]>(API_PATHS.VIP_RULE_LABELS)
}

/** § 9.2 查询榜单内容数据列表 */
export function getRankingContents(
  query: GetRankingContentsQuery,
): Promise<RankingContentsResponse> {
  return apiGet<RankingContentsResponse>(API_PATHS.VIP_RULE_CONTENTS, { params: query })
}

/**
 * § 9.3 查询榜单内容详情（直接返回对象，无外壳）
 * ⚠️ rule_id type 参数用于区分常规/推荐书单
 */
export function getRankingContentDetail(
  contentId: string,
  type?: number,
): Promise<RankingContentDetail> {
  return apiGet<RankingContentDetail>(API_PATHS.VIP_RULE_CONTENT_DETAIL(contentId), {
    params: type !== undefined ? { type } : undefined,
  })
}

/** § 9.4 查询上新内容 */
export function getOnlineSections(): Promise<NewContent[]> {
  return apiGet<NewContent[]>(API_PATHS.ONLINE_SECTIONS)
}
