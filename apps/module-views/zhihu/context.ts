import type { HttpClient } from '@zhihu-koc/shared-services/core'
export interface Scope {
  projectId: string
  accountId: string
}
export interface Option {
  channelId?: string
  id: string
  name?: string
  displayName?: string
  role?: string
  parentId?: string
  channelName?: string
  zhihuTaskId?: string
  zhihuChannelId?: string
  unitPrice?: string | number | null
  settleType?: string | null
  status?: string | null
  startTime?: string | null
  endTime?: string | null
  syncedAt?: string | null
}
export interface EngineOptions {
  integrationMode?: 'simulation' | 'upstream'
  tasks: Option[]
  channels: Option[]
  mappings: Option[]
  users: Option[]
}
export interface EngineContext {
  coreHttp: HttpClient
  parentId: string | null
  adminDuty: string
  http: HttpClient
  scope: Scope
  role: string
  userId: string
  options: EngineOptions
}
export const errorText = (e: unknown) =>
  typeof e === 'object' && e !== null && 'message' in e
    ? String(e.message)
    : '操作失败，请稍后重试'
export function requestKey() {
  return crypto.randomUUID()
}
