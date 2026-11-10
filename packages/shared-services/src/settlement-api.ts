import type { CommentApi, EvidenceRow, SettlementApi } from '@zhihu-koc/shared-contracts/core'
import type { HttpClient } from './http'
type Http = Pick<HttpClient, 'get' | 'post'>
export function createCommentApi(http: Http, path: string, scope: object): CommentApi {
  return { list: query => http.get(path, { ...scope, ...query }), add: input => http.post(path, { ...scope, ...input }) }
}
export function createEvidenceCommentApi(http: Http, key: EvidenceRow['key'] & { moduleId: string }): CommentApi { return createCommentApi(http, '/record-comments', key) }
export function createSettlementApi(http: Http): SettlementApi {
  const path = (id: string) => '/settlements/' + encodeURIComponent(id)
  return {
    recipients: input => http.get('/settlements/recipients', input),
    review: input => http.get('/settlements/review', input),
    source: (id, scope) => http.get('/settlements/records/' + encodeURIComponent(id), scope),
    preview: input => http.post('/settlements/previews', input, { timeout: 60000 }),
    list: input => http.get('/settlements', input),
    detail: (id, input) => http.get(path(id), input),
    confirm: (id, input) => http.post(path(id) + '/confirm', input, { timeout: 60000 }),
    comments: (kind, id, scope) => createCommentApi(http, (kind === 'source' ? '/settlements/records/' + encodeURIComponent(id) : path(id)) + '/comments', scope),
  }
}
