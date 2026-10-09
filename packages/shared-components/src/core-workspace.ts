import type { Ref, ComputedRef } from 'vue'
import type { OperationGuideModel } from './operation-guide'
export interface WorkspaceModule {
  id: string
  name: string
  version: string
  entryPath: string
  financeHistoryPath?: string | null
  capabilities: string[]
  status: string
  message: string | null
  accountCreation?: 'managed' | 'self_service'
  accountMessage?: string | null
}
export interface WorkspaceHttp {
  get<T>(url: string, params?: object): Promise<T>
  post<T>(url: string, data?: unknown): Promise<T>
  patch<T>(url: string, data?: unknown): Promise<T>
  del<T>(url: string): Promise<T>
  postForm<T>(url: string, form: FormData): Promise<T>
  getBlob(url: string): Promise<Blob>
}
export interface CoreWorkspace {
  http: WorkspaceHttp
  role: ComputedRef<string>
  modules: Ref<WorkspaceModule[]>
  projectId: Ref<string>
  operationGuide?: ComputedRef<OperationGuideModel | null>
  refreshModules(): Promise<void>
}
