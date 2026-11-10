import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../types';
import type { EvidenceAction, EvidenceRow } from './contracts';

export interface SettlementScope {
  moduleId: string;
  projectId: string;
  accountId: string;
  leaderId: string;
  from: string;
  to: string;
  metricType?: string;
}
export interface SettlementRecipient {
  id: string;
  name: string;
  role: string;
  active: boolean;
}
export interface SettlementImpact {
  payeeId: string;
  payeeName: string;
  selectedRecipient: boolean;
  amount: string;
  confirmedAmount: string;
  deltaAmount: string;
}
export interface SettlementRecord {
  id: string;
  sourceKey: string;
  sourceVersion: string;
  taskId: string;
  taskName: string;
  businessDate: string;
  performerId: string | null;
  performerName: string;
  group: 'self' | 'team';
  metricType: string;
  metricLabel: string;
  quantityUnit: string;
  quantity: string | null;
  amount: string | null;
  confirmedAmount: string;
  deltaAmount: string | null;
  status: 'ready' | 'blocked' | 'confirmed';
  reason: string;
  next: string;
  nextAction: EvidenceAction | null;
}
export interface SettlementGroup {
  group: 'self' | 'team';
  metricType: string;
  metricLabel: string;
  quantityUnit: string;
  quantity: string | null;
  amount: string | null;
  knownAmount: string;
  confirmedAmount: string;
  confirmableAmount: string;
  records: number;
  pendingCalculations: number;
}
export interface SettlementSummary {
  amount: string | null;
  knownAmount: string;
  confirmedAmount: string;
  confirmableAmount: string;
  pendingCalculations: number;
  records: number;
  ready: number;
  blocked: number;
  confirmed: number;
  groups: SettlementGroup[];
}
export interface SettlementContext {
  coverage: { status: 'observed' | 'not_arrived' | 'no_performance' | 'processing' | 'withdrawn'; message: string };
  unresolvedContext: { records: number; reason: string; next: string; nextAction: EvidenceAction | null };
}
export interface SettlementSourceCheck {
  sourceKey: string;
  version: string;
  token: string;
  status: 'ready' | 'blocked' | 'confirmed';
  reason: string;
  next: string;
  nextAction: EvidenceAction | null;
  evidence: EvidenceRow | null;
  /** Saved current allocation. Omitted former recipients are separately disclosed as zero-target corrections. */
  allocations: { payeeId: string; amount: string | null }[];
}
/** All project work uses the supplied transaction; never open a nested transaction or make network calls. */
export interface SettlementProvider {
  lock(c: PoolConnection, user: AuthUser, scope: SettlementScope): Promise<void>;
  inspect(
    c: PoolConnection,
    user: AuthUser,
    scope: SettlementScope,
    sourceKeys: string[],
  ): Promise<SettlementSourceCheck[]>;
  context(c: PoolConnection, user: AuthUser, scope: SettlementScope): Promise<SettlementContext>;
  confirm(c: PoolConnection, user: AuthUser, scope: SettlementScope, sourceKey: string, version: string): Promise<void>;
  confirmMany?(
    c: PoolConnection,
    user: AuthUser,
    scope: SettlementScope,
    sources: { sourceKey: string; version: string }[],
  ): Promise<void>;
}
export interface SettlementItem {
  record: SettlementRecord;
  status: 'ready' | 'blocked' | 'confirmed';
  impacts: SettlementImpact[];
  reason: string;
}
export interface SettlementDocument {
  id: string;
  version: string;
  status: 'preview' | 'confirmed';
  scope: SettlementScope;
  recipient: SettlementRecipient;
  summary: SettlementSummary;
  impactSummary: { recipients: number; records: number; amount: string; deltaAmount: string };
  impacts: SettlementImpact[];
  items: SettlementItem[];
  createdAt: string;
  confirmedAt: string | null;
  total: number;
  page: number;
  pageSize: number;
  paymentStatus: 'not_initiated';
}
