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
  evidence?(scope: DataScope, user: AuthUser, filter: EvidenceFilter): Promise<EvidenceResult>;
  activity?(scope: DataScope, user: AuthUser, filter: ActivityFilter): Promise<ActivityResult>;
  // Aggregate upstream amounts only; never expose individual members' income.
  teamTurnover?(connection: PoolConnection, scope: DataScope, user: AuthUser): Promise<TeamTurnover>;
  workRegistrations?(scope: TaskScope, user: AuthUser, filter: WorkRegistrationFilter, includeRows: boolean): Promise<WorkRegistrationReport>;
  keywordBindings?(scope: TaskScope, user: AuthUser, filter: KeywordBindingFilter): Promise<KeywordBindingRow[]>;
  memberActivity?: MemberActivityProvider;
}
export interface EvidenceFilter {
  channelRef?: string;
  taskRef?: string;
  metricType?: string;
  page: number;
  pageSize: number;
}
export interface EvidenceKey {
  projectId: string;
  accountId: string;
  channelRef: string;
  taskRef: string;
  businessDate: string;
  metricType: string;
}
export interface EvidenceSourceRef {
  kind: string;
  id: string;
  batchId?: string;
  line?: number;
  status?: 'adopted' | 'available' | 'pending' | 'superseded' | 'withdrawn';
}
export interface EvidenceAction {
  key: string;
  label: string;
  method: 'GET' | 'POST';
  path: string;
  requiredDuty: 'operations' | 'finance';
  parameters: Record<string, string>;
  historyContext?: MemberHistoryContext;
  expectedHistoryVersion?: number;
}
export interface EvidenceCheck {
  status: 'ready' | 'missing' | 'conflict' | 'blocked' | 'unknown' | 'not_applicable';
  reason: string;
  sourceRefs: EvidenceSourceRef[];
  version?: string;
  nextAction?: EvidenceAction;
}
export type OfficialEvidenceStatus = 'ready' | 'valid_zero' | 'not_arrived' | 'record_missing' | 'conflict' | 'withdrawn' | 'processing' | 'unknown';
export interface EvidenceRow {
  key: EvidenceKey;
  title: string;
  official: {
    status: OfficialEvidenceStatus;
    quantity: string | null;
    quantityUnit: string;
    coverageBasis: 'observed_rows' | 'none';
    coverageIsExhaustive: boolean;
    sourceRefs: EvidenceSourceRef[];
    withdrawnSourceRefs?: EvidenceSourceRef[];
    currentRevision: string | null;
    pendingConflict: { revisionId: string; sourceRefs: EvidenceSourceRef[] }[];
  };
  checks: {
    work: EvidenceCheck;
    historicalOwnership: EvidenceCheck;
    projectParticipation: EvidenceCheck;
    pricing: EvidenceCheck;
    existingCalculation: EvidenceCheck;
  };
  result: {
    status: 'ready' | 'needs_input' | 'processing' | 'unknown';
    reason: string;
    responsibleRole: 'operations' | 'finance' | null;
    nextAction: EvidenceAction | null;
    evidenceVersion: string;
    lastChangedAt: string | null;
  };
  finance?: { amount: string | null; currency: 'CNY'; sourceRefs: EvidenceSourceRef[] };
}
export interface EvidenceResult extends DataScope {
  moduleId: string;
  status: 'ready' | 'empty';
  list: EvidenceRow[];
  total: number;
  page: number;
  pageSize: number;
  limits: { maxDays: number; maxPageSize: number };
}
export interface MemberActivityCounts { tasks: number; currentTasks: number; verifiedTasks: number; works: number }
export interface MemberActivityFilter {
  kind: 'tasks' | 'works'; status: 'all' | 'current' | 'verified' | 'released';
  page: number; pageSize: number; search?: string; from?: string; to?: string; taskRef?: string;
}
export interface MemberActivityRecord {
  id: string; projectId: string; accountId: string; taskRef: string;
  title: string; keyword: string; at: string; status: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  url?: string; fields: { label: string; value: string; url?: string }[];
}
export interface MemberActivityProvider {
  summary(scopes: TaskScope[], user: AuthUser, memberIds: string[]): Promise<Record<string, MemberActivityCounts>>;
  records(scopes: TaskScope[], user: AuthUser, memberId: string, filter: MemberActivityFilter): Promise<{ list: MemberActivityRecord[]; total: number }>;
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

/** Only resumable operations on unconfirmed business records are accepted here. */
export interface MemberHistoryContext {
  moduleId: string;
  accountId: string;
  sourceKind: string;
  sourceId: string;
  sourceVersion: string;
  operation: 'register_historical_keyword' | 'assign_retro' | 'adopt_legacy_record' | 'refresh_unconfirmed';
  selection?: Record<string, string>;
}
export interface MemberHistoryChange {
  memberId: string;
  projectId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  timePrecision: 'date' | 'timestamp';
  evidenceId: string;
  version: number;
  context?: MemberHistoryContext;
}
export interface MemberHistoryRefresh {
  status: 'refreshed' | 'unchanged';
  recalculated: number;
  resumed: number;
  nextActions?: MemberHistoryContinuation[];
}
export interface MemberHistoryContinuation {
  actor: '运营';
  label: string;
  method: 'POST';
  path: string;
  memberId: string;
  projectId: string;
  at: string;
  reason: string;
  missingFields: ('projectParticipation' | 'role' | 'team')[];
  expectedVersion: number;
  context: MemberHistoryContext;
}
export interface ModuleAccountLifecycle {
  /** Same transaction as evidence storage. Validate context source, scope, version
   * and allowed operation before resuming. Never confirm or pay money here. */
  memberHistoryChanged?(connection: PoolConnection, actor: AuthUser, change: MemberHistoryChange): Promise<MemberHistoryRefresh>;
  accessChangeBlockers?(connection: PoolConnection, userId: string, projectId?: string): Promise<string[]>;
  /** Preserve existing task ownership during a reviewed business-role/team change.
   * All work must be transactional SQL: previews run this inside a rolled-back savepoint. */
  preserveMemberAccess?(connection: PoolConnection, userId: string): Promise<{ id: string; label: string; projectId: string }[]>;
  closureBlockers(connection: PoolConnection, userId: string): Promise<string[]>;
  // Runs inside the same transaction as platform identity erasure. Business and
  // financial evidence must remain intact; only personal profile fields change.
  erasePersonalData(connection: PoolConnection, userId: string): Promise<void>;
}
