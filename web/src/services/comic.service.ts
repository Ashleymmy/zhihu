/**
 * 漫剧服务
 * 来源：docs/03-接口文档.md § 十二
 */
import { apiGet } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'
import type {
  ComicDramaListResponse,
  ComicEpisodesResponse,
  GetComicDramaListQuery,
  GetComicEpisodesQuery,
} from '@/types/models'

/** § 12.1 查询漫剧剧目列表 */
export function getComicDramas(
  query: GetComicDramaListQuery = {},
): Promise<ComicDramaListResponse> {
  return apiGet<ComicDramaListResponse>(API_PATHS.COMIC_DRAMAS, { params: query })
}

/** § 12.2 查询漫剧剧集列表 */
export function getComicEpisodes(
  dramaId: string,
  query: GetComicEpisodesQuery = {},
): Promise<ComicEpisodesResponse> {
  return apiGet<ComicEpisodesResponse>(
    API_PATHS.COMIC_DRAMA_EPISODES(dramaId),
    { params: query },
  )
}
