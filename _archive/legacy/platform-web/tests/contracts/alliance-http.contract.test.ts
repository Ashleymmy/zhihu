import {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createAllianceCompositionApi,
  createAlliancePlanApi,
} from "@/api/alliance";
import {
  AllianceHttpError,
  AllianceProtocolError,
  createAllianceHttpClient,
} from "@/api/alliance-http";
import {
  allianceMetaSchema,
  batchFormDataSchema,
  batchTaskDataSchema,
  compositionListDataSchema,
  createPlanDataSchema,
  failureEnvelopeSchema,
  MAX_PAGE,
  pagedSuccessEnvelopeSchema,
  successEnvelopeSchema,
} from "@/contracts/alliance";

const requestSchema = z.object({ value: z.string() }).strict();
const dataSchema = z.object({ result: z.string() }).strict();

function response(data: unknown, status = 200): AxiosResponse<unknown> {
  return {
    data,
    status,
    statusText: "",
    headers: {},
    config: {},
  } as AxiosResponse<unknown>;
}

function testClient() {
  const request =
    vi.fn<(config: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>>();
  const client = createAllianceHttpClient({
    request,
  } as unknown as AxiosInstance);
  return { request, client };
}

describe("P0007-R2B strict Alliance HTTP wrapper", () => {
  it("P0007-R3-PLATFORM-001 accepts only native FormData and clears JSON content type", async () => {
    const { request, client } = testClient();
    request.mockResolvedValueOnce(
      response({
        code: 0,
        message: "ok",
        data: { batchTaskId: "2071267000000000001" },
        requestId: "req-batch",
        timestamp: 1787000000000,
      }),
    );
    const form = new FormData();
    form.append("taskId", "1");
    await expect(
      client.requestData(
        {
          method: "POST",
          url: "/alliance/api/popularize_plans",
          data: form,
          headers: { "Content-Type": "application/json" },
        },
        batchFormDataSchema,
        batchTaskDataSchema,
      ),
    ).resolves.toEqual({ batchTaskId: "2071267000000000001" });
    expect(request.mock.calls[0]?.[0]?.headers).toMatchObject({
      "Content-Type": undefined,
    });

    await expect(
      client.requestData(
        {
          method: "POST",
          url: "/alliance/api/popularize_plans",
          data: { append() {}, entries() {} },
        },
        batchFormDataSchema,
        batchTaskDataSchema,
      ),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
  });

  it("P0007-R2B-API-001 traverses the real API, HTTP wrapper, and Zod schemas", async () => {
    const { request, client } = testClient();
    request.mockResolvedValueOnce(
      response({
        code: 0,
        message: "ok",
        data: { planId: "2071265453767405652" },
        requestId: "req-api-chain",
        timestamp: 1787000000000,
      }),
    );

    const api = createAlliancePlanApi(client);
    await expect(
      api.createPlan({
        taskId: "2071265453767405650",
        channelId: "z001",
        contentUrl: "https://example.com/landing",
        popularizeType: 0,
        keyword: "  关键词  ",
      }),
    ).resolves.toEqual({ planId: "2071265453767405652" });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/alliance/api/popularize_plan",
        data: expect.objectContaining({ keyword: "关键词" }),
      }),
    );
  });

  it("P0007-R2B-DTO-001 rejects Server-incompatible boundaries with zero HTTP calls", async () => {
    const { request, client } = testClient();
    const api = createAllianceCompositionApi(client);
    const valid = {
      planId: "2071265453767405652",
      channelId: "z001",
      mediaType: "KOC定向" as const,
      mediaAccount: "account",
      compositionType: 0,
      compositionSubType: 11,
      compositionUrl: "https://example.com/content",
      releaseTime: "2026-08-17T10:00:00+08:00",
    };

    await expect(
      api.createComposition({ ...valid, mediaAccount: "   " }),
    ).rejects.toThrow();
    await expect(
      api.createComposition({
        ...valid,
        releaseTime: "1969-12-31T23:59:59Z",
      }),
    ).rejects.toThrow();
    for (const [compositionType, compositionSubType] of [
      [0, 1],
      [1, 5],
      [2, 4],
    ] as const) {
      await expect(
        api.createComposition({
          ...valid,
          compositionType,
          compositionSubType,
        }),
      ).rejects.toThrow();
    }
    await expect(
      api.listCompositions({
        channelId: "z001",
        keyword: "关键词",
        page: MAX_PAGE + 1,
        pageSize: 100,
      }),
    ).rejects.toThrow();
    expect(
      compositionListDataSchema.safeParse([
        {
          compositionId: "2071266138193975100",
          compositionUrl: "https://example.com/content",
          submitTime: "2026-08-17T10:00:00+08:00",
          compositionType: 0,
          compositionSubType: 1,
          keyword: "关键词",
        },
      ]).success,
    ).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("P0007-R2B-ENV-001 accepts only complete success and paged envelopes", async () => {
    const { request, client } = testClient();
    request.mockResolvedValueOnce(
      response({
        code: 0,
        message: "ok",
        data: { result: "ok" },
        requestId: "req-1",
        timestamp: 1787000000000,
      }),
    );
    await expect(
      client.requestData(
        { method: "POST", url: "/alliance/api/example", data: { value: "v" } },
        requestSchema,
        dataSchema,
      ),
    ).resolves.toEqual({ result: "ok" });

    request.mockResolvedValueOnce(
      response({
        code: 0,
        message: "ok",
        data: [],
        meta: { page: 1, pageSize: 10, total: 0 },
        requestId: "req-2",
        timestamp: 1787000000000,
      }),
    );
    await expect(
      client.requestPage(
        { method: "GET", url: "/alliance/api/list", params: { value: "v" } },
        requestSchema,
        z.array(z.never()),
      ),
    ).resolves.toEqual({ data: [], meta: { page: 1, pageSize: 10, total: 0 } });

    expect(
      successEnvelopeSchema.safeParse({
        code: 0,
        message: "ok",
        data: null,
        requestId: "req-1",
        timestamp: 1787000000000,
      }).success,
    ).toBe(true);
    expect(
      pagedSuccessEnvelopeSchema.safeParse({
        code: 0,
        message: "ok",
        data: [],
        meta: { page: 1, pageSize: 10, total: 0 },
        requestId: "req-2",
        timestamp: 1787000000000,
      }).success,
    ).toBe(true);
    expect(
      allianceMetaSchema.safeParse({
        page: 1,
        pageSize: 10,
        total: 0,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("P0007-R2B-DTO-001 rejects snake_case, unknown request fields, and malformed success bodies before/after HTTP", async () => {
    const { request, client } = testClient();
    await expect(
      client.requestData(
        {
          method: "POST",
          url: "/alliance/api/example",
          data: { value: "v", value_id: "legacy" },
        },
        requestSchema,
        dataSchema,
      ),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();

    request.mockResolvedValueOnce(
      response({
        code: 0,
        message: "ok",
        data: { result: "ok" },
        requestId: "req-1",
        timestamp: 1787000000000,
        success: true,
      }),
    );
    await expect(
      client.requestData(
        { method: "POST", url: "/alliance/api/example", data: { value: "v" } },
        requestSchema,
        dataSchema,
      ),
    ).rejects.toBeInstanceOf(AllianceProtocolError);

    request.mockResolvedValueOnce(
      response({
        code: 0,
        message: "ok",
        data: [],
        requestId: "req-1",
        timestamp: 1787000000000,
      }),
    );
    await expect(
      client.requestPage(
        { method: "GET", url: "/alliance/api/list", params: { value: "v" } },
        requestSchema,
        z.array(z.never()),
      ),
    ).rejects.toBeInstanceOf(AllianceProtocolError);
  });

  it("P0007-R2B-ENV-001 exposes only typed failure details and rejects legacy failure shapes", async () => {
    const { request, client } = testClient();
    const failure = {
      code: 50300,
      message: "批量上传暂未开放",
      requestId: "req-failure",
      timestamp: 1787000000000,
      details: { reason: ["R3 前关闭"] },
    };
    request.mockResolvedValueOnce(response(failure, 503));
    await expect(
      client.requestData(
        { method: "POST", url: "/alliance/api/batch", data: { value: "v" } },
        requestSchema,
        dataSchema,
      ),
    ).rejects.toMatchObject<Partial<AllianceHttpError>>({
      code: 50300,
      status: 503,
      details: failure.details,
    });
    expect(failureEnvelopeSchema.safeParse(failure).success).toBe(true);

    request.mockResolvedValueOnce(
      response({ success: false, code: 50300, msg: "legacy", data: null }, 503),
    );
    await expect(
      client.requestData(
        { method: "POST", url: "/alliance/api/batch", data: { value: "v" } },
        requestSchema,
        dataSchema,
      ),
    ).rejects.toBeInstanceOf(AllianceProtocolError);
    expect(new AllianceHttpError(50300, "x", 503)).toBeInstanceOf(Error);
  });

  it("P0007-R2B-PRECISION-001 keeps large Snowflake IDs as strings", () => {
    const largeId = "2071265453767405652";
    expect(createPlanDataSchema.parse({ planId: largeId }).planId).toBe(
      largeId,
    );
    expect(() =>
      createPlanDataSchema.parse({ planId: 2071265453767405652 }),
    ).toThrow();
  });

  it("P0007-R2B-ENV-001 sanitizes Axios and ordinary transport failures", async () => {
    const { request, client } = testClient();
    const upstreamSecret = "https://secret.example/path?access_token=leak";
    request.mockRejectedValueOnce(
      new AxiosError(
        upstreamSecret,
        "ERR_BAD_RESPONSE",
        undefined,
        undefined,
        response({ upstream: upstreamSecret }, 502),
      ),
    );
    let axiosFailure: unknown;
    try {
      await client.requestData(
        { method: "POST", url: "/alliance/api/example", data: { value: "v" } },
        requestSchema,
        dataSchema,
      );
    } catch (error: unknown) {
      axiosFailure = error;
    }
    expect(axiosFailure).toMatchObject({
      name: "AllianceHttpError",
      code: 0,
      status: 502,
      message: "Alliance 网络请求失败",
    });

    request.mockRejectedValueOnce(new Error(upstreamSecret));
    let ordinaryFailure: unknown;
    try {
      await client.requestData(
        { method: "POST", url: "/alliance/api/example", data: { value: "v" } },
        requestSchema,
        dataSchema,
      );
    } catch (error: unknown) {
      ordinaryFailure = error;
    }
    expect(ordinaryFailure).toMatchObject({
      name: "AllianceHttpError",
      code: 0,
      status: 0,
      message: "Alliance 网络请求失败",
    });
    for (const failure of [axiosFailure, ordinaryFailure]) {
      expect(String(failure)).not.toContain(upstreamSecret);
      expect(JSON.stringify(failure)).not.toMatch(
        /secret\.example|access_token|leak/u,
      );
    }
  });
});
