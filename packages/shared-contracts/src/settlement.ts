import type { EvidenceAction, EvidenceRow } from './evidence'
export interface SettlementScope { moduleId: string; projectId: string; accountId: string; leaderId: string; from: string; to: string; metricType?: string }
export type SettlementAccount = Pick<SettlementScope, 'moduleId' | 'projectId' | 'accountId'>
export type SettlementRecipientScope = SettlementAccount & { leaderId: string }
export interface PageQuery { page?: number; pageSize?: number }
export interface PageResult<T> { list: T[]; total: number; page: number; pageSize: number }
export interface SettlementRecipient { id: string; name: string; role: string; active: boolean }
export interface SettlementImpact { payeeId: string; payeeName: string; selectedRecipient: boolean; amount: string; confirmedAmount: string; deltaAmount: string }
export interface SettlementRecord { id: string; sourceKey: string; sourceVersion: string; taskId: string; taskName: string; businessDate: string; performerId: string | null; performerName: string; group: 'self' | 'team'; metricType: string; metricLabel: string; quantityUnit: string; quantity: string | null; amount: string | null; confirmedAmount: string; deltaAmount: string | null; status: 'ready' | 'blocked' | 'confirmed'; reason: string; next: string; nextAction: EvidenceAction | null }
export interface SettlementTotals { amount: string | null; knownAmount: string; confirmedAmount: string; confirmableAmount: string; pendingCalculations: number; records: number; ready: number; blocked: number; confirmed: number; groups: Array<{ group: 'self' | 'team'; metricType: string; metricLabel: string; quantityUnit: string; quantity: string | null; amount: string | null; knownAmount: string; confirmedAmount: string; confirmableAmount: string; records: number; pendingCalculations: number }> }
export interface SettlementReview extends PageResult<SettlementRecord> { scope: SettlementScope; recipient: SettlementRecipient; reviewVersion: string; summary: SettlementTotals; coverage: { status: 'observed' | 'not_arrived' | 'no_performance' | 'processing' | 'withdrawn'; message: string }; unresolvedContext: { records: number; reason: string; next: string; nextAction: EvidenceAction | null } }
export interface SettlementSummary { id: string; version: string; status: 'preview' | 'confirmed'; scope: SettlementScope; recipient: SettlementRecipient; summary: SettlementTotals; impactSummary: { recipients: number; records: number; amount: string; deltaAmount: string }; createdAt: string; confirmedAt: string | null; paymentStatus: 'not_initiated' | 'processing' | 'partially_paid' | 'paid' | 'needs_review' }
export interface SettlementDocument extends SettlementSummary { impacts: SettlementImpact[]; items: Array<{ record: SettlementRecord; status: SettlementRecord['status']; impacts: SettlementImpact[]; reason: string }>; total: number; page: number; pageSize: number }
export interface RecordComment { id: string; authorId: string; authorName: string; body: string; createdAt: string }
export interface CommentApi { list(query: PageQuery): Promise<PageResult<RecordComment>>; add(input: { body: string; requestKey: string }): Promise<RecordComment> }
export interface SettlementApi {
  recipients(input: SettlementAccount & PageQuery & { search?: string }): Promise<PageResult<SettlementRecipient>>
  review(input: SettlementScope & PageQuery & { status?: string }): Promise<SettlementReview>
  source(id: string, scope: SettlementScope): Promise<{ record: SettlementRecord; impacts: SettlementImpact[]; evidence: EvidenceRow | null }>
  preview(input: SettlementScope & { expectedReviewVersion: string; requestKey: string }): Promise<SettlementDocument>
  list(input: SettlementAccount & PageQuery & { leaderId?: string }): Promise<PageResult<SettlementSummary>>
  detail(id: string, input: SettlementRecipientScope & PageQuery): Promise<SettlementDocument>
  confirm(id: string, input: SettlementRecipientScope & { expectedVersion: string; requestKey: string }): Promise<SettlementDocument>
  comments(kind: 'source' | 'settlement', id: string, scope: SettlementScope | SettlementRecipientScope): CommentApi
}
