// 知乎联盟开放接口 — 所有 service 函数
// 底层通过 zhihu-http.ts，baseURL=/api，路由到 mock-server 或 BFF proxy
import { zhGet, zhPost, zhPut } from "@/api/zhihu-http";
import zhihuHttp from "@/api/zhihu-http";
import { z } from "zod";
import {
  AllianceHttpError,
  allianceHttp,
  type AllianceHttpClient,
} from "@/api/alliance-http";
import {
  batchCompositionRequestSchema,
  batchFormDataSchema,
  batchPlanRequestSchema,
  batchTaskDataSchema,
  compositionIdSchema,
  compositionListDataSchema,
  compositionListQuerySchema,
  createCompositionDataSchema,
  createCompositionRequestSchema,
  createPlanDataSchema,
  createPlanRequestSchema,
  MEDIA_TYPES as CONTRACT_MEDIA_TYPES,
  realTimeDataSchema,
  realTimeQuerySchema,
  validateBatchFileMagic,
  XLSX_CONTENT_TYPE,
  updateCompositionRequestSchema,
  type AllianceMeta,
  type BatchPlanRequest,
  type CompositionListItem as ContractCompositionListItem,
  type CreateCompositionRequest,
  type CreatePlanRequest,
  type RealTimeDataItem as ContractRealTimeDataItem,
  type UpdateCompositionRequest,
} from "@/contracts/alliance";

const A = "/alliance/api";

// ─── 渠道 ──────────────────────────────────────────────────────────
export interface AgentChannel {
  channel_id: string;
  channel_name: string;
}
export interface SecondChannel {
  channel_id: string;
  channel_name: string;
}
export interface Pagination {
  total: number;
  offset: number;
  limit: number;
  is_first?: boolean;
  is_end?: boolean;
}

export const allianceChannelApi = {
  getAgentChannels: () => zhGet<AgentChannel[]>(`${A}/get_agent_channels`),
  getSecondChannels: (channel_id: string) =>
    zhGet<{ data: SecondChannel[]; pagination: Pagination }>(
      `${A}/second_channels`,
      { channel_id },
      { suppressErrorMessage: true },
    ),
};

// ─── 推广任务 ──────────────────────────────────────────────────────
export interface PopularizeTask {
  id: string;
  task_name: string;
  product_name: string;
  status: string;
  pay_caliber: string;
  expiry_time: string;
  media_platform?: string;
  attribution?: string;
  limit?: string;
}
export interface TaskListResp {
  data: PopularizeTask[] | null;
  pagination: Pagination;
}

export const allianceTaskApi = {
  getTasks: (channel_id: string, offset = 0, limit = 20) =>
    zhGet<TaskListResp>(`${A}/popularize_tasks`, { channel_id, offset, limit }),
};

// ─── 推广计划 ──────────────────────────────────────────────────────
export type CreatePlanReq = CreatePlanRequest;
export interface CreatePlanResp {
  planId: string;
}
export interface BatchTaskResp {
  batch_task_id: string;
}

function invalidBatchFileError(): AllianceHttpError {
  return new AllianceHttpError(42200, "上传文件不符合要求", 422);
}

function validateBatchRequest(
  schema: typeof batchPlanRequestSchema | typeof batchCompositionRequestSchema,
  value: unknown,
): void {
  try {
    schema.parse(value);
  } catch {
    throw invalidBatchFileError();
  }
}

async function batchFilePayload(file: File): Promise<Blob> {
  try {
    await validateBatchFileMagic(file);
    if (typeof Blob !== "undefined" && file instanceof Blob) return file;
    return new Blob([await file.arrayBuffer()], { type: XLSX_CONTENT_TYPE });
  } catch {
    throw invalidBatchFileError();
  }
}

function newBatchFormData(): FormData {
  if (typeof FormData === "undefined") {
    throw invalidBatchFileError();
  }
  return new FormData();
}

