import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(),
  getMetricsRange: vi.fn(),
  getOverviewData: vi.fn(),
  getUserByOpenId: vi.fn(),
}));
vi.mock("./zhihuOpenApi", () => ({ getZhihuOpenApiClient: vi.fn() }));

import { getDb } from "./db";
import { appRouter } from "./routers";
import { getZhihuOpenApiClient } from "./zhihuOpenApi";
import type { TrpcContext } from "./_core/context";

const mockedGetDb = vi.mocked(getDb);
const mockedGetZhihuOpenApiClient = vi.mocked(getZhihuOpenApiClient);

function context(role: "boss" | "leader" | "member"): TrpcContext {
  return {
    user: { id: 42, openId: `test-${role}`, name: "测试运营者", email: "operator@example.com", loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createDatabaseMock() {
  const values = vi.fn().mockResolvedValue([{ insertId: 9 }]);
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  return {
    insert: vi.fn(() => ({ values })),
    update: vi.fn(() => ({ set })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ orderBy: vi.fn().mockResolvedValue([]) })) })),
  };
}

describe("运营工作流权限", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("允许 leader 创建推广计划并记录运营日志", async () => {
    const db = createDatabaseMock();
    mockedGetDb.mockResolvedValue(db as never);
    const caller = appRouter.createCaller(context("leader"));
    await expect(caller.campaigns.create({ keyword: "效率工具", channel: "知乎信息流", dailyBudget: 10000, status: "draft" })).resolves.toEqual({ id: 9 });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("拒绝 member 创建或更新推广计划", async () => {
    const member = appRouter.createCaller(context("member"));
    await expect(member.campaigns.create({ keyword: "效率工具", channel: "知乎信息流", dailyBudget: 10000, status: "draft" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(member.campaigns.updateStatus({ id: 9, status: "paused" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("允许 leader 批量创建计划，并拒绝 member 批量操作", async () => {
    const db = createDatabaseMock();
    mockedGetDb.mockResolvedValue(db as never);
    const leader = appRouter.createCaller(context("leader"));
    const member = appRouter.createCaller(context("member"));
    const items = [{ keyword: "效率工具", channel: "知乎信息流", dailyBudget: 10000, status: "draft" as const }, { keyword: "内容增长", channel: "知乎搜索", dailyBudget: 20000, status: "active" as const }];
    await expect(leader.campaigns.batchCreate({ items })).resolves.toEqual({ count: 2 });
    await expect(member.campaigns.batchCreate({ items })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("允许 leader 更新推广计划状态并保留活动日志", async () => {
    const db = createDatabaseMock();
    mockedGetDb.mockResolvedValue(db as never);
    const caller = appRouter.createCaller(context("leader"));
    await expect(caller.campaigns.updateStatus({ id: 9, status: "active" })).resolves.toEqual({ success: true });
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("允许 leader 安全归档计划并拒绝 member 归档", async () => {
    const db = createDatabaseMock();
    mockedGetDb.mockResolvedValue(db as never);
    const leader = appRouter.createCaller(context("leader"));
    const member = appRouter.createCaller(context("member"));
    await expect(leader.campaigns.archive({ id: 9 })).resolves.toEqual({ success: true });
    await expect(member.campaigns.archive({ id: 9 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("拒绝 member 读取或启停词条绑定与回传配置", async () => {
    const caller = appRouter.createCaller(context("member"));
    await expect(caller.keywords.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.callbacks.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.keywords.setActive({ id: 9, isActive: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.callbacks.setActive({ id: 9, isActive: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("允许 leader 绑定、启停词条并校验 URL", async () => {
    const db = createDatabaseMock();
    mockedGetDb.mockResolvedValue(db as never);
    const leader = appRouter.createCaller(context("leader"));
    const input = { keyword: "效率工具", targetUrl: "https://www.zhihu.com/question/1", eventType: "register" as const };
    await expect(leader.keywords.bind(input)).resolves.toEqual({ success: true });
    await expect(leader.keywords.setActive({ id: 9, isActive: false })).resolves.toEqual({ success: true });
    await expect(leader.keywords.bind({ ...input, targetUrl: "not-a-url" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("允许 boss 完整编辑回传端点并关联本地计划", async () => {
    const db = createDatabaseMock();
    mockedGetDb.mockResolvedValue(db as never);
    const caller = appRouter.createCaller(context("boss"));
    await expect(caller.callbacks.save({ id: 9, campaignId: 7, callbackUrl: "https://example.com/callback", eventTypes: ["register", "purchase"] })).resolves.toEqual({ success: true });
    await expect(caller.callbacks.setActive({ id: 9, isActive: false })).resolves.toEqual({ success: true });
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("允许 member 创建自己的工作记录并写入活动日志", async () => {
    const db = createDatabaseMock();
    mockedGetDb.mockResolvedValue(db as never);
    const caller = appRouter.createCaller(context("member"));
    await expect(caller.workspace.create({ module: "/workspace/creative", title: "记录创意方向", detail: "验证新的内容切入角度" })).resolves.toEqual({ id: 9 });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("仅允许在可结算余额内提交提现申请", async () => {
    const db = createDatabaseMock();
    mockedGetDb.mockResolvedValue(db as never);
    const caller = appRouter.createCaller(context("member"));

    db.select
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([{ total: 10000 }]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([{ total: 2000 }]) });
    await expect(caller.withdrawals.request({ amount: 8000 })).resolves.toEqual({ success: true });

    db.select
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([{ total: 10000 }]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([{ total: 2000 }]) });
    await expect(caller.withdrawals.request({ amount: 8001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("允许 leader 创建知乎计划、回写外部 plan_id 并拒绝重复提交", async () => {
    const db = createDatabaseMock();
    const createPromotionPlan = vi.fn().mockResolvedValue({ plan_id: "zhihu-plan-1" });
    mockedGetDb.mockResolvedValue(db as never);
    mockedGetZhihuOpenApiClient.mockReturnValue({ createPromotionPlan } as never);
    const leader = appRouter.createCaller(context("leader"));
    const input = { taskId: "task-1", channelId: "channel-1", contentUrl: "https://www.zhihu.com/xen/market/remix/paid_column/1", keyword: "验证词" };

    db.select.mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })) });
    await expect(leader.campaigns.createZhihu(input)).resolves.toEqual({ id: 9, externalPlanId: "zhihu-plan-1", reused: false });
    expect(createPromotionPlan).toHaveBeenCalledWith(input);
    expect(db.update).toHaveBeenCalledTimes(1);

    const existing = { id: 9, externalSubmissionState: "created", externalPlanId: "zhihu-plan-1" };
    db.select.mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([existing]) })) })) });
    await expect(leader.campaigns.createZhihu(input)).resolves.toEqual({ id: 9, externalPlanId: "zhihu-plan-1", reused: true });
    expect(createPromotionPlan).toHaveBeenCalledTimes(1);
  });

  it("拒绝 member 创建知乎真实推广计划", async () => {
    const member = appRouter.createCaller(context("member"));
    await expect(member.campaigns.createZhihu({ taskId: "task-1", channelId: "channel-1", contentUrl: "https://www.zhihu.com/xen/market/remix/paid_column/1", keyword: "验证词" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("在调用知乎前拒绝包含英文或空格的推广词", async () => {
    const db = createDatabaseMock();
    mockedGetDb.mockResolvedValue(db as never);
    const leader = appRouter.createCaller(context("leader"));
    await expect(leader.campaigns.createZhihu({ taskId: "task-1", channelId: "channel-1", contentUrl: "https://www.zhihu.com/xen/market/remix/paid_column/1", keyword: "OPC 集成验证" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("在知乎网络超时时保留待核验锁而非自动重试", async () => {
    const db = createDatabaseMock();
    const createPromotionPlan = vi.fn().mockRejectedValue(new Error("知乎开放平台连接超时，请稍后重试"));
    mockedGetDb.mockResolvedValue(db as never);
    mockedGetZhihuOpenApiClient.mockReturnValue({ createPromotionPlan } as never);
    const leader = appRouter.createCaller(context("leader"));
    db.select.mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })) });

    await expect(leader.campaigns.createZhihu({ taskId: "task-1", channelId: "channel-1", contentUrl: "https://www.zhihu.com/xen/market/remix/paid_column/1", keyword: "验证词" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("已锁定") });
    expect(createPromotionPlan).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("允许 leader 提交批量知乎计划并保存 batch_task_id", async () => {
    const db = createDatabaseMock();
    const createPromotionPlansBatch = vi.fn().mockResolvedValue({ batch_task_id: "batch-1" });
    mockedGetDb.mockResolvedValue(db as never);
    mockedGetZhihuOpenApiClient.mockReturnValue({ createPromotionPlansBatch } as never);
    const leader = appRouter.createCaller(context("leader"));
    const input = { taskId: "task-1", channelId: "channel-1", items: [{ contentUrl: "https://www.zhihu.com/market/paid_column/1/section/2", keyword: "验证词" }] };
    db.select.mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })) });

    await expect(leader.campaigns.createZhihuBatch(input)).resolves.toEqual({ id: 9, batchTaskId: "batch-1", reused: false });
    expect(createPromotionPlansBatch).toHaveBeenCalledWith(input);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("仅在 leader 显式确认风险后重试待核验的知乎计划", async () => {
    const db = createDatabaseMock();
    const createPromotionPlan = vi.fn().mockResolvedValue({ plan_id: "zhihu-plan-retry" });
    mockedGetDb.mockResolvedValue(db as never);
    mockedGetZhihuOpenApiClient.mockReturnValue({ createPromotionPlan } as never);
    const leader = appRouter.createCaller(context("leader"));
    const input = { taskId: "task-1", channelId: "channel-1", contentUrl: "https://www.zhihu.com/xen/market/remix/paid_column/1", keyword: "验证词" };
    const uncertain = { id: 9, externalSubmissionState: "uncertain", externalPlanId: null };

    db.select.mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([uncertain]) })) })) });
    await expect(leader.campaigns.createZhihu(input)).rejects.toMatchObject({ code: "CONFLICT" });

    db.select.mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([uncertain]) })) })) });
    await expect(leader.campaigns.createZhihu({ ...input, retryUncertain: true })).resolves.toEqual({ id: 9, externalPlanId: "zhihu-plan-retry", reused: false });
    expect(createPromotionPlan).toHaveBeenCalledWith(input);
  });
});
