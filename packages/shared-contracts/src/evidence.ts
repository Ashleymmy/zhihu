/** Public evidence contracts. Monetary values and opaque versions are supplied by the server. */
export interface HistoryContext {
  moduleId: string; accountId: string; sourceKind: string; sourceId: string; sourceVersion: string;
  operation: 'register_historical_keyword' | 'assign_retro' | 'adopt_legacy_record' | 'refresh_unconfirmed';
  selection?: Record<string, string>;
}
export interface HistoryTarget {
  method: 'POST'; path: string; memberId: string; projectId: string; at: string;
  label: string; reason?: string; expectedVersion: number; context?: HistoryContext;
  missingFields?: ('projectParticipation' | 'role' | 'team')[];
}
export interface EvidenceAction {
  key: string; label: string; method: 'GET' | 'POST'; path: string;
  requiredDuty: 'operations' | 'finance'; parameters: Record<string, string>;
  historyContext?: HistoryContext; expectedHistoryVersion?: number;
}
export interface EvidenceSource { kind: string; id: string; batchId?: string; line?: number; status?: string }
export interface EvidenceCheck {
  status: 'ready' | 'missing' | 'conflict' | 'blocked' | 'unknown' | 'not_applicable';
  reason: string; sourceRefs: EvidenceSource[]; version?: string; nextAction?: EvidenceAction;
}
export interface EvidenceRow {
  key: { projectId: string; accountId: string; channelRef: string; taskRef: string; businessDate: string; metricType: string };
  title: string;
  official: { status: 'ready' | 'valid_zero' | 'not_arrived' | 'record_missing' | 'conflict' | 'withdrawn' | 'processing' | 'unknown'; quantity: string | null; quantityUnit: string; coverageBasis: 'observed_rows' | 'none'; coverageIsExhaustive: boolean; sourceRefs: EvidenceSource[]; withdrawnSourceRefs?: EvidenceSource[]; currentRevision: string | null; pendingConflict: { revisionId: string; sourceRefs: EvidenceSource[] }[] };
  checks: Record<'work' | 'historicalOwnership' | 'projectParticipation' | 'pricing' | 'existingCalculation', EvidenceCheck>;
  result: { status: 'ready' | 'needs_input' | 'processing' | 'unknown'; reason: string; responsibleRole: 'operations' | 'finance' | null; nextAction: EvidenceAction | null; evidenceVersion: string; lastChangedAt: string | null };
  finance?: { amount: string | null; currency: 'CNY'; sourceRefs: EvidenceSource[] };
}
export interface EvidenceQuery { moduleId: string; projectId: string; accountId: string; from: string; to: string; channelRef?: string; taskRef?: string; metricType?: string; page?: number; pageSize?: number }
export interface EvidenceResult { list: EvidenceRow[]; total: number; page: number; pageSize: number; status: 'ready' | 'empty'; limits: { maxDays: number; maxPageSize: number } }
export interface HistorySource { id: string; kind: string; ref: string; sourceRef?: string; from: string; to: string | null; version: number; origin?: string; priorHistoryUnknown?: boolean }
export interface HistoryField<T> { status: 'matched' | 'unknown' | 'conflict'; value: T | null; sources: HistorySource[]; knownRange: { from: string; to: string | null }[] }
export interface HistoryEvidenceResult {
  status: 'matched' | 'unknown' | 'conflict'; memberId: string; projectId: string; version: number;
  projectParticipation: HistoryField<boolean>; role: HistoryField<string>; team: HistoryField<string | null>;
  sources: HistorySource[]; records: { id: string; sourceSummary: string; sourceRef: string | null; status: string; createdAt: string }[];
  page: number; pageSize: number;
}
export interface HistoryEvidenceInput {
  projectId: string; effectiveFrom: string; effectiveTo?: string; timePrecision: 'date' | 'timestamp';
  participation?: boolean; historicalRole?: 'creator' | 'leader' | 'operator' | 'admin' | 'developer'; leaderId?: string | null;
  sourceKind: 'project_membership' | 'team_membership' | 'role_history' | 'operator_confirmation' | 'description';
  sourceRef?: string; sourceSummary: string; confirmed: boolean; expectedVersion: number; requestKey: string; supersedesId?: string; context?: HistoryContext;
}
export interface HistorySaveResult {
  status: 'pending' | 'verified'; evidenceId: string; version: number;
  refreshStatus: { status: 'refreshed' | 'unchanged'; recalculated: number; resumed: number; nextActions?: HistoryTarget[] };
  nextAction: HistoryTarget | { actor: string; label: string; method: 'POST'; path: string } | null;
}
export interface EvidenceApi {
  query(input: EvidenceQuery): Promise<EvidenceResult>;
  history(memberId: string, input: { projectId: string; at: string; page?: number; pageSize?: number }): Promise<HistoryEvidenceResult>;
  save(memberId: string, input: HistoryEvidenceInput): Promise<HistorySaveResult>;
  member(memberId: string): Promise<{ user: { id: string; name: string; role: string } }>;
  members(): Promise<{ id: string; displayName: string; role: string }[]>;
}
