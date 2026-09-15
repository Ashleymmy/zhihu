import type { Express, Router } from 'express';
import type { AuthUser, Role } from '../types';

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
  dataProvider?: ModuleDataProvider;
  financeProvider?: FinanceProvider;
}
