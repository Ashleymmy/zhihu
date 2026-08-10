// 知乎联盟开放接口 — 所有 service 函数
// 底层通过 zhihu-http.ts，baseURL=/api，路由到 mock-server 或 BFF proxy
import { zhGet, zhPost, zhPut } from '@/api/zhihu-http'
import zhihuHttp from '@/api/zhihu-http'

const A = '/alliance/api'

// ─── 渠道 ──────────────────────────────────────────────────────────
export interface AgentChannel  { channel_id: string; channel_name: string }
export interface SecondChannel { channel_id: string; channel_name: string }
export interface Pagination    { total: number; offset: number; limit: number; is_first?: boolean; is_end?: boolean }

export const allianceChannelApi = {
  getAgentChannels: () =>
    zhGet<AgentChannel[]>(`${A}/get_agent_channels`),
  getSecondChannels: (channel_id: string) =>
    zhGet<{ data: SecondChannel[]; pagination: Pagination }>(
      `${A}/second_channels`,
      { channel_id },
      { suppressErrorMessage: true },
    ),
}

// ─── 推广任务 ──────────────────────────────────────────────────────
export interface PopularizeTask {
  id: string; task_name: string; product_name: string
  status: string; pay_caliber: string; expiry_time: string
  media_platform?: string; attribution?: string; limit?: string
}
export interface TaskListResp { data: PopularizeTask[] | null; pagination: Pagination }

export const allianceTaskApi = {
  getTasks: (channel_id: string, offset = 0, limit = 20) =>
    zhGet<TaskListResp>(`${A}/popularize_tasks`, { channel_id, offset, limit }),
}

// ─── 推广计划 ──────────────────────────────────────────────────────
export interface CreatePlanReq {
  task_id: string; channel_id: string; content_url: string
  popularize_type: number; keyword: string; second_channel_id?: string
}
export interface CreatePlanResp { plan_id: string }
export interface BatchTaskResp  { batch_task_id: string }

