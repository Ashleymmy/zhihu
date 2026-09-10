import type { HttpClient } from './http'
export interface ModuleInfo {
  id: string
  name: string
  version: string
  entryPath: string
  capabilities: string[]
  status: 'enabled' | 'disabled' | 'unavailable'
  message: string | null
  accountCreation?: 'managed' | 'self_service'
  accountMessage?: string | null
}
export interface IntegrationAccount {
  id: string
  moduleId: string
  accountKey: string
  name: string
  status: 'active' | 'disabled'
}
export interface ModuleSummary {
  moduleId: string
  accountId: string
  projectId: string
  from: string
  to: string
  updatedAt: string
  status: 'ready' | 'empty' | 'unavailable'
  metrics: Array<{ key: string; label: string; unit: string; value: string | null }>
}
export const createPlatformApi = (http: HttpClient) => ({
  modules: () => http.get<ModuleInfo[]>('/modules'),
  accounts: () => http.get<IntegrationAccount[]>('/integrations'),
  createAccount: (input: { moduleId: string; accountKey: string; name: string }) =>
    http.post<IntegrationAccount>('/integrations', input),
  setAccountStatus: (id: string, status: 'active' | 'disabled') =>
    http.patch<void>('/integrations/' + id, { status }),
  projectAccounts: (projectId: string) =>
    http.get<IntegrationAccount[]>('/projects/' + projectId + '/integrations'),
  linkAccount: (projectId: string, accountId: string) =>
    http.post<void>('/projects/' + projectId + '/integrations', { accountId }),
  unlinkAccount: (projectId: string, accountId: string) =>
    http.del<void>('/projects/' + projectId + '/integrations/' + accountId),
  summary: (moduleId: string, scope: { projectId: string; accountId: string; from: string; to: string }) =>
    http.get<ModuleSummary>('/modules/' + moduleId + '/summary', scope),
  finance: () =>
    http.get<{
      status: string
      message: string
      capabilities: { income: boolean; settlements: boolean; withdrawals: boolean }
    }>('/finance'),
})
