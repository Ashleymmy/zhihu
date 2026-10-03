export interface WorkStatus {
  source: 'evidence' | 'composition'
  status: string
  syncStatus?: string | null
  zhihuStatusJson?: unknown
  planSyncStatus?: string | null
  failureReason?: string | null
}

export function upstreamReview(work: WorkStatus): { label: string; reason: string } {
  if (work.planSyncStatus === 'failed' || work.syncStatus === 'failed') return { label: work.planSyncStatus === 'failed' ? '关键词创建失败，作品未进入知乎审核' : '作品提交失败，请修改后重新提交', reason: work.failureReason || '填写信息已保留，可修改后重新提交' }
  if (work.syncStatus === 'local' || work.syncStatus === 'syncing') return {label:'正在提交知乎',reason:''}
  let value = work.zhihuStatusJson
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { value = null }
  }
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const status = data.auditStatus ?? data.audit_status ?? data.status
  const labels: Record<string, string> = { pending: '待审核', reviewing: '审核中', approved: '已通过', passed: '已通过', rejected: '已拒绝' }
  const reason = data.rejectReason ?? data.reject_reason
  return {
    label: status == null || status === '' ? '已提交知乎，等待审核结果' : labels[String(status)] ?? String(status),
    reason: typeof reason === 'string' ? reason : '',
  }
}
