import type { Express, Router } from 'express';
import type { AuthUser, Role } from '../types';
import type { PoolConnection } from 'mysql2/promise';

export const MODULE_CONTRACT_VERSION = 1;
export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  contractVersion: number;
  roles: Role[];
  capabilities: string[];
  permissions: Partial<Record<Role, string[]>>;
  entryPath: string;
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
