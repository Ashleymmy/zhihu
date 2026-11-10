import type { EvidenceAction, HistorySaveResult, HistoryTarget } from '@zhihu-koc/shared-contracts/core'

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
/** Accept only the existing history endpoint. Never execute an arbitrary server-supplied URL. */
export function historyTarget(value: unknown, fallbackVersion?: number): HistoryTarget | null {
  const action = record(value)
  const match = typeof action?.path === 'string' ? /^\/api\/v1\/core\/relations\/members\/([1-9]\d*)\/history-evidence$/.exec(action.path) : null
  if (!action || !match || action.method !== 'POST') return null
  const parameters = record(action.parameters)
  const memberId = action.memberId ?? match[1], projectId = action.projectId ?? parameters?.projectId
  const at = action.at ?? parameters?.effectiveFrom
  const version = action.expectedVersion ?? action.expectedHistoryVersion ?? fallbackVersion
  if (typeof memberId !== 'string' || memberId !== match[1] || typeof projectId !== 'string' || typeof at !== 'string' || !Number.isInteger(version) || Number(version) < 0) return null
  return { method: 'POST', path: String(action.path), memberId, projectId, at, expectedVersion: Number(version), label: typeof action.label === 'string' ? action.label : '补充历史依据', reason: typeof action.reason === 'string' ? action.reason : undefined, context: (action.context ?? action.historyContext) as HistoryTarget['context'], missingFields: action.missingFields as HistoryTarget['missingFields'] }
}
export function historyTargetFromError(error: unknown): HistoryTarget | null {
  const extras = record(record(error)?.extras), history = record(extras?.history)
  return historyTarget(extras?.nextAction, typeof history?.version === 'number' ? history.version : undefined)
}
export function historyTargetsAfterSave(result: HistorySaveResult): HistoryTarget[] {
  if (result.status !== 'verified') return []
  const candidates = result.refreshStatus.nextActions ?? (result.nextAction ? [result.nextAction] : [])
  const targets = candidates.map(action => historyTarget(action))
  if (targets.some(target => !target)) throw new Error('下一步资料尚未完整，请重新读取当前记录。')
  return targets as HistoryTarget[]
}
export function evidenceHistoryTarget(action: EvidenceAction | null): HistoryTarget | null { return historyTarget(action) }
export function remainingHistoryTargets(queue: HistoryTarget[], result: HistorySaveResult): HistoryTarget[] {
  if (result.status !== 'verified') return []
  const identity = (target: HistoryTarget) => JSON.stringify([target.memberId, target.projectId, target.at, target.context?.moduleId, target.context?.accountId, target.context?.sourceKind, target.context?.sourceId, target.context?.operation, target.context?.selection])
  const unique = new Map<string, HistoryTarget>()
  for (const target of [...historyTargetsAfterSave(result), ...queue.slice(1)]) if (!unique.has(identity(target))) unique.set(identity(target), target)
  return [...unique.values()]
}
export function evidenceDateRanges(from: string, to: string): { from: string; to: string }[] {
  const start = Date.parse(from), end = Date.parse(to)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0, 10) !== from || new Date(end).toISOString().slice(0, 10) !== to || start > end) throw new Error('请选择有效的开始和结束日期。')
  const result = []
  for (let day = start; day <= end; day += 31 * 86400000) result.push({ from: new Date(day).toISOString().slice(0, 10), to: new Date(Math.min(end, day + 30 * 86400000)).toISOString().slice(0, 10) })
  return result
}
