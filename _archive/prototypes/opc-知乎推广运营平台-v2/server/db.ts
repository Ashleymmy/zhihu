import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  activityLogs,
  callbackConfigs,
  campaigns,
  dailyMetrics,
  earningRecords,
  keywordBindings,
  type InsertUser,
  users,
  withdrawals,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let database: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!database && process.env.DATABASE_URL) {
    database = drizzle(process.env.DATABASE_URL);
  }
  return database;
}

export async function upsertUser(user: Omit<InsertUser, "role"> & { role?: string }): Promise<void> {
  const db = await getDb();
  if (!db || !user.openId) return;
  const requestedRole = user.role === "boss" || user.role === "leader" || user.role === "member" ? user.role : "member";
  const role = user.openId === ENV.ownerOpenId ? "boss" : requestedRole;
  await db.insert(users).values({ ...user, role, lastSignedIn: new Date() }).onDuplicateKeyUpdate({
    set: {
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      lastSignedIn: new Date(),
      role,
    },
  });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getOverviewData() {
  const db = await getDb();
  if (!db) return { campaigns: [], logs: [], totals: { impressions: 0, clicks: 0, conversions: 0, spend: 0 } };
  const [campaignList, logs, totals] = await Promise.all([
    db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(6),
    db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(6),
    db.select({
      impressions: sql<number>`coalesce(sum(${campaigns.impressions}), 0)`,
      clicks: sql<number>`coalesce(sum(${campaigns.clicks}), 0)`,
      conversions: sql<number>`coalesce(sum(${campaigns.conversions}), 0)`,
      spend: sql<number>`coalesce(sum(${campaigns.spend}), 0)`,
    }).from(campaigns),
  ]);
  return { campaigns: campaignList, logs, totals: totals[0] ?? { impressions: 0, clicks: 0, conversions: 0, spend: 0 } };
}

export async function getMetricsRange(start: string, end: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dailyMetrics).where(and(gte(dailyMetrics.metricDate, start), lte(dailyMetrics.metricDate, end))).orderBy(dailyMetrics.metricDate);
}

export const operations = {
  campaigns,
  keywordBindings,
  callbackConfigs,
  earningRecords,
  withdrawals,
  activityLogs,
};
