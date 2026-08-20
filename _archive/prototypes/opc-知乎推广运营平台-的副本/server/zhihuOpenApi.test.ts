import { describe, expect, it, vi } from "vitest";
import { createZhihuSignature, ZhihuOpenApiClient } from "./zhihuOpenApi";

describe("知乎开放平台客户端", () => {
  it("任务查询仅对文档规定的参数生成签名，分页参数仍会随请求发送", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) });
    const client = new ZhihuOpenApiClient({ accessToken: "token", secretKey: "secret", baseUrl: "https://example.test", fetchFn });

    await client.getPromotionTasks("channel-1", 10, 25);

    const requestUrl = new URL(fetchFn.mock.calls[0][0]);
    expect(requestUrl.pathname).toBe("/popularize_tasks");
    expect(requestUrl.searchParams.get("offset")).toBe("10");
    expect(requestUrl.searchParams.get("limit")).toBe("25");
    expect(requestUrl.searchParams.get("signature")).toBe(createZhihuSignature({ access_token: "token", channel_id: "channel-1", timestamp: 1_700_000_000 }, "secret"));
    vi.restoreAllMocks();
  });

  it("渠道与实时数据接口保持只读，并使用文档所需的未签名参数", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) });
    const client = new ZhihuOpenApiClient({ accessToken: "token", secretKey: "secret", baseUrl: "https://example.test", fetchFn });

    await client.getAgentChannels();
    await client.getRealtimeKeywordMetrics();

    const channelsUrl = new URL(fetchFn.mock.calls[0][0]);
    const metricsUrl = new URL(fetchFn.mock.calls[1][0]);
    expect(channelsUrl.pathname).toBe("/get_agent_channels");
    expect(channelsUrl.searchParams.get("signature")).toBeNull();
    expect(metricsUrl.pathname).toBe("/data_report/real_time_data");
    expect(metricsUrl.searchParams.get("fields")).toBe("search_num,order_num,created_at");
    expect(metricsUrl.searchParams.get("signature")).toBeNull();
  });

  it("创建推广计划使用 JSON 请求体，并将二代渠道排除在签名参数外", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { plan_id: "plan-1" } }) });
    const client = new ZhihuOpenApiClient({ accessToken: "token", secretKey: "secret", baseUrl: "https://example.test", fetchFn });

    await expect(client.createPromotionPlan({ taskId: "task-1", channelId: "channel-1", contentUrl: "https://www.zhihu.com/xen/market/remix/paid_column/1", keyword: "验证词", secondChannelId: "channel-2" })).resolves.toEqual({ plan_id: "plan-1" });

    const [url, options] = fetchFn.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(url).toBe("https://example.test/popularize_plan");
    expect(options.method).toBe("POST");
    expect(body.second_channel_id).toBe("channel-2");
    expect(body.signature).toBe(createZhihuSignature({ access_token: "token", channel_id: "channel-1", content_url: "https://www.zhihu.com/xen/market/remix/paid_column/1", keyword: "验证词", popularize_type: 0, task_id: "task-1", timestamp: 1_700_000_000 }, "secret"));
    vi.restoreAllMocks();
  });

  it("将外部连接超时转换为可操作的中文诊断信息", async () => {
    const timeout = Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
    const fetchFn = vi.fn().mockRejectedValue(timeout);
    const client = new ZhihuOpenApiClient({ accessToken: "token", secretKey: "secret", baseUrl: "https://example.test", fetchFn });

    await expect(client.getAgentChannels()).rejects.toThrow("知乎开放平台连接超时");
  });

  it("批量创建生成 Excel Form-Data，并排除文件和二代渠道参与签名", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { batch_task_id: "batch-1" } }) });
    const client = new ZhihuOpenApiClient({ accessToken: "token", secretKey: "secret", baseUrl: "https://example.test", fetchFn });

    await expect(client.createPromotionPlansBatch({ taskId: "task-1", channelId: "channel-1", items: [{ contentUrl: "https://www.zhihu.com/market/paid_column/1/section/2", keyword: "验证词" }], secondChannelId: "channel-2" })).resolves.toEqual({ batch_task_id: "batch-1" });

    const [url, options] = fetchFn.mock.calls[0];
    const form = options.body as FormData;
    expect(url).toBe("https://example.test/popularize_plans");
    expect(options.headers["X-Requested-With"]).toBe("openApi");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("signature")).toBe(createZhihuSignature({ access_token: "token", channel_id: "channel-1", popularize_type: 0, task_id: "task-1", timestamp: 1_700_000_000 }, "secret"));
    vi.restoreAllMocks();
  });
});
