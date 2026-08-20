import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { activityLogs, callbackConfigs, campaigns, earningRecords, keywordBindings, withdrawals, workspaceRecords, zhihuBatchTasks, type UserRole } from "../drizzle/schema";
import { getDb, getMetricsRange, getOverviewData, getUserByOpenId } from "./db";
import { bossProcedure, leaderProcedure, permissions } from "./access";
import { getZhihuOpenApiClient } from "./zhihuOpenApi";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { COOKIE_NAME } from "../shared/const";

const campaignStatus = z.enum(["draft", "active", "paused", "ended", "archived"]);
const campaignInput = z.object({ keyword: z.string().min(1).max(160), channel: z.string().min(1).max(100), dailyBudget: z.number().int().positive(), status: campaignStatus.default("draft") });
const zhihuKeyword = z.string().min(1).max(160).regex(/^[\u4e00-\u9fff0-9]+$/, "知乎推广词仅支持中文或数字，不能包含空格、英文或标点");
const eventTypes = z.array(z.enum(["activate", "register", "purchase", "submit"])).min(1);
const workspaceInput = z.object({ module: z.string().min(1).max(64), title: z.string().min(1).max(180), detail: z.string().max(2000).optional() });
const zhihuBatchItems = z.array(z.object({ contentUrl: z.string().url().max(1000), keyword: zhihuKeyword })).min(1).max(50);

function buildEmptyTrend(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const finish = new Date(`${end}T00:00:00Z`);
  while (cursor <= finish && dates.length < 31) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates.map(metricDate => ({ metricDate, impressions: 0, clicks: 0, conversions: 0, spend: 0 }));
}

