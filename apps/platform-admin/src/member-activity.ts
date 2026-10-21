export type ActivityCounts = {
  tasks: number;
  currentTasks: number;
  verifiedTasks: number;
  works: number;
};
export type ActivityKind = "tasks" | "works";
export type ActivityStatus = "all" | "current" | "verified" | "released";
export type ActivitySummary = {
  totals: Record<string, ActivityCounts>;
  modules: {
    moduleId: string;
    name: string;
    counts: Record<string, ActivityCounts>;
  }[];
  unsupported: string[];
};
export type ActivityRecord = {
  id: string;
  projectId: string;
  accountId: string;
  projectName: string;
  taskRef: string;
  title: string;
  keyword: string;
  at: string;
  status: string;
  tone: string;
  url?: string;
  fields: { label: string; value: string; url?: string }[];
};
