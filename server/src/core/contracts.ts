import type { Express, Router } from 'express';
import type { AuthUser, Role } from '../types';
import type { PoolConnection } from 'mysql2/promise';

export const MODULE_CONTRACT_VERSION = 2;
export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  contractVersion: number;
  roles: Role[];
  capabilities: string[];
  permissions: Partial<Record<Role, string[]>>;
  entryPath: string;
  financeHistoryPath?: string;
  accountCreation?: 'managed' | 'self_service';
  accountMessage?: string;
}
export interface DataScope {
  projectId: string;
  accountId: string;
  from: string;
  to: string;
}
export interface MetricSummary {
  key: string;
  label: string;
  unit: string;
  value: string | null;
}
export interface ModuleSummary {
  moduleId: string;
  accountId: string;
  projectId: string;
  from: string;
  to: string;
  updatedAt: string;
  status: 'ready' | 'empty' | 'unavailable';
  metrics: MetricSummary[];
}
export interface ModuleDataProvider {
  summary(scope: DataScope, user: AuthUser): Promise<ModuleSummary>;
}
export interface FinanceProvider {
  capabilities: { income: boolean; settlements: boolean; withdrawals: boolean };
  // Business providers expose summaries; the shared finance ledger handles fund operations.
  summary(scope: DataScope, user: AuthUser): Promise<{ currency: string; amount: string | null }>;
}
export interface BusinessModule {
  manifest: ModuleManifest;
  router: Router;
  beforeJson?: (app: Express) => void;
  mountLegacy?: (app: Express) => void;
  start?: () => void;
  stop?: () => void;
  // Close module-owned connections only after HTTP requests and queued jobs drain.
  dispose?: () => Promise<void>;
  dataProvider?: ModuleDataProvider;
  financeProvider?: FinanceProvider;
  accountLifecycle?: ModuleAccountLifecycle;
  rateProvider?: ModuleRateProvider;
  todoProvider?: ModuleTodoProvider;
  taskProvider?: ModuleTaskProvider;
}

export interface TaskScope { projectId: string; accountId: string }
export interface TaskFilter { page: number; pageSize: number; search: string; view: 'all' | 'available' | 'owned' }
export interface TaskAction {
  key: string; label: string; path?: string; confirm?: string;
  fields?: { key: string; label: string; type: 'text' | 'url' | 'select' | 'textarea'; required?: boolean; value?: string; options?: { value: string; label: string }[] }[];
}
export interface TaskItem {
  id: string; title: string; subtitle?: string;
  status: { key: string; label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'leader' };
  executor: string; leader?: string; next: { actor: string; text: string; action?: TaskAction };
  metrics: { label: string; value: string }[];
}
export interface TaskDetail extends TaskItem {
  fields: { label: string; value: string; url?: string }[];
  progress: { label: string; status: 'done' | 'current' | 'waiting'; actor: string; description?: string }[];
  actions: TaskAction[];
}
export interface ModuleTaskProvider {
  list(scope: TaskScope, user: AuthUser, filter: TaskFilter): Promise<{ list: TaskItem[]; total: number; create?: { label: string; path: string } }>;
  detail(scope: TaskScope, user: AuthUser, id: string): Promise<TaskDetail>;
  execute(scope: TaskScope, user: AuthUser, id: string, action: string, input: Record<string, unknown>, requestKey: string): Promise<{ message: string }>;
}

export interface TodoItem {
  kind: string;
  count: number;
  label: string;
  actor: string;
  actionLabel: string;
  path: string;
}
export interface DashboardMetric extends MetricSummary { path: string }
export interface ModuleTodoProvider {
  overview(scope: DataScope, user: AuthUser): Promise<{ todos: TodoItem[]; metrics: DashboardMetric[] }>;
}

export interface RateMetricDefinition {
  code: string;
  label: string;
  unit: string;
  rules: { code: string; label: string; editable: boolean }[];
  note?: string;
}
export interface RatePublication {
  projectId: string;
  metricType: string;
  effectiveFrom: string;
  prices: Record<string, string>;
}
export interface ModuleRateProvider {
  metrics: RateMetricDefinition[];
  // Acquire business locks before reading/writing rates; every callback shares
  // the publication transaction so a failed recalculation rolls back its rates.
  lock(connection: PoolConnection, user: AuthUser, projectId: string): Promise<void>;
  prepare(connection: PoolConnection, input: RatePublication): Promise<Record<string, string>>;
  published(connection: PoolConnection, user: AuthUser, input: RatePublication): Promise<{ recalculated: number }>;
}

export interface ModuleAccountLifecycle {
  accessChangeBlockers?(connection: PoolConnection, userId: string, projectId?: string): Promise<string[]>;
  closureBlockers(connection: PoolConnection, userId: string): Promise<string[]>;
  // Runs inside the same transaction as platform identity erasure. Business and
  // financial evidence must remain intact; only personal profile fields change.
  erasePersonalData(connection: PoolConnection, userId: string): Promise<void>;
}
