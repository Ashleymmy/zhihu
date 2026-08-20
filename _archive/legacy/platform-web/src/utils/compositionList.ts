export interface CompositionQuerySnapshot {
  channel_id: string
  keyword: string
}

export interface CompositionAuditStatus {
  label: string
  badgeClass: string
  canEdit: boolean
}

export function createCompositionQuerySnapshot(query: CompositionQuerySnapshot): CompositionQuerySnapshot {
  return {
    channel_id: query.channel_id.trim(),
    keyword: query.keyword.trim(),
  }
}

export function normalizeCompositionItems<T>(data: unknown): T[] {
  return Array.isArray(data) ? data as T[] : []
}

export function resolveCompositionAuditStatus(auditStatus?: number | null): CompositionAuditStatus {
  if (auditStatus === 1) {
    return { label: '审核通过', badgeClass: 'badge-success', canEdit: false }
  }
  if (auditStatus === 2) {
    return { label: '审核拒绝', badgeClass: 'badge-error', canEdit: true }
  }
  if (auditStatus == null) {
    return { label: '知乎未返回', badgeClass: 'badge-default', canEdit: false }
  }
  return { label: '审核中', badgeClass: 'badge-warning', canEdit: false }
}
