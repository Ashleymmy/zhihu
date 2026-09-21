export interface KeywordProgress {
  syncStatus: string
  lifecycleStatus: string
}

export function keywordProgress(word: KeywordProgress): string {
  if (word.syncStatus === 'failed') return '提交失败，暂不可领取'
  if (word.syncStatus === 'local') return '待提交知乎'
  if (word.syncStatus === 'syncing') return '提交结果待确认'
  if (word.syncStatus === 'synced' && word.lifecycleStatus === 'pending') return '已创建，待核实可用状态'
  return ({ pending: '待核实', available: '可以领取', reserved: '等待分发', assigned: '待提交作品', active: '使用中', retired: '已停用' } as Record<string, string>)[word.lifecycleStatus] ?? '待核实'
}

export interface KeywordSummary {
  pending: number
  submitting: number
  created: number
  failed: number
  simulated: number
  unknown: number
}
