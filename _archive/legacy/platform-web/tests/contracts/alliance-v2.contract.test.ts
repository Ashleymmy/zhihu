import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import {
  batchFileSchema,
  batchCompositionRequestSchema,
  batchPlanRequestSchema,
  compositionListQuerySchema,
  createCompositionRequestSchema,
  createPlanRequestSchema,
  realTimeQuerySchema,
} from "@/contracts/alliance";

const mocks = vi.hoisted(() => ({
  requestData: vi.fn(),
  requestPage: vi.fn(),
  localGet: vi.fn(),
  legacyGet: vi.fn(),
  legacyPost: vi.fn(),
  legacyPut: vi.fn(),
}));

vi.mock("@/api/alliance-http", async () => {
  const actual = await vi.importActual<typeof import("@/api/alliance-http")>(
    "@/api/alliance-http",
  );
  return { ...actual, allianceHttp: mocks };
});

vi.mock("@/api/zhihu-http", () => ({
  zhGet: mocks.legacyGet,
  zhPost: mocks.legacyPost,
  zhPut: mocks.legacyPut,
  default: { get: mocks.legacyGet },
}));

vi.mock("@/api/http", () => ({
  http: {
    get: mocks.localGet,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

import {
  allianceCompositionApi,
  alliancePlanApi,
  allianceReportApi,
} from "@/api/alliance";
import { useZChannelStore } from "@/stores/zChannel.store";
import {
  canUpdateCompositionFromList,
  runCompositionBatchUiAction,
  useZCompositionStore,
} from "@/stores/zComposition.store";
import { useZPlanStore } from "@/stores/zPlan.store";

const platformRoot = fileURLToPath(new URL("../..", import.meta.url));

function fileFixture(): File {
  const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
  return new File([bytes], "upload.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function resetApiMocks() {
  mocks.requestData.mockReset();
  mocks.requestPage.mockReset();
}

function runInvalidRawProbe() {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          "../../../server/node_modules/tsx/dist/cli.mjs",
          import.meta.url,
        ),
      ),
      fileURLToPath(
        new URL("../../scripts/raw-composition-probe.mts", import.meta.url),
      ),
      "--list-only",
      "--list-path",
      "/alliance/api/popularize_compositions/v2",
    ],
    {
      cwd: platformRoot,
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, NODE_ENV: "test" },
    },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

async function waitForMockServer(child: ReturnType<typeof spawn>) {
  return new Promise<number>((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = output.match(/服务地址:\s+http:\/\/localhost:(\d+)/u);
      if (output.includes("Mock BFF") && match) {
        child.stdout?.off("data", onData);
        resolve(Number(match[1]));
      }
    };
    child.stdout?.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== null)
        reject(new Error(`mock server exited before listening: ${code}`));
    });
  });
}

