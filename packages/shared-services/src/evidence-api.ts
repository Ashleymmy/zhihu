import type { EvidenceApi } from '@zhihu-koc/shared-contracts/core'
import type { HttpClient } from './http'

export function createEvidenceApi(http: Pick<HttpClient, 'get' | 'post'>): EvidenceApi {
  const path = (memberId: string) => '/relations/members/' + encodeURIComponent(memberId)
  return {
    query: input => http.get('/evidence', input),
    history: (memberId, input) => http.get(path(memberId) + '/history-evidence', input),
    save: (memberId, input) => http.post(path(memberId) + '/history-evidence', input),
    member: memberId => http.get(path(memberId)),
    members: () => http.get('/team/members'),
  }
}
