export interface WorkStatus {
  source: 'evidence' | 'composition'
  status: string
  syncStatus?: string | null
  zhihuStatusJson?: unknown
}

export function upstreamReview(work: WorkStatus): { label: string; reason: string } {
  let value = work.zhihuStatusJson
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { value = null }
  }
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const status = data.auditStatus ?? data.audit_status ?? data.status
  const labels: Record<string, string> = { pending: '待审核', reviewing: '审核中', approved: '已通过', passed: '已通过', rejected: '已拒绝' }
  const reason = data.rejectReason ?? data.reject_reason
  return {
    label: status == null || status === '' ? '暂未返回审核结果' : labels[String(status)] ?? String(status),
    reason: typeof reason === 'string' ? reason : '',
  }
}
