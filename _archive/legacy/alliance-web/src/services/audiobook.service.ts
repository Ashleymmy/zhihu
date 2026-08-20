/**
 * 有声书服务
 * 来源：docs/03-接口文档.md § 十
 */
import { apiGet } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'
import type {
  AudioBookListResponse,
  AudioDownloadUrl,
  GetAudioBookListQuery,
} from '@/types/models'

/** § 10.1 查询有声书列表 */
export function getAudioBooks(
  query: GetAudioBookListQuery = {},
): Promise<AudioBookListResponse> {
  return apiGet<AudioBookListResponse>(API_PATHS.AUDIO_CONTENTS, { params: query })
}

/**
 * § 10.2 查询有声书音频地址
 *
 * ⚠️ 返回的 URL 是带签名的时效链接，不要缓存。每次播放/下载前重新获取。
 */
export function getAudioDownloadUrl(sectionId: string): Promise<AudioDownloadUrl> {
  return apiGet<AudioDownloadUrl>(API_PATHS.AUDIO_DOWNLOAD(sectionId))
}