export function createAlliancePlanApi(
  client: AllianceHttpClient = allianceHttp,
) {
  return {
    createPlan: (req: CreatePlanReq) =>
      client.requestData(
        { method: "POST", url: `${A}/popularize_plan`, data: req },
        createPlanRequestSchema,
        createPlanDataSchema,
      ),
    batchCreatePlans: async (
      file: File,
      fields: Omit<BatchPlanRequest, "file">,
    ) => {
      validateBatchRequest(batchPlanRequestSchema, { ...fields, file });
      const payload = await batchFilePayload(file);
      const form = newBatchFormData();
      form.append("taskId", fields.taskId);
      form.append("channelId", fields.channelId);
      form.append("popularizeType", String(fields.popularizeType));
      if (fields.secondChannelId !== undefined) {
        form.append("secondChannelId", fields.secondChannelId);
      }
      form.append("file", payload, "upload.xlsx");
      batchFormDataSchema.parse(form);
      return client.requestData(
        {
          method: "POST",
          url: `${A}/popularize_plans`,
          data: form,
        },
        batchFormDataSchema,
        batchTaskDataSchema,
      );
    },
  };
}

export const alliancePlanApi = createAlliancePlanApi();

// ─── 推广作品 ──────────────────────────────────────────────────────
export const MEDIA_TYPES = CONTRACT_MEDIA_TYPES;
export type MediaType = (typeof MEDIA_TYPES)[number];

export type CreateCompositionReq = CreateCompositionRequest;
export interface CreateCompositionResp {
  compositionId: string;
}
export type CompositionListItem = ContractCompositionListItem;
export interface CompositionListResp {
  data: CompositionListItem[];
  meta: AllianceMeta;
}

export function createAllianceCompositionApi(
  client: AllianceHttpClient = allianceHttp,
) {
  return {
    createComposition: (req: CreateCompositionReq) =>
      client.requestData(
        { method: "POST", url: `${A}/popularize_composition/v2`, data: req },
        createCompositionRequestSchema,
        createCompositionDataSchema,
      ),
    listCompositions: (params: {
      channelId: string;
      keyword: string;
      page?: number;
      pageSize?: number;
    }) => {
      const query = {
        channelId: params.channelId,
        keyword: params.keyword,
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 10,
      };
      return client.requestPage(
        { method: "GET", url: `${A}/popularize_compositions`, params: query },
        compositionListQuerySchema,
        compositionListDataSchema,
      );
    },
    updateComposition: (id: string, req: UpdateCompositionRequest) => {
      const compositionId = compositionIdSchema.parse(id);
      return client.requestData(
        {
          method: "PUT",
          url: `${A}/popularize_composition/v2/${compositionId}`,
          data: req,
        },
        updateCompositionRequestSchema,
        z.null(),
      );
    },
    batchCreateCompositions: async (
      file: File,
      fields: { bindType: 1 | 2; channelId: string },
    ) => {
      validateBatchRequest(batchCompositionRequestSchema, { ...fields, file });
      const payload = await batchFilePayload(file);
      const form = newBatchFormData();
      form.append("bindType", String(fields.bindType));
      form.append("channelId", fields.channelId);
      form.append("file", payload, "upload.xlsx");
      batchFormDataSchema.parse(form);
      return client.requestData(
        {
          method: "POST",
          url: `${A}/popularize_compositions/v2`,
          data: form,
        },
        batchFormDataSchema,
        batchTaskDataSchema,
      );
    },
  };
}

export const allianceCompositionApi = createAllianceCompositionApi();

