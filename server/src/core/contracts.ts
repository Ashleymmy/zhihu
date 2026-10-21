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
  activity?(scope: DataScope, user: AuthUser, filter: ActivityFilter): Promise<ActivityResult>;
  // Aggregate upstream amounts only; never expose individual members' income.
  teamTurnover?(connection: PoolConnection, scope: DataScope, user: AuthUser): Promise<TeamTurnover>;
  workRegistrations?(scope: TaskScope, user: AuthUser, filter: WorkRegistrationFilter, includeRows: boolean): Promise<WorkRegistrationReport>;
  keywordBindings?(scope: TaskScope, user: AuthUser, filter: KeywordBindingFilter): Promise<KeywordBindingRow[]>;
}
export interface KeywordBindingFilter { from?: string; to?: string; search?: string }
export interface KeywordBindingRow {
  id: string; bindingId: string; boundAt: string; createdAt: string; dateBasis: string;
  taskName: string; channelName: string; keyword: string; novelTitle: string; novelUrl: string;
  creatorAccount: string; creatorName: string; creatorId: string; creatorLeaderName: string;
  performerAccount: string; performerName: string; performerId: string;
  leaderName: string; leaderAccount: string; leaderId: string; relationNote: string;
  creationStatus: string; failureReason: string; bindingStatus: string;
}
export interface WorkRegistrationFilter {
  from?: string; to?: string; search?: string; ownerId?: string; planId?: string;
  view?: 'self' | 'team' | 'all'; result?: 'submitted' | 'failed' | 'pending';
  successfulOnly: boolean; registeredOnly?: boolean;
}
export interface WorkRegistrationRow {
  id: string; registeredAt: string; title: string; keyword: string; taskName: string;
  performerName: string; mediaType: string; mediaAccount: string; workUrl: string;
  publishedAt: string; registrationStatus: string; reviewStatus: string;
  planName: string; category: string; subcategory: string; novelTitle: string; novelUrl: string;
  performerAccount: string; performerId: string; leaderName: string; leaderAccount: string; leaderId: string;
  relationNote: string; failureReason: string;
}
export interface WorkRegistrationReport {
  total: number;
  daily: { date: string; count: number }[];
  rows: WorkRegistrationRow[];
}
export interface AmountPeriods { total: string; today: string; yesterday: string }
export interface TeamTurnover extends AmountPeriods {
  missing: { total: number; today: number; yesterday: number };
  records: { total: number; today: number; yesterday: number };
}
export interface ActivityFilter {
  view: 'self' | 'team' | 'all';
  ownerId?: string;
  metricType?: string;
  page: number;
  pageSize: number;
}
export interface ActivityResult {
  status: 'ready' | 'empty';
  metrics: (MetricSummary & { records: number; pending: number })[];
  list: {
    id: string; taskId: string; taskName: string; performerId: string | null; performerName: string;
    businessDate: string; metricType: string; metricLabel: string; quantity: string | null; quantityUnit: string;
  }[];
  total: number;
  page: number;
  pageSize: number;
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

export interface TaskScope {
  projectId: string;
  accountId: string;
}
export interface TaskFilter {
  page: number;
  pageSize: number;
  search: string;
  view: 'all' | 'available' | 'owned';
  attention?: 'assignment' | 'review' | 'work' | 'disputed';
}
export interface TaskAction {
  key: string;
  label: string;
  path?: string;
  confirm?: string;
  fields?: {
    key: string;
    label: string;
    type: 'text' | 'url' | 'select' | 'textarea';
    required?: boolean;
    value?: string;
    options?: { value: string; label: string }[];
  }[];
}
export interface TaskItem {
  id: string;
  title: string;
  subtitle?: string;
  status: { key: string; label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'leader' };
  executor: string;
  leader?: string;
  next: { actor: string; text: string; action?: TaskAction };
  metrics: { label: string; value: string }[];
}
export interface TaskDetail extends TaskItem {
  fields: { label: string; value: string; url?: string }[];
  progress: { label: string; status: 'done' | 'current' | 'waiting'; actor: string; description?: string }[];
  actions: TaskAction[];
}
export interface ModuleTaskProvider {
  list(
    scope: TaskScope,
    user: AuthUser,
    filter: TaskFilter,
  ): Promise<{ list: TaskItem[]; total: number; create?: { label: string; path: string } }>;
  detail(scope: TaskScope, user: AuthUser, id: string): Promise<TaskDetail>;
  execute(
    scope: TaskScope,
    user: AuthUser,
    id: string,
    action: string,
    input: Record<string, unknown>,
    requestKey: string,
  ): Promise<{ message: string }>;
}

export interface TodoItem {
  kind: string;
  count: number;
  label: string;
  actor: string;
  actionLabel: string;
  path: string;
}
export interface DashboardMetric extends MetricSummary {
  path: string;
}
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
  /** Preserve existing task ownership during a reviewed business-role/team change.
   * All work must be transactional SQL: previews run this inside a rolled-back savepoint. */
  preserveMemberAccess?(connection: PoolConnection, userId: string): Promise<{ id: string; label: string; projectId: string }[]>;
  closureBlockers(connection: PoolConnection, userId: string): Promise<string[]>;
  // Runs inside the same transaction as platform identity erasure. Business and
  // financial evidence must remain intact; only personal profile fields change.
  erasePersonalData(connection: PoolConnection, userId: string): Promise<void>;
}
