import type { SettlementPaymentRow, SettlementRecipientScope } from '@zhihu-koc/shared-contracts/core'

export interface PaymentOperation {
  label: string
  send: () => Promise<unknown>
  success: (result: unknown) => void
}

/** A retry retains the original transport closure, including its target, form and key. */
export function paymentOperation(current: PaymentOperation | null, label: string, send: (key: string) => Promise<unknown>, success: (result: unknown) => void, key: () => string): PaymentOperation {
  if (current) return current
  const requestKey = key()
  return Object.freeze({ label, send: () => send(requestKey), success })
}

/** A refreshed row object does not change the identity of its comment thread. */
export function paymentCommentContext(id: string, scope: SettlementRecipientScope): string {
  return JSON.stringify({ id, scope: { moduleId: scope.moduleId, projectId: scope.projectId, accountId: scope.accountId, leaderId: scope.leaderId } })
}

export function editablePaymentAllocations(row: SettlementPaymentRow): Record<string, string> {
  return Object.fromEntries(row.allocations.filter(item => item.editable).map(item => [item.sourceId, item.amount]))
}

export function paymentHistoryAmounts(value: unknown, sourceNames: Map<string, string>): Array<{ title: string; amount: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.amount !== 'string' || !/^-?\d+(?:\.\d{1,4})?$/.test(item.amount)) return []
    const sourceId = String(item.sourceId ?? item.source_id ?? item.earning_source_id ?? '')
    return [{ title: sourceNames.get(sourceId) || '其他周期的收益', amount: item.amount }]
  })
}
