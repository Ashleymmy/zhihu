import { createHash, createHmac } from "node:crypto";
import ExcelJS from "exceljs";

const BASE_URL = "https://open.zhihu.com/alliance/api";

type OpenApiEnvelope<T> = {
  success?: boolean;
  msg?: string;
  data?: T;
  error?: { code?: number; name?: string; message?: string };
};

export type ZhihuChannel = {
  channel_id: string;
  channel_name: string;
};

export type ZhihuPromotionTask = {
  id: string;
  task_name: string;
  product_name: string;
  status: "开启" | "暂停" | "过期" | string;
  pay_caliber: string;
  expiry_time: string;
  limit: string;
  media_platform: string;
  attribution: string;
};

export type ZhihuRealtimeKeywordMetric = {
  keyword: string;
  channel_id: string;
  channel_name: string;
  fields_data: {
    created_at?: string;
    order_num?: number;
    search_num?: number;
  };
};

export type ZhihuOpenApiConfig = {
  accessToken: string;
  secretKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

export type ZhihuCreatePromotionPlanInput = {
  taskId: string;
  channelId: string;
  contentUrl: string;
  keyword: string;
  popularizeType?: 0;
  secondChannelId?: string;
};

export type ZhihuBatchPlanItem = {
  contentUrl: string;
  keyword: string;
};

export type ZhihuCreatePromotionPlansBatchInput = {
  taskId: string;
  channelId: string;
  items: ZhihuBatchPlanItem[];
  popularizeType?: 0;
  secondChannelId?: string;
};

function nonEmptyString(value: string, field: string) {
  if (!value.trim()) throw new Error(`知乎开放平台配置缺少 ${field}`);
  return value;
}

function externalNetworkError(error: unknown) {
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: { code?: string } }).cause : undefined;
  const timedOut = cause?.code === "UND_ERR_CONNECT_TIMEOUT" || (error instanceof Error && /timeout/i.test(error.message));
  return new Error(timedOut ? "知乎开放平台连接超时，请稍后重试或联系知乎运营方确认服务可达性" : "知乎开放平台网络连接失败，请检查服务可达性后再试");
}

/**
 * 按知乎 OpenAPI V1.4.17 的规则生成签名：参与签名参数按字典序拼接，
 * 先计算小写 MD5，再以 secret_key 作为 HMAC-SHA256 密钥。
 */
export function createZhihuSignature(params: Record<string, string | number>, secretKey: string) {
  const canonical = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const digest = createHash("md5").update(canonical, "utf8").digest("hex").toLowerCase();
  return createHmac("sha256", secretKey).update(digest, "utf8").digest("hex");
}