// ─── 批量任务结果 ──────────────────────────────────────────────────
export const allianceBatchApi = {
  getResult: (batch_task_id: string) =>
    zhihuHttp
      .get(`${A}/get_batch_task_result/${batch_task_id}`, {
        responseType: "blob",
      })
      .then((r) => r.data as Blob),
  downloadBlob: (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

// ─── 实时数据 ──────────────────────────────────────────────────────
export type RealTimeDataItem = ContractRealTimeDataItem;
export interface RealTimeDataResp {
  timeRange: string;
  items: RealTimeDataItem[];
}

export const allianceReportApi = {
  getRealTimeData: (fields = "search_num,order_num,created_at") =>
    allianceHttp.requestData(
      {
        method: "GET",
        url: `${A}/data_report/real_time_data`,
        params: { type: 1, timeScale: 1, fields },
      },
      realTimeQuerySchema,
      realTimeDataSchema,
    ),
};

// ─── 盐选榜单 ──────────────────────────────────────────────────────
export interface RankingLabel {
  id: string;
  name: string;
  type: number;
}
export interface RankingContent {
  id: string;
  title: string;
  content_type: string;
  category: string;
  bayes_first_category?: string;
  bayes_second_category?: string;
  theme?: string;
}
export interface RankingContentDetail {
  title: string;
  word_count: number;
  public_at: string;
  section_url: string;
}
export interface RankingContentsResp {
  data: RankingContent[];
  pagination: Pagination;
}
export interface NewContent {
  section_title: string;
  well_title: string;
  author: string;
  hot_value: number;
  topic: string;
  created_at: string;
}

export const allianceRankingApi = {
  getLabels: () => zhGet<RankingLabel[]>(`${A}/vip/content/rule/labels`),
  getContents: (rule_id: string, page = 1) =>
    zhGet<RankingContentsResp>(`${A}/vip/rule_contents`, { rule_id, page }),
  getDetail: (id: string) =>
    zhGet<RankingContentDetail>(`${A}/vip/rule_content/${id}`),
  getNewContents: () => zhGet<NewContent[]>(`${A}/online_sections`),
};

// ─── 截流举报 ──────────────────────────────────────────────────────
export interface InterceptWord {
  keyword: string;
  channel: string;
  status: number;
  valided_at: string;
}
export interface InterceptWordsResp {
  data: InterceptWord[];
  pagination: Pagination;
}
export interface SubmitInterceptReq {
  composition_id: string;
  keyword: string;
  image_tokens: string;
}

export const allianceInterceptApi = {
  getWords: (params?: {
    keyword?: string;
    status?: number;
    offset?: number;
    limit?: number;
  }) => zhGet<InterceptWordsResp>(`${A}/intercept_words`, params),
  submitWord: (req: SubmitInterceptReq) =>
    zhPost<void>(`${A}/intercept_words`, req),
  uploadImage: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("file_type", "1");
    return zhPost<{ file_token: string; file_url: string }>(
      `${A}/basic/file_upload`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
  },
};

// ─── 风险词 ────────────────────────────────────────────────────────
export interface RiskWord {
  keyword: string;
  risk_type: number;
  channel: string;
  status: number;
  valided_at: string;
}
export interface RiskWordsResp {
  data: RiskWord[];
  pagination: Pagination;
}
export interface SubmitRiskReq {
  keyword: string;
  risk_type: number;
  composition_id: string;
  image_tokens: string;
  risk_url?: string;
  damage_keyword?: string;
}

export const allianceRiskApi = {
  getWords: (params?: {
    keyword?: string;
    risk_type?: number;
    status?: number;
    offset?: number;
    limit?: number;
  }) => zhGet<RiskWordsResp>(`${A}/risk_words`, params),
  submitWord: (req: SubmitRiskReq) => zhPost<void>(`${A}/risk_words`, req),
};

// ─── 有声书 ────────────────────────────────────────────────────────
export interface AudioBook {
  section_id: string;
  title: string;
  content_type: string;
  episodes: number;
  topic: string;
  cover_url?: string;
}
export interface AudioBookListResp {
  data: AudioBook[];
  pagination: Pagination;
}

export const allianceAudiobookApi = {
  getList: (page = 1) =>
    zhGet<AudioBookListResp>(`${A}/vip/audio/contents`, { page }),
  getPlayUrl: (section_id: string) =>
    zhGet<{ url: string }>(`${A}/vip/audio/${section_id}/download`),
};

// ─── 漫剧 ──────────────────────────────────────────────────────────
export interface ComicDrama {
  drama_id: string;
  title: string;
  story_url?: string;
  tab_artwork?: string;
}
export interface ComicEpisode {
  id: string;
  title: string;
  is_pay: boolean;
  video_url: string;
  douyin_video_url?: string;
}
export interface ComicDramaListResp {
  data: ComicDrama[];
  pagination: Pagination;
}
export interface ComicEpisodesResp {
  data: ComicEpisode[];
  pagination: Pagination;
}

export const allianceComicApi = {
  getDramas: (params?: { title?: string; page?: number }) =>
    zhGet<ComicDramaListResp>(`${A}/comic_dramas`, params),
  getEpisodes: (dramaId: string, page = 1) =>
    zhGet<ComicEpisodesResp>(`${A}/comic_drama/${dramaId}/episodes`, { page }),
};

// ─── 内容标签 ──────────────────────────────────────────────────────
export type ContentTagResult = Record<string, unknown>;

export const allianceContentTagApi = {
  getTag: (url: string, tagTypes: number[]) =>
    zhGet<ContentTagResult>(`${A}/content_tag`, {
      url,
      tags: tagTypes.join(","),
    }),
  batchGetTags: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return zhPost<BatchTaskResp>(`${A}/content_tags`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};
