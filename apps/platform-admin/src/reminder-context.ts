import type { EvidenceQuery } from "@zhihu-koc/shared-contracts/core";
export type EvidenceReminderContext = Required<
  Pick<
    EvidenceQuery,
    | "moduleId"
    | "projectId"
    | "accountId"
    | "channelRef"
    | "taskRef"
    | "metricType"
  >
> & { businessDate: string };
export function evidenceReminderContext(
  query: Record<string, unknown>,
): EvidenceReminderContext | null {
  if (query.reminderContext !== "evidence") return null;
  const keys = [
    "moduleId",
    "projectId",
    "accountId",
    "channelRef",
    "taskRef",
    "businessDate",
    "metricType",
  ] as const;
  if (keys.some((key) => typeof query[key] !== "string")) return null;
  const value = Object.fromEntries(
    keys.map((key) => [key, query[key]]),
  ) as EvidenceReminderContext;
  if (
    !/^[a-z][a-z0-9_-]{0,31}$/.test(value.moduleId) ||
    !/^[a-z][a-z0-9_]{0,31}$/.test(value.metricType)
  )
    return null;
  if (
    ["projectId", "accountId", "channelRef", "taskRef"].some(
      (key) => !/^[1-9]\d*$/.test(value[key as keyof EvidenceReminderContext]),
    )
  )
    return null;
  const date = Date.parse(value.businessDate);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value.businessDate) ||
    !Number.isFinite(date) ||
    new Date(date).toISOString().slice(0, 10) !== value.businessDate
  )
    return null;
  return value;
}
