import type { CommentApi, EvidenceRow, SettlementApi, SettlementPaymentApi } from '@zhihu-koc/shared-contracts/core'
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

export function createSettlementPaymentApi(http: Http & Pick<HttpClient, 'getBlob'>): SettlementPaymentApi<Blob> {
  const path = (id: string) => '/settlements/' + encodeURIComponent(id)
  const paymentPath = (id: string, withdrawalId: string) => path(id) + '/payments/' + encodeURIComponent(withdrawalId)
  return {
    overview: (id, input) => http.get(path(id) + '/payments', input),
    quote: (id, input) => http.post(path(id) + '/payment-quote', input),
    create: (id, input) => http.post(path(id) + '/payments', input),
    funding: (id, input) => http.post(path(id) + '/funding', input),
    action: (id, withdrawalId, input) => http.post(paymentPath(id, withdrawalId) + '/action', input),
    legacy: (id, input) => http.get(path(id) + '/legacy-payments', input),
    previewLink: (id, input) => http.post(path(id) + '/payment-links/preview', input),
    link: (id, input) => http.post(path(id) + '/payment-links', input),
    comments: (id, withdrawalId, scope) => createCommentApi(http, paymentPath(id, withdrawalId) + '/comments', scope),
    export: (id, input) => http.getBlob(path(id) + '/export?' + new URLSearchParams({ ...input })),
  }
}