export const alliancePlanApi = {
  createPlan: (req: CreatePlanReq) =>
    zhPost<CreatePlanResp>(`${A}/popularize_plan`, req),
  batchCreatePlans: (file: File, fields: { task_id: string; channel_id: string; popularize_type: number }) => {
    const fd = new FormData()
    fd.append('file', file)
    Object.entries(fields).forEach(([k, v]) => fd.append(k, String(v)))
    return zhPost<BatchTaskResp>(`${A}/popularize_plans`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
}

// ─── 推广作品 ──────────────────────────────────────────────────────
export interface CreateCompositionReq {
  plan_id: string; channel_id: string; media_type: number; media_account: string
  composition_type: number; composition_sub_type: number
  composition_url: string; release_time: string
}
export interface CreateCompositionResp { composition_id: string }
export interface CompositionListItem {
  keyword: string; composition_id: string; composition_url: string
  category1: string; category2: string; submit_time: string
  popularize_channel: string; audit_status: number
}
export interface CompositionListResp { data: CompositionListItem[]; pagination: Pagination }

export const allianceCompositionApi = {
  createComposition: (req: CreateCompositionReq) =>
    zhPost<CreateCompositionResp>(`${A}/popularize_composition/v2`, req),
  listCompositions: (params: { channel_id: string; keyword: string; offset?: number; limit?: number }) =>
    zhGet<CompositionListResp>(`${A}/popularize_compositions`, params),
  updateComposition: (id: string, req: Partial<CreateCompositionReq>) =>
    zhPut<void>(`${A}/popularize_composition/v2/${id}`, req),
  batchCreateCompositions: (file: File, fields: { bind_type: number; channel_id: string }) => {
    const fd = new FormData()
    fd.append('file', file)
    Object.entries(fields).forEach(([k, v]) => fd.append(k, String(v)))
    return zhPost<BatchTaskResp>(`${A}/popularize_compositions/v2`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
}

// ─── 批量任务结果 ──────────────────────────────────────────────────
export const allianceBatchApi = {
  getResult: (batch_task_id: string) =>
    zhihuHttp.get(`${A}/get_batch_task_result/${batch_task_id}`, { responseType: 'blob' })
      .then(r => r.data as Blob),
  downloadBlob: (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}

// ─── 实时数据 ──────────────────────────────────────────────────────
export interface RealTimeDataItem {
  keyword: string; channel_name: string
  fields_data: { search_num?: number; order_num?: number; created_at?: string }
}
export interface RealTimeDataResp { time_range: string; data: RealTimeDataItem[] }

export const allianceReportApi = {
  getRealTimeData: (fields = 'search_num,order_num,created_at') =>
    zhGet<RealTimeDataResp>(
      `${A}/data_report/real_time_data`,
      { type: 1, time_scale: 1, fields },
      { suppressErrorMessage: true },
    ),
}

// ─── 盐选榜单 ──────────────────────────────────────────────────────
export interface RankingLabel   { id: string; name: string; type: number }
export interface RankingContent { id: string; title: string; content_type: string; category: string; bayes_first_category?: string; bayes_second_category?: string; theme?: string }
export interface RankingContentDetail { title: string; word_count: number; public_at: string; section_url: string }
export interface RankingContentsResp  { data: RankingContent[]; pagination: Pagination }
export interface NewContent { section_title: string; well_title: string; author: string; hot_value: number; topic: string; created_at: string }

export const allianceRankingApi = {
  getLabels:       () => zhGet<RankingLabel[]>(`${A}/vip/content/rule/labels`),
  getContents:     (rule_id: string, page = 1) =>
    zhGet<RankingContentsResp>(`${A}/vip/rule_contents`, { rule_id, page }),
  getDetail:       (id: string) =>
    zhGet<RankingContentDetail>(`${A}/vip/rule_content/${id}`),
  getNewContents:  () => zhGet<NewContent[]>(`${A}/online_sections`),
}

// ─── 截流举报 ──────────────────────────────────────────────────────
export interface InterceptWord { keyword: string; channel: string; status: number; valided_at: string }
export interface InterceptWordsResp { data: InterceptWord[]; pagination: Pagination }
export interface SubmitInterceptReq { composition_id: string; keyword: string; image_tokens: string }

export const allianceInterceptApi = {
  getWords:  (params?: { keyword?: string; status?: number; offset?: number; limit?: number }) =>
    zhGet<InterceptWordsResp>(`${A}/intercept_words`, params),
  submitWord: (req: SubmitInterceptReq) =>
    zhPost<void>(`${A}/intercept_words`, req),
  uploadImage: (file: File) => {
    const fd = new FormData(); fd.append('file', file); fd.append('file_type', '1')
    return zhPost<{ file_token: string; file_url: string }>(`${A}/basic/file_upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
}

// ─── 风险词 ────────────────────────────────────────────────────────
export interface RiskWord { keyword: string; risk_type: number; channel: string; status: number; valided_at: string }
export interface RiskWordsResp { data: RiskWord[]; pagination: Pagination }
export interface SubmitRiskReq { keyword: string; risk_type: number; composition_id: string; image_tokens: string; risk_url?: string; damage_keyword?: string }

export const allianceRiskApi = {
  getWords:   (params?: { keyword?: string; risk_type?: number; status?: number; offset?: number; limit?: number }) =>
    zhGet<RiskWordsResp>(`${A}/risk_words`, params),
  submitWord: (req: SubmitRiskReq) =>
    zhPost<void>(`${A}/risk_words`, req),
}

// ─── 有声书 ────────────────────────────────────────────────────────
export interface AudioBook { section_id: string; title: string; content_type: string; episodes: number; topic: string; cover_url?: string }
export interface AudioBookListResp { data: AudioBook[]; pagination: Pagination }

export const allianceAudiobookApi = {
  getList:     (page = 1) => zhGet<AudioBookListResp>(`${A}/vip/audio/contents`, { page }),
  getPlayUrl:  (section_id: string) =>
    zhGet<{ url: string }>(`${A}/vip/audio/${section_id}/download`),
}

// ─── 漫剧 ──────────────────────────────────────────────────────────
export interface ComicDrama   { drama_id: string; title: string; story_url?: string; tab_artwork?: string }
export interface ComicEpisode { id: string; title: string; is_pay: boolean; video_url: string; douyin_video_url?: string }
export interface ComicDramaListResp   { data: ComicDrama[];   pagination: Pagination }
export interface ComicEpisodesResp    { data: ComicEpisode[]; pagination: Pagination }

export const allianceComicApi = {
  getDramas:   (params?: { title?: string; page?: number }) =>
    zhGet<ComicDramaListResp>(`${A}/comic_dramas`, params),
  getEpisodes: (dramaId: string, page = 1) =>
    zhGet<ComicEpisodesResp>(`${A}/comic_drama/${dramaId}/episodes`, { page }),
}

// ─── 内容标签 ──────────────────────────────────────────────────────
export type ContentTagResult = Record<string, unknown>

export const allianceContentTagApi = {
  getTag:      (url: string, tagTypes: number[]) =>
    zhGet<ContentTagResult>(`${A}/content_tag`, { url, tags: tagTypes.join(',') }),
  batchGetTags: (file: File) => {
    const fd = new FormData(); fd.append('file', file)
    return zhPost<BatchTaskResp>(`${A}/content_tags`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
}
