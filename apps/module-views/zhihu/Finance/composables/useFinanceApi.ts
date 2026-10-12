/**
 * Finance API Composable（v2，对齐 Codex 一期后端）
 * 后端：server/src/modules/zhihu/routes/attribution.ts + server/src/core/finance-routes.ts
 * 调用约定：模块域 context.http（/api/v1/modules/zhihu），核心域 context.coreHttp（/api/v1/core）
 * 幂等：写操作带 requestKey（crypto.randomUUID()）
 */
import type { EngineContext } from '../../context'
import { requestKey } from '../../context'

// ==================== 类型（与后端返回结构对齐） ====================

/** 账单明细行（GET /workbench?viewVersion=2 的 entries，对齐 bill-entry.ts） */
export type {BillEntry} from '../../bill-entry'
import type {BillEntry} from '../../bill-entry'

/** 单类型指标汇总（拉新/拉活分开） */
export interface MetricSummary {
  records:number
  confirmedPayable:string
  pendingPayable:string
  quantity: string
  billableQuantity: string
  pendingQuantity: string
  excludedQuantity: string
  payable: string
  reportedSettlement?: string | null
  reportedSettlementMissing?: number
  unpricedRecords?: number
}

/** GET /workbench（viewVersion=2）视图 */
export interface WorkbenchView {
  processingImports?: {id:string;fileName:string;pendingRows:number;status:'running'|'failed'}[]
  summary: {
    records:number
    totalRecords:number
    byType: { newUser: MetricSummary; activation: MetricSummary }
    staffAmount: string
  }
  entries: BillEntry[]
  groups: WorkbenchGroup[]
  reviewHash: string
  needsReview?: boolean
  withdrawal?: { enabled: boolean; message: string }
}

export interface WorkbenchGroup {
  payeeId: string
  name: string
  total: string
  confirmed: string
  pending: string
  blockers: string[]
  ready: number
}

/** GET /workbench/periods 账期行 */
export interface PeriodRow {
  id: string
  from: string
  to: string
  records: number
  newUserRecords: number
  activationRecords: number
}

/** 上传预览（POST /workbench/import/preview 响应） */
export interface ImportPreview {
  id: string
  from: string
  to: string
  duplicate: boolean
  previewHash: string
  total: number
  invalidRows: number
  rows: PreviewRow[]
  status: string
  reportType: 'new_user' | 'activation'
}

export interface PreviewRow {
  id: string
  lineNumber: number
  date: string
  channel: string
  keyword: string
  orders: string | null
  activations: string | null
  settlement: string | null
  error: string | null
  status: string
}

/** 确认任务进度（confirm jobId 协议） */
export interface ConfirmProgress {
  jobId: string | null
  status: 'done' | 'pending' | 'failed'
  confirmed: number
  waiting: number
  total: number
  remaining: number
  skipped: number
  error: string | null
}

/** 待办（GET /exceptions） */
export interface ExceptionItem {
  id: string
  factId: string
  batchId?:string
  normalizedJson?:{date?:string;keyword?:string}
  keyword?:string
  reasonCode?:string
  next?:string
  status: string
  kind?: string
  code?: string
  message?: string
  detail?: string
  reason?: string
  createdAt?: string
}

/** 修订（GET /metric-revisions） */
export interface RevisionItem {
  id: string
  factId: string
  status: string
  value: { date: string; channel: string; keyword: string; orders: number; search?: number }
  previousVersion: string
  version: string
  createdAt?: string
}

/** 追溯（GET /attributions/:id/trace） */
export interface TraceResult {
  fact: {
    id: string
    date: string
    channel: string
    keyword: string
    orders: number | null
    search?: number | null
    risk?: string | null
    allocations?: { userId: string; amount: string }[]
    bindingId?: string | null
    priceIds?: string[]
    error?: string | null
    lineNumber?: number
    fileName?: string
    batchId?: string
  }
  revisions: {
    id: string
    factId: string
    status: string
    createdAt?: string
    value: { date: string; channel: string; keyword: string; orders: number; search?: number }
  }[]
  ledger: {
    id: string
    kind: string
    userId: string
    amount: string
    reference?: string
    paidOn?: string
    createdAt?: string
  }[]
}

/** 成员金额异议（GET /objections，驼峰字段） */
export interface ObjectionItem {
  id: string
  factId: string
  payeeId?: string
  keyword: string
  displayName: string
  businessDate: string
  metricType: 'new_user' | 'activation' | string
  detail: string
  status: 'open' | 'replied' | string
  reply: string | null
  createdAt?: string
  repliedAt?: string | null
}

