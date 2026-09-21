import type { EarningsSummary, MetricsOverview, TrendPoint, ZhihuTask } from '@zhihu-koc/shared-contracts/zhihu'

export type MetricsOverviewResponse = MetricsOverview | {
  total: { impressions: number; clicks: number; conversions: number; earning: number }
}

export function normalizeMetricsOverview(data: MetricsOverviewResponse): MetricsOverview {
  if (!('total' in data)) return data
  const { impressions, clicks, conversions, earning } = data.total
  return {
    totalImpressions: impressions, totalClicks: clicks, totalConversions: conversions,
    totalEarnings: earning, totalSpend: null, cpc: null,
    ctr: impressions ? clicks / impressions : 0, cvr: clicks ? conversions / clicks : 0,
  }
}

export type MetricsTrendResponse = TrendPoint[] | {
  dates: string[]; series: { key: string; values: number[] }[]
}

export function normalizeMetricsTrend(data: MetricsTrendResponse): TrendPoint[] {
  if (Array.isArray(data)) return data
  const series = new Map(data.series.map(item => [item.key, item.values]))
  return data.dates.map((date, index) => ({
    date, impressions: series.get('impressions')?.[index] ?? 0,
    clicks: series.get('clicks')?.[index] ?? 0, conversions: series.get('conversions')?.[index] ?? 0,
    earnings: series.get('earning')?.[index] ?? 0, spend: series.get('spend')?.[index] ?? null,
  }))
}

export function normalizeEarningsSummary(data: Omit<EarningsSummary, 'total'> & { total?: number }): EarningsSummary {
  return { ...data, total: data.total ?? data.pending + data.confirmed + data.paid }
}

export function taskProduct(task: ZhihuTask): string {
  let raw = task.rawJson
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { raw = undefined }
  }
  const name = task.productName || (raw && typeof raw === 'object' && (raw.productName || raw.product_name))
  return typeof name === 'string' && name.trim() ? name.trim() : '未标注产品'
}
