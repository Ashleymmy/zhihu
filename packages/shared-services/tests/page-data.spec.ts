import { describe, it, expect, vi } from 'vitest'
import { fetchAllPages, fetchAllOffsetPages } from '../src/pagination'
import { normalizeMetricsOverview, normalizeMetricsTrend, taskProduct } from '../src/zhihu-data'
import { createDataImportApi, createEarningsApi, createPlansApi, createZhihuStoryApi } from '../src/zhihu'
import type { HttpClient } from '../src/http'
import type { ZhihuTask } from '@zhihu-koc/shared-contracts/zhihu'

const records = Array.from({ length: 205 }, (_, i) => ({ id: String(i + 1) }))
describe('complete paginated reads', () => {
  it('includes keywords beyond the first 100 and the final partial page', async () => {
    const request = vi.fn(async ({ page, pageSize }) => ({ list: records.slice((page - 1) * pageSize, page * pageSize), total: records.length, pageSize }))
    expect(await fetchAllPages(request)).toEqual(records)
    expect(request.mock.calls.map(([p]) => p.page)).toEqual([1, 2, 3])
  })
  it('uses the server page size when capped below the requested size', async () => {
    expect(await fetchAllPages(async ({ page }) => ({ list: records.slice((page - 1) * 20, page * 20), total: 205, pageSize: 20 }))).toEqual(records)
  })
  it('rejects failed, truncated, duplicate, or changing pages instead of silently losing records', async () => {
    await expect(fetchAllPages(async () => ({ list: records.slice(0, 50), total: 205 }))).rejects.toThrow('完整')
    await expect(fetchAllPages(async () => ({ list: records.slice(0, 100), total: 205 }))).rejects.toThrow('重复')
    await expect(fetchAllPages(async ({ page }) => ({ list: records.slice(0, 100), total: page === 1 ? 205 : 206 }))).rejects.toThrow('变化')
    await expect(fetchAllPages(async ({ page }) => { if (page === 2) throw Error('网络中断'); return { list: records.slice(0, 100), total: 205 } })).rejects.toThrow('网络中断')
  })
  it('handles an empty list without another request', async () => {
    const request = vi.fn(async () => ({ list: [], total: 0 }))
    expect(await fetchAllPages(request)).toEqual([])
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('keeps different price versions belonging to the same agreement', async () => {
    const versions = [{ id: 'agreement-1', versionId: 'v1' }, { id: 'agreement-1', versionId: 'v2' }]
    expect(await fetchAllPages(async ({ page }) => ({ list: [versions[page - 1]!], total: 2 }), 1, row => row.versionId)).toEqual(versions)
  })
  it('reads all official offset pages with a total or without metadata', async () => {
    const request = vi.fn(async ({ offset, limit }) => ({ data: records.slice(offset, offset + limit), pagination: { offset, limit, total: 205 } }))
    expect(await fetchAllOffsetPages(request)).toEqual({ items: records, total: 205 })
    expect(request.mock.calls.map(([p]) => p.offset)).toEqual([0, 100, 200])
    expect(await fetchAllOffsetPages(async ({ offset, limit }) => records.slice(offset, offset + limit))).toEqual({ items: records, total: 205 })
  })
  it('rejects a repeated official page and incomplete or invalid metadata', async () => {
    await expect(fetchAllOffsetPages(async () => records.slice(0, 100))).rejects.toThrow('重复')
    await expect(fetchAllOffsetPages(async () => ({ data: records.slice(0, 5), pagination: { total: 205 } }))).rejects.toThrow('完整')
    await expect(fetchAllOffsetPages(async () => ({ data: [], pagination: { offset: 1 } }))).rejects.toThrow('分页')
  })
})

describe('production data contracts', () => {
  it('maps database metrics and preserves unavailable spend', () => {
    expect(normalizeMetricsOverview({ total: { impressions: 200, clicks: 20, conversions: 4, earning: 12345 } })).toEqual({ totalImpressions: 200, totalClicks: 20, totalConversions: 4, totalEarnings: 12345, totalSpend: null, cpc: null, ctr: .1, cvr: .2 })
    expect(normalizeMetricsTrend({ dates: ['2026-09-21'], series: [{ key: 'clicks', values: [20] }, { key: 'earning', values: [12345] }] })).toEqual([{ date: '2026-09-21', impressions: 0, clicks: 20, conversions: 0, earnings: 12345, spend: null }])
  })
  it('maps earnings dates, owners and total consistently', async () => {
    const get = vi.fn().mockResolvedValueOnce({ list: [{ id: '1', settleDate: '2026-09-21', userId: '3', amount: 500 }], total: 1 }).mockResolvedValueOnce({ pending: 100, confirmed: 200, paid: 300, withdrawn: 100 })
    const api = createEarningsApi({ get } as unknown as HttpClient)
    expect((await api.list()).list[0]).toMatchObject({ date: '2026-09-21', ownerId: '3', amount: 500 })
    expect(await api.summary()).toMatchObject({ pending: 100, confirmed: 200, paid: 300, total: 600 })
  })
  it('reads products from both database JSON formats', () => {
    expect(taskProduct({ rawJson: { productName: '盐选' } } as ZhihuTask)).toBe('盐选')
    expect(taskProduct({ rawJson: '{"product_name":"有声书"}' } as ZhihuTask)).toBe('有声书')
    expect(taskProduct({ rawJson: 'invalid' } as ZhihuTask)).toBe('未标注产品')
  })
  it('uses the real plan update route method', async () => {
    const patch = vi.fn().mockResolvedValue({ id: '205' })
    await createPlansApi({ patch } as unknown as HttpClient).update('205', { name: '新名称' })
    expect(patch).toHaveBeenCalledWith('/plans/205', { name: '新名称' })
  })
  it('loads every import batch and saved content item', async () => {
    const get = vi.fn(async (_url, params) => ({ list: records.slice((params.page - 1) * params.pageSize, params.page * params.pageSize), total: 205 }))
    const http = { get } as unknown as HttpClient
    expect(await createDataImportApi(http).listBatches()).toEqual(records)
    expect(await createZhihuStoryApi(http).listItems('asset')).toEqual(records)
    expect(get.mock.calls[5]).toEqual(['/story-items', { type: 'asset', page: 3, pageSize: 100 }])
  })
})
