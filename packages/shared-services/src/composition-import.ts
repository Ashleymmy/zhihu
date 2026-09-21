import type { HttpClient } from './http'

export interface WorkImportOptions {
  sheetName?: string
  headerRow?: number
  mapping?: Record<string, number | null>
  categoryMode?: 'manual' | 'rotate-video'
  defaults?: { planId?: string; compositionType?: number; compositionSubType?: number; releaseTime?: string }
  knownExternal?: { site: string; checkedAt: string; links: string[] }
}
export interface WorkImportRow {
  row: number
  status: 'ready' | 'duplicate' | 'invalid' | 'created'
  keyword: string
  mediaAccount: string
  mediaType: string
  promoUrl: string
  releaseTime: string
  title: string
  category?: string
  errors: string[]
  notes: string[]
  id?: string
}
export interface WorkImportPreview {
  sheetName: string
  sheetNames: string[]
  headerRow: number
  mapping: Record<string, number | null>
  columns: { index: number; label: string; samples: string[] }[]
  fields: { key: string; label: string }[]
  total: number
  ready: number
  duplicate: number
  invalid: number
  rows: WorkImportRow[]
}
export interface WorkImportResult extends WorkImportPreview {
  created: number
  ids: string[]
  queued: number
  queueFailed: string[]
}
export interface WorkImportDraftReceipt {
  id: string; total: number; pending: number; duplicate: number; ready: number; delivery: 'local_only'; preview: WorkImportPreview
}
export interface WorkImportDraft {
  id: string; fileName: string; sheetName: string; totalCount: number; pendingCount: number; duplicateCount: number; readyCount: number; updatedAt: string
}
export interface WorkImportDraftDetail extends WorkImportDraft { options: WorkImportOptions; preview: WorkImportPreview }
export function createWorkImportApi(http: HttpClient) {
  function form(file: File, options: WorkImportOptions) {
    const data = new FormData()
    data.append('file', file)
    data.append('options', JSON.stringify(options))
    return data
  }
  return {
    analyzeWorks: (file: File, options: WorkImportOptions) => http.postForm<WorkImportPreview>('/compositions/import/analyze', form(file, options)),
    importWorks: (file: File, options: WorkImportOptions) => http.postForm<WorkImportResult>('/compositions/import/commit', form(file, options)),
    saveWorkDraft: (file: File, options: WorkImportOptions) => http.postForm<WorkImportDraftReceipt>('/compositions/import/draft', form(file, options)),
    listWorkDrafts: (page = 1) => http.get<{ list: WorkImportDraft[]; total: number }>('/compositions/import/drafts', { page }),
    getWorkDraft: (id: string) => http.get<WorkImportDraftDetail>(`/compositions/import/drafts/${id}`),
    getWorkDraftFile: (id: string) => http.getBlob(`/compositions/import/drafts/${id}/file`),
  }
}