export class ZhihuOpenApiClient {
  private readonly accessToken: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: ZhihuOpenApiConfig) {
    this.accessToken = nonEmptyString(config.accessToken, "ZHIHU_OPEN_API_ACCESS_TOKEN");
    this.secretKey = nonEmptyString(config.secretKey, "ZHIHU_OPEN_API_SECRET_KEY");
    this.baseUrl = (config.baseUrl ?? BASE_URL).replace(/\/$/, "");
    this.fetchFn = config.fetchFn ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 45_000;
  }

  private async get<T>(path: string, params: Record<string, string | number>, signed = true, unsignedKeys: string[] = []): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000);
    const requestParams: Record<string, string | number> = {
      ...params,
      access_token: this.accessToken,
      ...(signed ? { timestamp } : {}),
    };
    const signingParams = signed
      ? Object.fromEntries(Object.entries(requestParams).filter(([key]) => !unsignedKeys.includes(key)))
      : null;
    const query = new URLSearchParams(
      Object.entries({
        ...requestParams,
        ...(signingParams ? { signature: createZhihuSignature(signingParams, this.secretKey) } : {}),
      }).map(([key, value]) => [key, String(value)]),
    );
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}?${query.toString()}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw externalNetworkError(error);
    }
    const body = await response.json().catch(() => ({})) as OpenApiEnvelope<T>;
    if (!response.ok || body.success !== true) {
      const message = body.error?.message ?? body.msg ?? `HTTP ${response.status}`;
      throw new Error(`知乎开放平台请求失败：${message}`);
    }
    return body.data as T;
  }

  private async post<T>(path: string, params: Record<string, string | number>, unsignedKeys: string[] = []): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000);
    const requestParams: Record<string, string | number> = { ...params, access_token: this.accessToken, timestamp };
    const signingParams = Object.fromEntries(Object.entries(requestParams).filter(([key]) => !unsignedKeys.includes(key)));
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestParams, signature: createZhihuSignature(signingParams, this.secretKey) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw externalNetworkError(error);
    }
    const body = await response.json().catch(() => ({})) as OpenApiEnvelope<T>;
    if (!response.ok || body.success !== true) {
      const message = body.error?.message ?? body.msg ?? `HTTP ${response.status}`;
      throw new Error(`知乎开放平台请求失败：${message}`);
    }
    return body.data as T;
  }

  /** 读取当前开发者可用的一代推广渠道；文档规定此接口仅需 access_token。 */
  async getAgentChannels() {
    return this.get<ZhihuChannel[]>("/get_agent_channels", {}, false);
  }

  /** 读取渠道下可推广任务；此接口会校验 access_token、timestamp 与 signature。 */
  async getPromotionTasks(channelId: string, offset = 0, limit = 20) {
    return this.get<ZhihuPromotionTask[]>("/popularize_tasks", { channel_id: channelId, offset, limit }, true, ["offset", "limit"]);
  }

  /** 读取关键词维度的实时投放数据；文档说明其存在小时级延迟，且不能作为结算依据。 */
  async getRealtimeKeywordMetrics() {
    return this.get<ZhihuRealtimeKeywordMetric[]>("/data_report/real_time_data", {
      type: 1,
      time_scale: 1,
      fields: "search_num,order_num,created_at",
    }, false);
  }

  /** 创建单个 KOC 搜索词推广计划；调用方必须先在本地建立幂等提交记录。 */
  async createPromotionPlan(input: ZhihuCreatePromotionPlanInput) {
    return this.post<{ plan_id: string }>("/popularize_plan", {
      task_id: input.taskId,
      channel_id: input.channelId,
      content_url: input.contentUrl,
      popularize_type: input.popularizeType ?? 0,
      keyword: input.keyword,
      ...(input.secondChannelId ? { second_channel_id: input.secondChannelId } : {}),
    }, ["second_channel_id"]);
  }

  /** 以模板1的推导列（content_url、keyword）生成单工作表 Excel，并提交知乎异步批量任务。 */
  async createPromotionPlansBatch(input: ZhihuCreatePromotionPlansBatchInput) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("推广计划");
    worksheet.columns = [
      { header: "content_url", key: "contentUrl", width: 72 },
      { header: "keyword", key: "keyword", width: 28 },
    ];
    input.items.forEach(item => worksheet.addRow(item));
    const workbookData = await workbook.xlsx.writeBuffer();
    const timestamp = Math.floor(Date.now() / 1000);
    const requestParams: Record<string, string | number> = {
      task_id: input.taskId,
      channel_id: input.channelId,
      popularize_type: input.popularizeType ?? 0,
      access_token: this.accessToken,
      timestamp,
      ...(input.secondChannelId ? { second_channel_id: input.secondChannelId } : {}),
    };
    const signingParams = Object.fromEntries(Object.entries(requestParams).filter(([key]) => key !== "second_channel_id"));
    const form = new FormData();
    form.append("file", new Blob([workbookData], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "zhihu-batch-plans.xlsx");
    Object.entries(requestParams).forEach(([key, value]) => form.append(key, String(value)));
    form.append("signature", createZhihuSignature(signingParams, this.secretKey));

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/popularize_plans`, {
        method: "POST",
        headers: { "X-Requested-With": "openApi" },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw externalNetworkError(error);
    }
    const body = await response.json().catch(() => ({})) as OpenApiEnvelope<{ batch_task_id: string }>;
    if (!response.ok || body.success !== true) {
      const message = body.error?.message ?? body.msg ?? `HTTP ${response.status}`;
      throw new Error(`知乎开放平台请求失败：${message}`);
    }
    if (!body.data?.batch_task_id) throw new Error("知乎开放平台响应缺少 batch_task_id");
    return body.data;
  }

  /** 下载异步批量任务结果文件，仅返回前 50 行文本摘要，不保存文件字节。 */
  async getBatchTaskResult(batchTaskId: string) {
    const url = new URL(`${this.baseUrl}/get_batch_task_result/${batchTaskId}`);
    url.searchParams.set("access_token", this.accessToken);
    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw externalNetworkError(error);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || contentType.includes("json")) {
      const body = await response.json().catch(() => ({})) as OpenApiEnvelope<never>;
      const message = body.error?.message ?? body.msg ?? `HTTP ${response.status}`;
      throw new Error(`知乎开放平台请求失败：${message}`);
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const worksheet = workbook.worksheets[0];
    const rows: string[][] = [];
    worksheet?.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      if (rowNumber <= 50) rows.push(values.map(value => String(value ?? "")));
    });
    return { rows };
  }
}

export function getZhihuOpenApiClient() {
  return new ZhihuOpenApiClient({
    accessToken: process.env.ZHIHU_OPEN_API_ACCESS_TOKEN ?? "",
    secretKey: process.env.ZHIHU_OPEN_API_SECRET_KEY ?? "",
  });
}
