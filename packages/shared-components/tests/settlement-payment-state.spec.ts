import { describe, expect, it, vi } from 'vitest'
import type { SettlementPaymentRow } from '@zhihu-koc/shared-contracts/core'
import { editablePaymentAllocations, paymentCommentContext, paymentHistoryAmounts, paymentOperation } from '../src/settlement-payment-state'

describe('payment operation continuity', () => {
  it('retries an uncertain result against the same target, body and idempotency key', async () => {
    const sent = vi.fn().mockRejectedValueOnce({ status: 408 }).mockResolvedValueOnce({ withdrawalId: '41' })
    const key = vi.fn().mockReturnValue('original-key'), finished = vi.fn()
    const body = Object.freeze({ amount: '10.0000', payAccount: 'original-account', expectedVersion: 'v1' })
    const first = paymentOperation(null, '建立付款办理记录', requestKey => sent('/settlements/20/payments', { ...body, requestKey }), finished, key)
    await expect(first.send()).rejects.toEqual({ status: 408 })
    const replacement = vi.fn(), retry = paymentOperation(first, '新的付款', replacement, vi.fn(), key)
    const result = await retry.send(); retry.success(result)
    expect(sent.mock.calls[0]).toEqual(sent.mock.calls[1]); expect(replacement).not.toHaveBeenCalled(); expect(key).toHaveBeenCalledTimes(1)
    expect(finished).toHaveBeenCalledWith({ withdrawalId: '41' }); expect(Object.isFrozen(retry)).toBe(true)
  })
  it('keeps a proof upload closure and its original file after the form has moved on', async () => {
    const original = new FormData(); original.append('reference', 'bank-reference'); original.append('proof', new Blob(['original proof']), 'proof.pdf')
    const transport = vi.fn().mockRejectedValueOnce(new Error('disconnected')).mockResolvedValueOnce({})
    const operation = paymentOperation(null, '登记付款', () => transport(original), () => {}, () => 'proof-key')
    await expect(operation.send()).rejects.toThrow('disconnected'); await operation.send()
    expect(transport.mock.calls[0]![0]).toBe(transport.mock.calls[1]![0]); expect(await (original.get('proof') as Blob).text()).toBe('original proof')
  })
  it('keeps thread identity stable across refresh while isolating recipient and settlement', () => {
    const owner = { moduleId: 'zhihu', projectId: '1', accountId: '9', leaderId: '2' }
    expect(paymentCommentContext('20', owner)).toBe(paymentCommentContext('20', { leaderId: '2', accountId: '9', projectId: '1', moduleId: 'zhihu' }))
    expect(paymentCommentContext('20', owner)).not.toBe(paymentCommentContext('21', owner))
    expect(paymentCommentContext('20', owner)).not.toBe(paymentCommentContext('20', { ...owner, leaderId: '3' }))
  })
  it('prefills only editable allocations and retains explicit zero corrections', () => {
    const row = { allocations: [{ sourceId: '41', amount: '0.0000', editable: true }, { sourceId: '99', amount: '15.0000', editable: false }] } as SettlementPaymentRow
    expect(editablePaymentAllocations(row)).toEqual({ '41': '0.0000' })
  })
  it('projects recorded relation changes into source names and amounts without exposing internal JSON', () => {
    expect(paymentHistoryAmounts([{ source_id: '41', amount: '10.0000', user_id: 'private-id', source_version: 'internal-version' }, { sourceId: '99', amount: '0.0000' }, { amount: 'invalid' }], new Map([['41', '11-03 · 作品甲']]))).toEqual([{ title: '11-03 · 作品甲', amount: '10.0000' }, { title: '其他周期的收益', amount: '0.0000' }])
    expect(paymentHistoryAmounts({ failureReason: '资料已核实' }, new Map())).toEqual([])
  })
})
