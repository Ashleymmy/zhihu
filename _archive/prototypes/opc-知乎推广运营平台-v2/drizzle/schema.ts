import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const userRoles = ["boss", "leader", "member"] as const;
export const campaignStatuses = ["draft", "active", "paused", "ended", "archived"] as const;
export const logStatuses = ["success", "pending", "failed"] as const;
export const withdrawalStatuses = ["processing", "paid", "rejected"] as const;
export const workspaceRecordStatuses = ["open", "done", "archived"] as const;
export const externalSubmissionStates = ["none", "submitting", "created", "uncertain", "failed"] as const;

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", userRoles).default("member").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const campaigns = mysqlTable("campaigns", {
  id: int("id").autoincrement().primaryKey(),
  keyword: varchar("keyword", { length: 160 }).notNull(),
  channel: varchar("channel", { length: 100 }).notNull(),
  dailyBudget: int("dailyBudget").notNull(),
  status: mysqlEnum("status", campaignStatuses).default("draft").notNull(),
  impressions: int("impressions").default(0).notNull(),
  clicks: int("clicks").default(0).notNull(),
  conversions: int("conversions").default(0).notNull(),
  spend: int("spend").default(0).notNull(),
  zhihuTaskId: varchar("zhihuTaskId", { length: 32 }),
  zhihuChannelId: varchar("zhihuChannelId", { length: 32 }),
  contentUrl: varchar("contentUrl", { length: 1000 }),
  externalPlanId: varchar("externalPlanId", { length: 32 }).unique(),
  externalSubmissionState: mysqlEnum("externalSubmissionState", externalSubmissionStates).default("none").notNull(),
  externalSubmittedAt: timestamp("externalSubmittedAt"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const keywordBindings = mysqlTable("keyword_bindings", {
  id: int("id").autoincrement().primaryKey(),
  keyword: varchar("keyword", { length: 160 }).notNull(),
  targetUrl: varchar("targetUrl", { length: 1000 }).notNull(),
  campaignId: int("campaignId"),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const callbackConfigs = mysqlTable("callback_configs", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId"),
  callbackUrl: varchar("callbackUrl", { length: 1000 }).notNull(),
  eventTypes: text("eventTypes").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const dailyMetrics = mysqlTable("daily_metrics", {
  id: int("id").autoincrement().primaryKey(),
  metricDate: varchar("metricDate", { length: 10 }).notNull(),
  impressions: int("impressions").default(0).notNull(),
  clicks: int("clicks").default(0).notNull(),
  conversions: int("conversions").default(0).notNull(),
  spend: int("spend").default(0).notNull(),
});

export const earningRecords = mysqlTable("earning_records", {
  id: int("id").autoincrement().primaryKey(),
  amount: int("amount").notNull(),
  source: varchar("source", { length: 160 }).notNull(),
  settledAt: timestamp("settledAt").defaultNow().notNull(),
});

export const withdrawals = mysqlTable("withdrawals", {
  id: int("id").autoincrement().primaryKey(),
  amount: int("amount").notNull(),
  status: mysqlEnum("status", withdrawalStatuses).default("processing").notNull(),
  requestedBy: int("requestedBy"),
  requestedAt: timestamp("requestedAt").defaultNow().notNull(),
});

export const workspaceRecords = mysqlTable("workspace_records", {
  id: int("id").autoincrement().primaryKey(),
  module: varchar("module", { length: 64 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  detail: text("detail"),
  status: mysqlEnum("status", workspaceRecordStatuses).default("open").notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const activityLogs = mysqlTable("activity_logs", {
  id: int("id").autoincrement().primaryKey(),
  type: varchar("type", { length: 64 }).notNull(),
  status: mysqlEnum("status", logStatuses).default("pending").notNull(),
  message: varchar("message", { length: 255 }).notNull(),
  context: varchar("context", { length: 160 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const zhihuBatchTasks = mysqlTable("zhihu_batch_tasks", {
  id: int("id").autoincrement().primaryKey(),
  requestHash: varchar("requestHash", { length: 64 }).notNull().unique(),
  zhihuTaskId: varchar("zhihuTaskId", { length: 32 }).notNull(),
  zhihuChannelId: varchar("zhihuChannelId", { length: 32 }).notNull(),
  itemCount: int("itemCount").notNull(),
  externalBatchTaskId: varchar("externalBatchTaskId", { length: 32 }).unique(),
  externalSubmissionState: mysqlEnum("externalSubmissionState", externalSubmissionStates).default("none").notNull(),
  resultSummary: text("resultSummary"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type UserRole = (typeof userRoles)[number];