async function appendActivity(type: string, message: string, context?: string, status: "success" | "pending" | "failed" = "success") {
  const db = await getDb();
  if (db) await db.insert(activityLogs).values({ type, status, message, context });
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    profile: protectedProcedure.query(async ({ ctx }) => {
      const user = await getUserByOpenId(ctx.user.openId);
      const role = (user?.role ?? "member") as UserRole;
      return { ...ctx.user, role, permissions: permissions[role] };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  overview: protectedProcedure.query(async () => getOverviewData()),
  analytics: protectedProcedure.input(z.object({ start: z.string(), end: z.string() })).query(async ({ input }) => {
    const rows = await getMetricsRange(input.start, input.end);
    return rows.length ? rows : buildEmptyTrend(input.start, input.end);
  }),
  activity: protectedProcedure.query(async () => {
    const db = await getDb();
    return db ? db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(50) : [];
  }),
  zhihu: router({
    channels: protectedProcedure.query(async () => getZhihuOpenApiClient().getAgentChannels()),
    promotionTasks: protectedProcedure.input(z.object({ channelId: z.string().min(1), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20) })).query(async ({ input }) => {
      return getZhihuOpenApiClient().getPromotionTasks(input.channelId, input.offset, input.limit);
    }),
    realtimeKeywordMetrics: protectedProcedure.query(async () => getZhihuOpenApiClient().getRealtimeKeywordMetrics()),
  }),
  campaigns: router({
    list: protectedProcedure.query(async () => {
      const db = await getDb();
      return db ? db.select().from(campaigns).orderBy(desc(campaigns.createdAt)) : [];
    }),
    create: leaderProcedure.input(campaignInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      const created = await db.insert(campaigns).values({ ...input, createdBy: ctx.user.id });
      await appendActivity("campaign", "已创建推广计划", input.keyword);
      return { id: created[0].insertId };
    }),
    batchCreate: leaderProcedure.input(z.object({ items: z.array(campaignInput).min(1).max(50) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      await db.insert(campaigns).values(input.items.map(item => ({ ...item, createdBy: ctx.user.id })));
      await appendActivity("campaign", `已批量创建 ${input.items.length} 个推广计划`, "批量创建");
      return { count: input.items.length };
    }),
    createZhihu: leaderProcedure.input(z.object({
      taskId: z.string().min(1).max(32),
      channelId: z.string().min(1).max(32),
      contentUrl: z.string().url().max(1000),
      keyword: zhihuKeyword,
      retryUncertain: z.boolean().default(false),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      const { retryUncertain, ...externalInput } = input;

      const existing = await db.select().from(campaigns).where(and(
        eq(campaigns.zhihuTaskId, input.taskId),
        eq(campaigns.zhihuChannelId, input.channelId),
        eq(campaigns.contentUrl, input.contentUrl),
        eq(campaigns.keyword, input.keyword),
      )).limit(1);
      let localId: number;
      if (existing[0]) {
        const campaign = existing[0];
        if (campaign.externalSubmissionState === "created") return { id: campaign.id, externalPlanId: campaign.externalPlanId, reused: true };
        if (campaign.externalSubmissionState !== "uncertain" || !retryUncertain) throw new TRPCError({ code: "CONFLICT", message: "该内容已有待核验或失败的提交记录；为避免重复创建，系统不会自动重试。" });
        localId = campaign.id;
        await db.update(campaigns).set({ externalSubmissionState: "submitting" }).where(eq(campaigns.id, localId));
        await appendActivity("zhihu_campaign", "经负责人确认后重新提交知乎计划", input.keyword, "pending");
      } else {
        const created = await db.insert(campaigns).values({
          keyword: input.keyword,
          channel: `知乎 · ${input.channelId}`,
          dailyBudget: 0,
          status: "draft",
          zhihuTaskId: input.taskId,
          zhihuChannelId: input.channelId,
          contentUrl: input.contentUrl,
          externalSubmissionState: "submitting",
          createdBy: ctx.user.id,
        });
        localId = Number(created[0].insertId);
      }

      try {
        const result = await getZhihuOpenApiClient().createPromotionPlan(externalInput);
        await db.update(campaigns).set({ externalPlanId: result.plan_id, externalSubmissionState: "created", externalSubmittedAt: new Date() }).where(eq(campaigns.id, localId));
        await appendActivity("zhihu_campaign", "已在知乎创建推广计划", result.plan_id);
        return { id: localId, externalPlanId: result.plan_id, reused: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : "知乎推广计划创建失败";
        const timedOut = /timeout|超时|网络连接|network/i.test(message);
        await db.update(campaigns).set({ externalSubmissionState: timedOut ? "uncertain" : "failed" }).where(eq(campaigns.id, localId));
        await appendActivity("zhihu_campaign", timedOut ? "知乎创建请求超时，等待人工核验" : "知乎推广计划创建失败", input.keyword, timedOut ? "pending" : "failed");
        throw new TRPCError({ code: "BAD_REQUEST", message: timedOut ? "知乎创建请求超时，可能已被受理；系统已锁定该提交，核验前不会重试。" : message });
      }
    }),
    listZhihuBatches: leaderProcedure.query(async () => {
      const db = await getDb();
      return db ? db.select().from(zhihuBatchTasks).orderBy(desc(zhihuBatchTasks.createdAt)).limit(20) : [];
    }),
    createZhihuBatch: leaderProcedure.input(z.object({ taskId: z.string().min(1).max(32), channelId: z.string().min(1).max(32), items: zhihuBatchItems })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      const normalizedItems = [...input.items].sort((left, right) => `${left.keyword}|${left.contentUrl}`.localeCompare(`${right.keyword}|${right.contentUrl}`));
      const requestHash = createHash("sha256").update(JSON.stringify({ taskId: input.taskId, channelId: input.channelId, items: normalizedItems }), "utf8").digest("hex");
      const existing = await db.select().from(zhihuBatchTasks).where(eq(zhihuBatchTasks.requestHash, requestHash)).limit(1);
      if (existing[0]) {
        const batch = existing[0];
        if (batch.externalSubmissionState === "created") return { id: batch.id, batchTaskId: batch.externalBatchTaskId, reused: true };
        throw new TRPCError({ code: "CONFLICT", message: "相同批量文件已有待处理或失败记录；为避免重复创建，系统不会自动重试。" });
      }
      const created = await db.insert(zhihuBatchTasks).values({ requestHash, zhihuTaskId: input.taskId, zhihuChannelId: input.channelId, itemCount: input.items.length, externalSubmissionState: "submitting", createdBy: ctx.user.id });
      const localId = Number(created[0].insertId);
      try {
        const result = await getZhihuOpenApiClient().createPromotionPlansBatch({ taskId: input.taskId, channelId: input.channelId, items: input.items });
        await db.update(zhihuBatchTasks).set({ externalBatchTaskId: result.batch_task_id, externalSubmissionState: "created" }).where(eq(zhihuBatchTasks.id, localId));
        await appendActivity("zhihu_batch", "已创建知乎批量推广任务", result.batch_task_id);
        return { id: localId, batchTaskId: result.batch_task_id, reused: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : "知乎批量任务创建失败";
        const uncertain = /timeout|超时|网络连接|network/i.test(message);
        await db.update(zhihuBatchTasks).set({ externalSubmissionState: uncertain ? "uncertain" : "failed" }).where(eq(zhihuBatchTasks.id, localId));
        await appendActivity("zhihu_batch", uncertain ? "知乎批量任务连接失败，等待人工核验" : "知乎批量任务创建失败", `${input.items.length} 条`, uncertain ? "pending" : "failed");
        throw new TRPCError({ code: "BAD_REQUEST", message: uncertain ? "知乎批量任务连接超时或失败，系统已锁定本次文件，核验前不会重试。" : message });
      }
    }),
    getZhihuBatchResult: leaderProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      const batch = await db.select().from(zhihuBatchTasks).where(eq(zhihuBatchTasks.id, input.id)).limit(1);
      if (!batch[0]?.externalBatchTaskId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "该批量任务尚未取得 batch_task_id" });
      const result = await getZhihuOpenApiClient().getBatchTaskResult(batch[0].externalBatchTaskId);
      await db.update(zhihuBatchTasks).set({ resultSummary: JSON.stringify(result.rows) }).where(eq(zhihuBatchTasks.id, batch[0].id));
      await appendActivity("zhihu_batch", "已回查知乎批量任务结果", batch[0].externalBatchTaskId);
      return result;
    }),
    updateStatus: leaderProcedure.input(z.object({ id: z.number().int().positive(), status: campaignStatus })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      await db.update(campaigns).set({ status: input.status }).where(eq(campaigns.id, input.id));
      await appendActivity("campaign", "已更新推广计划状态", input.status);
      return { success: true };
    }),
    archive: leaderProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      await db.update(campaigns).set({ status: "archived" }).where(eq(campaigns.id, input.id));
      await appendActivity("campaign", "已归档无效或重复推广计划", String(input.id));
      return { success: true };
    }),
  }),
  keywords: router({
    list: leaderProcedure.query(async () => {
      const db = await getDb();
      return db ? db.select().from(keywordBindings).orderBy(desc(keywordBindings.createdAt)) : [];
    }),
    bind: leaderProcedure.input(z.object({ keyword: z.string().min(1), targetUrl: z.string().url(), campaignId: z.number().int().optional(), eventType: z.enum(["activate", "register", "purchase", "submit"]) })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      await db.insert(keywordBindings).values(input);
      await appendActivity("keyword", "已绑定推广词条", input.keyword);
      return { success: true };
    }),
    setActive: leaderProcedure.input(z.object({ id: z.number().int().positive(), isActive: z.boolean() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      await db.update(keywordBindings).set({ isActive: input.isActive }).where(eq(keywordBindings.id, input.id));
      await appendActivity("keyword", input.isActive ? "已启用推广词条" : "已停用推广词条", String(input.id));
      return { success: true };
    }),
  }),
  callbacks: router({
    list: leaderProcedure.query(async () => {
      const db = await getDb();
      return db ? db.select().from(callbackConfigs).orderBy(desc(callbackConfigs.updatedAt)) : [];
    }),
    save: leaderProcedure.input(z.object({ id: z.number().int().optional(), campaignId: z.number().int().positive().optional(), callbackUrl: z.string().url(), eventTypes })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      const values = { campaignId: input.campaignId ?? null, callbackUrl: input.callbackUrl, eventTypes: JSON.stringify(input.eventTypes), updatedBy: ctx.user.id };
      if (input.id) await db.update(callbackConfigs).set(values).where(eq(callbackConfigs.id, input.id));
      else await db.insert(callbackConfigs).values(values);
      await appendActivity("callback", "已更新回传配置", input.callbackUrl);
      return { success: true };
    }),
    setActive: leaderProcedure.input(z.object({ id: z.number().int().positive(), isActive: z.boolean() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      await db.update(callbackConfigs).set({ isActive: input.isActive }).where(eq(callbackConfigs.id, input.id));
      await appendActivity("callback", input.isActive ? "已启用回传端点" : "已停用回传端点", String(input.id));
      return { success: true };
    }),
  }),
  earnings: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, records: [], withdrawals: [] };
    const [records, withdrawalList, totals] = await Promise.all([
      db.select().from(earningRecords).orderBy(desc(earningRecords.settledAt)).limit(20),
      db.select().from(withdrawals).orderBy(desc(withdrawals.requestedAt)).limit(20),
      db.select({ total: sql<number>`coalesce(sum(${earningRecords.amount}), 0)` }).from(earningRecords),
    ]);
    return { total: totals[0]?.total ?? 0, records, withdrawals: withdrawalList };
  }),
  withdrawals: router({
    request: protectedProcedure.input(z.object({ amount: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      const [settled, reserved] = await Promise.all([
        db.select({ total: sql<number>`coalesce(sum(${earningRecords.amount}), 0)` }).from(earningRecords),
        db.select({ total: sql<number>`coalesce(sum(${withdrawals.amount}), 0)` }).from(withdrawals),
      ]);
      const available = Number(settled[0]?.total ?? 0) - Number(reserved[0]?.total ?? 0);
      if (input.amount > available) throw new TRPCError({ code: "BAD_REQUEST", message: "申请金额超过当前可结算余额" });
      await db.insert(withdrawals).values({ amount: input.amount, requestedBy: ctx.user.id, status: "processing" });
      await appendActivity("earnings", "已提交提现申请", String(input.amount));
      return { success: true };
    }),
  }),
  workspace: router({
    list: protectedProcedure.input(z.object({ module: z.string().min(1).max(64) })).query(async ({ input }) => {
      const db = await getDb();
      return db ? db.select().from(workspaceRecords).where(eq(workspaceRecords.module, input.module)).orderBy(desc(workspaceRecords.createdAt)).limit(50) : [];
    }),
    create: protectedProcedure.input(workspaceInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库暂不可用" });
      const created = await db.insert(workspaceRecords).values({ ...input, createdBy: ctx.user.id });
      await appendActivity("workspace", "已创建工作记录", input.title);
      return { id: created[0].insertId };
    }),
  }),
  roles: router({
    list: bossProcedure.query(async () => {
      const db = await getDb();
      return db ? db.select({ id: campaigns.id }).from(campaigns).limit(0) : [];
    }),
  }),
});

export type AppRouter = typeof appRouter;
