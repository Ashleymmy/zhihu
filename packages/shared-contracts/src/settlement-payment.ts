import type { CommentApi, PageQuery, PageResult, SettlementRecipientScope } from './settlement'

export type SettlementPaymentState = 'not_initiated' | 'processing' | 'partially_paid' | 'paid' | 'needs_review'
export type SettlementPayMethod = 'wechat' | 'alipay' | 'bank'
export interface SettlementPaymentTotals {
  confirmedAmount: string; heldAmount: string; releasedAmount: string
  processingAmount: string; paidGrossAmount: string; paidNetAmount: string
  remainingAmount: string; availableAmount: string; legacyUnallocatedAmount: string
  offsetAmount: string; residualAmount: string
}
export interface SettlementPaymentRow {
  withdrawalId: string; settlementId: string | null; initiatedBy: string | null
  initiatorName: string | null; recipientId: string; recipientName: string
  amount: string; feeAmount: string; netAmount: string
  allocatedAmount: string; allocatedNetAmount: string; unallocatedAmount: string
  allocations: Array<SettlementPaymentAllocation & { editable: boolean }>
  status: 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled'
  paymentVersion: number; policyVersion: string | null; receiverName: string | null
  createdAt: string; invoiceName: string | null; invoiceReason: string | null; invoiceInstructions: string | null
  payMethod: SettlementPayMethod; payAccount: string | null
  reviewDeadline: string | null; settlementDeadline: string | null
  invoiceRequired: boolean; invoiceStatus: string | null; invoiceVersion: number
  paidOn: string | null; paymentReference: string | null; proofName: string | null
  failureReason: string | null; next: string; canCancel: boolean; canRetry: boolean
}
export interface SettlementPaymentSource {
  sourceId: string; sourceKey: string; businessDate: string; taskName: string
  confirmedAmount: string; allocatedAmount: string; remainingAmount: string; availableAmount: string
  originalConfirmedAmount: string; currentConfirmedAmount: string; correctionAmount: string
  reason: string
}
export interface SettlementPaymentOverview {
  settlementId: string; scope: SettlementRecipientScope; paymentStatus: SettlementPaymentState; version: string
  totals: SettlementPaymentTotals; payments: SettlementPaymentRow[]; sources: SettlementPaymentSource[]
  total: number; page: number; pageSize: number; funding: { amount: string; version: string }
  policy: { enabled: boolean; version: string; feeRate: string; dailyAmountLimit: string; todayAmount: string; remainingAmount: string; lines: string[] }
  blockers: Array<{ kind: string; reason: string; next: string; action: 'funding' | 'link' | 'review_sources' | 'recipient' | 'none' }>
}
export interface SettlementPaymentAllocation { sourceId: string; sourceKey: string; businessDate: string; amount: string }
export interface SettlementPaymentQuote {
  settlementId: string; amount: string; feeAmount: string; netAmount: string
  policyVersion: string | null; quoteToken: string; expectedVersion: string
  reviewDeadline: string | null; settlementDeadline: string | null; invoiceRequired: boolean
  allocations: SettlementPaymentAllocation[]
}
export interface SettlementPaymentCreate {
  requestKey: string; quoteToken: string; expectedVersion: string; amount: string; policyVersion: string | null
  receiverName: string; payMethod: SettlementPayMethod; payAccount: string
}
export interface SettlementPaymentLinkInput { withdrawalId: string; allocations: Array<{ sourceId: string; amount: string }> }
export interface SettlementPaymentLinkPreview {
  version: string; withdrawalId: string; allocations: SettlementPaymentAllocation[]
  totalAmount: string; warnings: string[]
}
export interface SettlementPaymentApi<Download = unknown> {
  overview(id: string, input: SettlementRecipientScope & PageQuery & { withdrawalId?: string }): Promise<SettlementPaymentOverview>
  quote(id: string, input: SettlementRecipientScope & { amount: string; expectedVersion: string }): Promise<SettlementPaymentQuote>
  create(id: string, input: SettlementRecipientScope & SettlementPaymentCreate): Promise<{ withdrawalId: string; settlementId: string }>
  funding(id: string, input: SettlementRecipientScope & { requestKey: string; expectedVersion: string; reference: string }): Promise<{ amount: string }>
  action(id: string, withdrawalId: string, input: SettlementRecipientScope & { requestKey: string; expectedVersion: string; action: 'cancel' | 'failed' | 'retry'; reason: string }): Promise<{ withdrawalId: string }>
  legacy(id: string, input: SettlementRecipientScope & PageQuery): Promise<PageResult<SettlementPaymentRow> & { version: string }>
  previewLink(id: string, input: SettlementRecipientScope & SettlementPaymentLinkInput): Promise<SettlementPaymentLinkPreview>
  link(id: string, input: SettlementRecipientScope & SettlementPaymentLinkInput & { requestKey: string; expectedVersion: string }): Promise<{ withdrawalId: string }>
  comments(id: string, withdrawalId: string, scope: SettlementRecipientScope): CommentApi
  export(id: string, input: SettlementRecipientScope): Promise<Download>
}
