export interface WorkStatus {
  source: 'evidence' | 'composition'
  status: string
  syncStatus?: string | null
  zhihuStatusJson?: unknown
  planSyncStatus?: string | null
  failureReason?: string | null
  reason?: string | null
  verificationStatus?: string | null
}

export function evidenceReview(work:WorkStatus){
  if(work.verificationStatus==='disputed')return {label:'作品归属有争议',reason:work.reason||'下一步：运营：核对保存的执行记录。'}
  if(work.status==='rejected'||work.status==='ended')return {label:'作品已退回或停用',reason:work.reason||'请查看具体原因并处理作品。'}
  return {label:['passed','pending','active'].includes(work.status)?'作品已登记，平台默认通过':'作品资料待核对',reason:work.reason||''}
}

export function upstreamReview(work: WorkStatus): { label: string; reason: string } {
  if (work.planSyncStatus === 'failed' || work.syncStatus === 'failed') return { label: work.planSyncStatus === 'failed' ? '关键词创建失败，作品尚未报送' : '作品提交失败，请修改后重新提交', reason: work.failureReason || '填写信息已保留，可修改后重新提交' }
  if (work.syncStatus === 'local' || work.syncStatus === 'syncing') return {label:'正在提交知乎',reason:''}
  if(work.verificationStatus==='disputed')return evidenceReview(work)
  const upstream=rawUpstreamReview(work)
  if(work.status==='ended'||work.status==='rejected'||upstream.rejected)return {label:'作品已退回或停用',reason:work.reason||upstream.reason||'请核对作品的实际异常。'}
  return {label:work.syncStatus==='synced'||['passed','active','pending'].includes(work.status)?'作品已登记，平台默认通过':'作品登记结果待核对',reason:work.failureReason||''}
}
/** Original upstream data is retained separately; absence/pending never blocks normal work under R7. */
export function rawUpstreamReview(work: WorkStatus): { label: string; reason: string; rejected: boolean } {
  let value = work.zhihuStatusJson
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { value = null }
  }
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const status = data.auditStatus ?? data.audit_status ?? data.status
  const labels: Record<string, string> = { pending: '来源标记为待审核', reviewing: '来源标记为审核中', approved: '来源标记为已通过', passed: '来源标记为已通过', rejected: '来源标记为已退回',failed:'来源标记为失败' }
  const reason = data.rejectReason ?? data.reject_reason
  return {
    label: status == null || status === '' ? '来源未提供审核结果' : labels[String(status)] ?? '来源状态尚未识别',
    reason: typeof reason === 'string' ? reason : '',
    rejected: ['rejected','failed'].includes(String(status)),
  }
}