async function requestMockPaths() {
  const child = spawn(process.execPath, ["mock-server.cjs"], {
    cwd: platformRoot,
    env: { ...process.env, MOCK_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForMockServer(child);
    const paths = await Promise.all([
      fetch(`http://127.0.0.1:${port}/alliance/api/not-declared`),
      fetch(`http://127.0.0.1:${port}/alliance/api/get_agent_channels`),
      fetch(`http://127.0.0.1:${port}/alliance/api/popularize_plans`, {
        method: "POST",
      }),
      fetch(
        `http://127.0.0.1:${port}/alliance/api/popularize_compositions/v2`,
        { method: "POST" },
      ),
    ]);
    return await Promise.all(
      paths.map(async (response) => ({
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      })),
    );
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill();
      await exited;
    }
  }
}

describe("P0007-R2B Platform DTO and Envelope callsites", () => {
  it("P0007-R2B-DTO-001 sends only camelCase request DTOs", async () => {
    resetApiMocks();
    mocks.requestData
      .mockResolvedValueOnce({ planId: "2071265453767405652" })
      .mockResolvedValueOnce({ compositionId: "2071266138193975100" })
      .mockResolvedValueOnce(null);
    mocks.requestPage.mockResolvedValueOnce({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });

    const fullComposition = {
      planId: "2071265453767405652",
      channelId: "z001",
      mediaType: "KOC定向" as const,
      mediaAccount: "account",
      compositionType: 0,
      compositionSubType: 11,
      compositionUrl: "https://example.com/content",
      releaseTime: "2026-08-17T10:00:00+08:00",
    };
    await alliancePlanApi.createPlan({
      taskId: "2071265453767405650",
      channelId: "z001",
      contentUrl: "https://example.com/landing",
      popularizeType: 0,
      keyword: "关键词",
    });
    await allianceCompositionApi.createComposition(fullComposition);
    await allianceCompositionApi.updateComposition(
      "2071266138193975100",
      fullComposition,
    );
    await allianceCompositionApi.listCompositions({
      channelId: "z001",
      keyword: "关键词",
      page: 1,
      pageSize: 20,
    });
    await allianceReportApi.getRealTimeData();

    expect(mocks.requestData).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "POST",
        url: "/alliance/api/popularize_plan",
        data: expect.objectContaining({
          taskId: "2071265453767405650",
          channelId: "z001",
          contentUrl: "https://example.com/landing",
          popularizeType: 0,
        }),
      }),
      createPlanRequestSchema,
      expect.anything(),
    );
    expect(mocks.requestData).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "POST",
        url: "/alliance/api/popularize_composition/v2",
        data: fullComposition,
      }),
      createCompositionRequestSchema,
      expect.anything(),
    );
    expect(mocks.requestData).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: "PUT",
        url: "/alliance/api/popularize_composition/v2/2071266138193975100",
        data: fullComposition,
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.requestPage).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/alliance/api/popularize_compositions",
        params: { channelId: "z001", keyword: "关键词", page: 1, pageSize: 20 },
      }),
      compositionListQuerySchema,
      expect.anything(),
    );
    expect(mocks.requestData).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        method: "GET",
        url: "/alliance/api/data_report/real_time_data",
        params: {
          type: 1,
          timeScale: 1,
          fields: "search_num,order_num,created_at",
        },
      }),
      realTimeQuerySchema,
      expect.anything(),
    );
    expect(JSON.stringify(mocks.requestData.mock.calls)).not.toMatch(
      /task_id|channel_id|content_url|popularize_type|plan_id|release_time/u,
    );
  });

  it("P0007-R2B-COMPOSITION-001 rejects partial update and keeps the View update gate unavailable", async () => {
    resetApiMocks();
    expect(() =>
      createCompositionRequestSchema.parse({ planId: "1" }),
    ).toThrow();

    const updateCall = vi.fn(async () => undefined);
    const item = {
      compositionId: "2071266138193975100",
      compositionUrl: "https://example.com/content",
      submitTime: "2026-08-17T10:00:00+08:00",
      compositionType: 0,
      compositionSubType: 11,
      keyword: "关键词",
    };
    if (canUpdateCompositionFromList(item)) await updateCall();
    expect(canUpdateCompositionFromList(item)).toBe(false);
    expect(updateCall).not.toHaveBeenCalled();

    const viewSource = readFileSync(
      new URL(
        "../../src/views/dashboard/ZhihuCompositionsView.vue",
        import.meta.url,
      ),
      "utf8",
    );
    expect(viewSource).toContain(
      'v-if="!canUpdateCompositionFromList(record)"',
    );
    expect(viewSource).not.toMatch(/submitUpdate\s*\(/u);
    expect(mocks.requestData).not.toHaveBeenCalled();
    expect(mocks.requestPage).not.toHaveBeenCalled();
  });

  it("P0007-R3-PLATFORM-001 submits native FormData without polling", async () => {
    resetApiMocks();
    mocks.requestData
      .mockResolvedValueOnce({ batchTaskId: "2071267000000000001" })
      .mockResolvedValueOnce({ batchTaskId: "2071267000000000002" });
    const file = fileFixture();
    expect(() =>
      batchPlanRequestSchema.parse({ file, task_id: "legacy" }),
    ).toThrow();
    expect(() =>
      batchCompositionRequestSchema.parse({
        file,
        bind_type: 1,
        channel_id: "z001",
      }),
    ).toThrow();

    const uiRequest = vi.fn(async () => undefined);
    await expect(runCompositionBatchUiAction(uiRequest)).resolves.toBe(true);
    expect(uiRequest).toHaveBeenCalledOnce();
    await expect(
      alliancePlanApi.batchCreatePlans(file, {
        taskId: "1",
        channelId: "z001",
        popularizeType: 0,
      }),
    ).resolves.toEqual({ batchTaskId: "2071267000000000001" });
    await expect(
      allianceCompositionApi.batchCreateCompositions(file, {
        bindType: 1,
        channelId: "z001",
      }),
    ).resolves.toEqual({ batchTaskId: "2071267000000000002" });
    expect(mocks.requestData).toHaveBeenCalledTimes(2);
    const planForm = mocks.requestData.mock.calls[0]?.[0]?.data as FormData;
    const compositionForm = mocks.requestData.mock.calls[1]?.[0]
      ?.data as FormData;
    expect(Array.from(planForm.keys())).toEqual([
      "taskId",
      "channelId",
      "popularizeType",
      "file",
    ]);
    expect(Array.from(compositionForm.keys())).toEqual([
      "bindType",
      "channelId",
      "file",
    ]);
    expect(planForm.get("taskId")).toBe("1");
    expect(planForm.get("popularizeType")).toBe("0");
    const planUpload = planForm.get("file");
    const compositionUpload = compositionForm.get("file");
    expect(planUpload).toBeInstanceOf(File);
    expect(compositionUpload).toBeInstanceOf(File);
    if (planUpload instanceof File && compositionUpload instanceof File) {
      expect(planUpload.name).toBe("upload.xlsx");
      expect(planUpload.type).toBe(file.type);
      expect(compositionUpload.name).toBe("upload.xlsx");
      expect(compositionUpload.type).toBe(file.type);
      await expect(planUpload.arrayBuffer()).resolves.toEqual(
        await file.arrayBuffer(),
      );
    }
    expect(mocks.requestPage).not.toHaveBeenCalled();

    resetApiMocks();
    const invalid = new File([file], "upload.xlsx.exe", { type: file.type });
    await expect(
      alliancePlanApi.batchCreatePlans(invalid, {
        taskId: "1",
        channelId: "z001",
        popularizeType: 0,
      }),
    ).rejects.toThrow();
    expect(mocks.requestData).not.toHaveBeenCalled();

    for (const candidate of [
      new File([file], "upload.xlsx", { type: "application/zip" }),
      new File([file], "bad\u0080.xlsx", { type: file.type }),
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "upload.xlsx", {
        type: file.type,
      }),
    ]) {
      expect(batchFileSchema.safeParse(candidate).success).toBe(false);
    }
    await expect(
      alliancePlanApi.batchCreatePlans(
        new File([new Uint8Array([1, 2, 3, 4])], "upload.xlsx", {
          type: file.type,
        }),
        { taskId: "1", channelId: "z001", popularizeType: 0 },
      ),
    ).rejects.toThrow();

    const forgedFields = {
      taskId: "1",
      channelId: "z001",
      popularizeType: 0 as const,
      file,
    } as unknown as Parameters<typeof alliancePlanApi.batchCreatePlans>[1];
    await expect(
      alliancePlanApi.batchCreatePlans(invalid, forgedFields),
    ).rejects.toThrow();
    expect(mocks.requestData).not.toHaveBeenCalled();

    resetApiMocks();
    let releaseRequest!: (value: { batchTaskId: string }) => void;
    mocks.requestData.mockReturnValue(
      new Promise<{ batchTaskId: string }>((resolve) => {
        releaseRequest = resolve;
      }),
    );
    setActivePinia(createPinia());
    const planStore = useZPlanStore();
    const firstUpload = planStore.submitBatchCreate(file, {
      taskId: "1",
      channelId: "z001",
      popularizeType: 0,
    });
    await Promise.resolve();
    const secondUpload = planStore.submitBatchCreate(file, {
      taskId: "1",
      channelId: "z001",
      popularizeType: 0,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(mocks.requestData).toHaveBeenCalledOnce();
    releaseRequest({ batchTaskId: "2071267000000000003" });
    await expect(firstUpload).resolves.toBe("2071267000000000003");
    await expect(secondUpload).resolves.toBeUndefined();
    expect(planStore.lastBatchTaskId).toBe("2071267000000000003");

    resetApiMocks();
    mocks.requestData.mockResolvedValue({
      batchTaskId: "2071267000000000004",
    });
    const compositionStore = useZCompositionStore();
    await expect(
      compositionStore.submitBatch(file, { bindType: 1, channelId: "z001" }),
    ).resolves.toBe("2071267000000000004");
    expect(compositionStore.lastBatchTaskId).toBe("2071267000000000004");

    const viewSource = readFileSync(
      new URL(
        "../../src/views/dashboard/ZhihuCompositionsView.vue",
        import.meta.url,
      ),
      "utf8",
    );
    expect(viewSource).toContain("提交成功不代表完成，结果下载尚未开放");
    expect(viewSource).not.toMatch(/getResult|get_batch_task_result/u);
  });

  it("P0007-R2B-CHANNEL-001 uses only the local /api/v1/channels abstraction", async () => {
    mocks.localGet.mockReset();
    mocks.legacyGet.mockReset();
    mocks.localGet.mockResolvedValueOnce({
      list: [
        {
          id: "local-row-id",
          zhihuChannelId: "z001",
          name: "本地渠道",
          generation: 1,
          ownerId: null,
          ownerName: null,
          createdAt: "2026-08-17T10:00:00+08:00",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    setActivePinia(createPinia());
    const channelStore = useZChannelStore();

    await channelStore.fetchChannels();
    expect(mocks.localGet).toHaveBeenCalledOnce();
    expect(mocks.localGet).toHaveBeenCalledWith("/channels", {
      page: 1,
      pageSize: 100,
    });
    expect(channelStore.channelOptions).toEqual([
      { label: "本地渠道", value: "z001" },
    ]);
    await expect(channelStore.fetchSecondChannels("z001")).resolves.toBe(false);
    expect(channelStore.getSecondOptions("z001")).toEqual([]);
    expect(mocks.legacyGet).not.toHaveBeenCalled();
  });

  it("P0007-R2B-PRECISION-001 preserves large IDs as strings", () => {
    expect(() =>
      createPlanRequestSchema.parse({
        taskId: 2071265453767405652,
        channelId: "z001",
        contentUrl: "https://example.com/landing",
        popularizeType: 0,
        keyword: "关键词",
      }),
    ).toThrow();
    expect(
      createCompositionRequestSchema.parse({
        planId: "90071992547409931234",
        channelId: "z001",
        mediaType: "KOC定向",
        mediaAccount: "account",
        compositionType: 0,
        compositionSubType: 11,
        compositionUrl: "https://example.com/content",
        releaseTime: "2026-08-17T10:00:00+08:00",
      }).planId,
    ).toBe("90071992547409931234");
  });

  it("P0007-R2B-METRIC-001 uses the token-free realtime query", () => {
    expect(
      realTimeQuerySchema.parse({
        type: 1,
        timeScale: 1,
        fields: "search_num,order_num,created_at",
      }),
    ).toEqual({
      type: 1,
      timeScale: 1,
      fields: "search_num,order_num,created_at",
    });
    expect(() =>
      realTimeQuerySchema.parse({
        type: 1,
        timeScale: 1,
        fields: "search_num,signature",
      }),
    ).toThrow();
  });

  it("P0007-R2B-LEGACY-001 keeps raw probe and Mock unknown paths fail closed", async () => {
    const probe = runInvalidRawProbe();
    expect(probe.status).toBe(1);
    expect(probe.output).toContain("--list-path");
    expect(probe.output).not.toMatch(
      /access_token|secret_key|signature|fetch/iu,
    );

    const [unknown, legacyChannel, planBatch, compositionBatch] =
      await requestMockPaths();
    for (const response of [unknown, legacyChannel]) {
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("requestId");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body).not.toHaveProperty("success");
      expect(response.body).not.toHaveProperty("error");
      expect(response.body).not.toHaveProperty("data");
    }
    expect(planBatch.status).toBe(200);
    expect(planBatch.body.data).toEqual({
      batchTaskId: "2071267000000000001",
    });
    expect(compositionBatch.status).toBe(200);
    expect(compositionBatch.body.data).toEqual({
      batchTaskId: "2071267000000000002",
    });
  });
});