/** GET /core/finance 视图 */
export interface CoreFinanceView {
  balance: { available: string; offset?: string } | null
  withdrawals: WithdrawalRow[]
  total: number
  funding: { amount: string; hash: string }
  canManage: boolean
}

export type PayMethod = 'alipay' | 'wechat' | 'bank'

export interface WithdrawalRow {
  id: string
  userId: string
  displayName: string
  amount: string
  status: 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled'
  receiverName?: string | null
  bankName?: string | null
  bankAccount?: string | null
  payMethod?: PayMethod | null
  payAccount?: string | null
  remark?: string | null
  createdAt: string
  reviewedAt?: string | null
  paymentReference?: string | null
  paidOn?: string | null
  proofName?: string | null
  paidByName?: string | null
  paymentVersion?: number
}

export interface Page<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

// ==================== 金额工具（BigInt，对齐 bill-entry.ts） ====================

/** 4 位小数字符串 → BigInt 万分值 */
export function moneyValue(raw: string): bigint {
  const negative = raw.startsWith('-')
  const [whole = '0', fraction = ''] = raw.replace(/^-/, '').split('.')
  return (BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0').slice(0, 4))) * (negative ? -1n : 1n)
}

/** BigInt 万分值 → '1,234.56' */
export function cashText(value: bigint): string {
  const cents = ((value < 0n ? -value : value) + 50n) / 100n
  return (
    (value < 0n && cents ? '-' : '') +
    String(cents / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
    '.' +
    String(cents % 100n).padStart(2, '0')
  )
}

/** 金额显示：null/非法 → 待计算（禁止显示 ¥0） */
export function fmtMoney(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '待计算'
  try {
    return '¥' + cashText(moneyValue(v))
  } catch {
    return '待计算'
  }
}

/** 单价显示（4 位小数） */
export function fmtPrice(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '待计算'
  try {const n=moneyValue(String(v)),a=n<0n?-n:n;return '¥'+(n<0n?'-':'')+String(a/10000n)+'.'+String(a%10000n).padStart(4,'0')}catch{return '待计算'}
}

/** 支付方式标签 */
export function payMethodLabel(m?: PayMethod | string | null): string {
  return { alipay: '支付宝', wechat: '微信', bank: '银行卡' }[m as PayMethod] ?? (m || '')
}

// ==================== API ====================

export function useFinanceApi(context: EngineContext) {
  const { http, coreHttp, scope } = context
  const coreScope = () => ({ projectId:scope.projectId,accountId:scope.accountId,moduleId:'zhihu' })
  const attempts=new Map<string,string>()
  const fileKeys=new WeakMap<File,string>()
  async function mutate<T>(path:string,input:Record<string,unknown>,client=http):Promise<T>{
    const signature=path+JSON.stringify(input),key=attempts.get(signature)??requestKey();attempts.set(signature,key)
    try{const result=await client.post<T>(path,{...input,requestKey:key});attempts.delete(signature);return result}catch(e){if(typeof e==='object'&&e&&'status'in e&&Number(e.status)>=400&&Number(e.status)<500)attempts.delete(signature);throw e}
  }

  // ---------- 账期与工作台 ----------
  /** GET /workbench/periods 账期列表（每页 12 个月） */
  function getPeriods(page = 1) {
    return http.get<Page<PeriodRow>>('/workbench/periods', { ...scope, page })
  }

  /** GET /workbench?viewVersion=2 账期视图（拉新拉活分开汇总） */
  function getWorkbench(from: string, to: string, metricType?: 'new_user' | 'activation') {
    return http.get<WorkbenchView>('/workbench', {
      ...scope,
      from,
      to,
      viewVersion: '2',
      ...(metricType ? { metricType } : {}),
    })
  }

  // ---------- 上传两步 ----------
  /** POST /workbench/import/preview 上传并生成预览（multipart） */
  function uploadPreview(file: File, reportType: 'new_user' | 'activation') {
    const form = new FormData()
    form.append('file', file)
    form.append('projectId', scope.projectId)
    form.append('accountId', scope.accountId)
    form.append('reportType', reportType)
    const key=fileKeys.get(file)??requestKey();fileKeys.set(file,key);form.append('requestKey',key)
    return http.postForm<ImportPreview>('/workbench/import/preview', form)
  }

  /** GET /workbench/import/:id 读取预览行（分页，每页 100） */
  async function getImportRows(id:string,page=1,pageSize=100){
    const data=await http.get<{id:string;fileName:string;reportKind:string;status:string;counts:{processingStatus:string;total:number}[];rows:{id:string;lineNumber:number;normalizedJson:PreviewRow|string;errorText:string|null;processingStatus:string}[]}>('/imports/'+id,{...scope,page,pageSize})
    return {...data,total:data.counts.reduce((sum,c)=>sum+c.total,0),reportType:data.reportKind==='activation'?'activation' as const:'new_user' as const,rows:data.rows.map(r=>({...typeof r.normalizedJson==='string'?JSON.parse(r.normalizedJson):r.normalizedJson,id:r.id,lineNumber:r.lineNumber,error:r.errorText,status:r.processingStatus})) as PreviewRow[]}
  }

  /** POST /workbench/import/:id/commit 确认写入（幂等，202） */
  function commitImport(id: string, previewHash: string) {
    return mutate<{ id: string; status: string }>(`/workbench/import/${id}/commit`, {
      ...scope,
      previewHash,
    })
  }

  /** GET /imports/:id/file 原文件下载地址 */
  function getImportFile(id: string) {
    return http.getBlob(`/imports/${id}/file?${new URLSearchParams({projectId:scope.projectId,accountId:scope.accountId})}`)
  }

  // ---------- 待办与修订 ----------
  /** GET /exceptions 待处理异常（open） */
  function getExceptions(page = 1, pageSize = 50) {
    return http.get<Page<ExceptionItem>>('/exceptions', { ...scope, page, pageSize,status:'open' })
  }

  /** POST /exceptions/:id/retry 处理异常（重算归因并关闭） */
  function retryException(id: string, reason: string) {
    return http.post<{ id: string }>(`/exceptions/${id}/retry`, {
      ...scope,
      reason,
      requestKey: requestKey(),
    })
  }

  /** GET /metric-revisions 待核对修订 */
  function getRevisions(page = 1, pageSize = 50) {
    return http.get<Page<RevisionItem>>('/metric-revisions', { ...scope, page, pageSize })
  }

  /** POST /metric-revisions/:id/resolve 采纳或拒绝修订 */
  function resolveRevision(id: string, accept: boolean, reason: string) {
    return http.post<{ id: string }>(`/metric-revisions/${id}/${accept?'accept':'reject'}`, {
      ...scope,
      reason,
      requestKey: requestKey(),
    })
  }

  // ---------- 确认（一次操作 + jobId 分批轮询） ----------
  /** POST /workbench/confirm 一次提交全部就绪账单，返回 Progress（可能带 jobId） */
  function confirmBills(from: string, to: string, reviewHash: string, key:string) {
    return http.post<ConfirmProgress>('/workbench/confirm', {
      ...scope,
      from,
      to,
      viewVersion:'2',
      reviewHash,
      acknowledged: true,
      requestKey:key,
    })
  }

  /** GET /workbench/confirm/:id 轮询确认进度 */
  function getConfirmStatus(jobId: string) {
    return http.get<ConfirmProgress>(`/workbench/confirm/${jobId}`, { ...scope })
  }

  /** POST /workbench/confirm/:id/retry 重试失败任务（同一 requestKey 防重） */
  function retryConfirm(jobId: string) {
    return http.post<ConfirmProgress>(`/workbench/confirm/${jobId}/retry`, {
      ...scope,
      requestKey: requestKey(),
    })
  }

  // ---------- 追溯 ----------
  /** GET /attributions/:id/trace 三层追溯 */
  function traceAttribution(factId: string) {
    return http.get<TraceResult>(`/attributions/${factId}/trace`, { ...scope })
  }

  // ---------- 成员金额异议 ----------
  /** GET /objections 财务看全部；/objections/mine 成员看本人 */
  function listObjections(opts: { mine?: boolean; page?: number; pageSize?: number; status?: 'open' | 'replied' }) {
    return http.get<Page<ObjectionItem>>(opts.mine ? '/objections/mine' : '/objections', {
      ...scope,
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 25,
      ...(opts.status ? { status: opts.status } : {}),
    })
  }

  /** POST /objections 成员发起异议（factId 与 earningLineId 二选一） */
  function raiseObjection(input: { factId?: string; earningLineId?: string; detail: string }) {
    return http.post<{ id: string }>('/objections', {
      ...scope,
      ...input,
      requestKey: requestKey(),
    })
  }

  /** POST /objections/:id/reply 财务回复（回复后自动解除阻塞） */
  function replyObjection(id: string, reply: string) {
    return http.post<{ id: string }>(`/objections/${id}/reply`, {
      ...scope,
      reply,
      requestKey: requestKey(),
    })
  }

  // ---------- 款项与提现（核心域） ----------
  /** GET /core/finance 财务概览 */
  function getCoreFinance(page = 1) {
    return coreHttp.get<CoreFinanceView>('/finance', { ...coreScope(), page })
  }

  /** POST /core/finance/funding 款项核齐登记（reference 选填） */
  function releaseFunding(hash: string, reference?: string) {
    return coreHttp.post<{ amount: string }>('/finance/funding', {
      ...coreScope(),
      hash,
      reference: reference ?? '',
      requestKey: requestKey(),
    })
  }

  /** POST /core/finance/withdrawals 成员申请提现（payMethod 三选一） */
  function applyWithdrawal(input: {
    amount: string
    payMethod: PayMethod
    payAccount: string
    receiverName?: string
  }) {
    return coreHttp.post<{ id: string }>('/finance/withdrawals', {
      ...coreScope(),
      ...input,
      requestKey: requestKey(),
    })
  }

  /** POST /core/finance/withdrawals/:id/review 审核（approve/reject/cancel） */
  function reviewWithdrawal(id: string, action: 'approve' | 'reject' | 'cancel', reason?: string) {
    return coreHttp.post<{ id: string }>(`/finance/withdrawals/${id}/review`, {
      ...coreScope(),
      action,
      ...(reason ? { reason } : {}),
      requestKey: requestKey(),
    })
  }

  /**
   * POST /core/finance/withdrawals/:id/pay 登记已线下发放（multipart）
   * 后端已放宽：reference / proof 均选填；proof 为表单文件字段 'proof'（PNG/JPG/PDF ≤5MB）
   */
  function recordPayment(
    id: string,
    input: { paidOn: string; reference?: string; remark?: string; proof?: File | null },
  ) {
    const form = new FormData()
    const s = coreScope()
    form.append('moduleId', s.moduleId)
    form.append('projectId', s.projectId)
    form.append('accountId', s.accountId)
    form.append('paidOn', input.paidOn)
    if (input.reference) form.append('reference', input.reference)
    if (input.remark) form.append('remark', input.remark)
    form.append('acknowledged', 'true')
    form.append('requestKey', requestKey())
    if (input.proof) form.append('proof', input.proof)
    return coreHttp.postForm<{ id: string }>(`/finance/withdrawals/${id}/pay`, form)
  }

  /** POST /core/finance/withdrawals/:id/correct 更正发放记录（amend/void + 必填原因） */
  function correctPayment(
    id: string,
    input: {
      expectedVersion: number
      action: 'amend' | 'void'
      reason: string
      paidOn?: string
      reference?: string
      remark?: string
      payMethod?: PayMethod
      payAccount?: string
    },
  ) {
    return coreHttp.post<{ id: string }>(`/finance/withdrawals/${id}/correct`, {
      ...coreScope(),
      ...input,
      requestKey: requestKey(),
    })
  }

  /** GET /core/finance/withdrawals/:id/history 发放更正历史 */
  function getPaymentHistory(id: string) {
    return coreHttp.get<{ list: unknown[] }>(`/finance/withdrawals/${id}/history`, { ...coreScope() })
  }

  /** GET /core/finance/withdrawals/:id/proof 凭证下载（blob） */
  function getProofBlob(id: string) {
    return coreHttp.getBlob(`/finance/withdrawals/${id}/proof?${new URLSearchParams(coreScope()).toString()}`)
  }

  return {
    // 工具
    fmtMoney,
    fmtPrice,
    payMethodLabel,
    moneyValue,
    cashText,
    // 账期与工作台
    getPeriods,
    getWorkbench,
    // 上传
    uploadPreview,
    getImportRows,
    commitImport,
    getImportFile,
    // 待办与修订
    getExceptions,
    retryException,
    getRevisions,
    resolveRevision,
    // 确认
    confirmBills,
    getConfirmStatus,
    retryConfirm,
    // 追溯
    traceAttribution,
    // 异议
    listObjections,
    raiseObjection,
    replyObjection,
    // 款项与提现
    getCoreFinance,
    releaseFunding,
    applyWithdrawal,
    reviewWithdrawal,
    recordPayment,
    correctPayment,
    getPaymentHistory,
    getProofBlob,
  }
}

export type FinanceApi = ReturnType<typeof useFinanceApi>
