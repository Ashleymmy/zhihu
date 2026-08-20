export type CompositionDisplayStatusKey =
  | 'pending'
  | 'syncing'
  | 'reviewing'
  | 'bound'
  | 'failed'
  | 'ended'

export interface CompositionDisplayStatus {
  key: CompositionDisplayStatusKey
  label: string
  badgeClass: string
}

export function resolveCompositionDisplayStatus(input: {
  syncStatus: string
  status: string
}): CompositionDisplayStatus {
  if (input.syncStatus === 'local') {
    return { key: 'pending', label: '待回传', badgeClass: 'badge-warning' }
  }
  if (input.syncStatus === 'syncing') {
    return { key: 'syncing', label: '回传中', badgeClass: 'badge-info' }
  }
  if (input.syncStatus === 'failed') {
    return { key: 'failed', label: '回传失败', badgeClass: 'badge-error' }
  }

  if (input.status === 'active' || input.status === 'approved') {
    return { key: 'bound', label: '已绑定', badgeClass: 'badge-success' }
  }
  if (input.status === 'rejected') {
    return { key: 'failed', label: '审核失败', badgeClass: 'badge-error' }
  }
  if (input.status === 'ended') {
    return { key: 'ended', label: '已结束', badgeClass: 'badge-default' }
  }
  return { key: 'reviewing', label: '审核中', badgeClass: 'badge-info' }
}

export function normalizePromoUrl(value: string): string {
  const text = value.trim()
  if (!text) throw new Error('请输入内容链接')

  const matchedUrl = text.match(/https?:\/\/[^\s]+/i)?.[0] ?? text
  const candidate = matchedUrl.replace(/[，。！？；;）)\]】"'”’]+$/u, '')

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('请输入有效的 HTTP 或 HTTPS 链接')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('内容链接仅支持 HTTP 或 HTTPS')
  }
  return parsed.toString()
}
