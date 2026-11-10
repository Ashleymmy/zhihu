<script setup lang="ts">
import { computed, inject, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import { createRequestKey } from '@zhihu-koc/shared-utils'
import type { PageResult, SettlementDocument, SettlementPaymentLinkPreview, SettlementPaymentOverview, SettlementPaymentQuote, SettlementPaymentRow, SettlementPayMethod } from '@zhihu-koc/shared-contracts/core'
import type { CoreWorkspace } from './core-workspace'
import DetailDrawer from './DetailDrawer.vue'
import RecordComments from './RecordComments.vue'
import { cashAmount, cashUnits, earningMoney as money } from './platform-earnings'
import { apiMessage, isDefinitiveRejection } from './settlement-request'
import { editablePaymentAllocations, paymentCommentContext, paymentHistoryAmounts, paymentOperation, type PaymentOperation } from './settlement-payment-state'



const props = defineProps<{ document: SettlementDocument; withdrawalId?: string }>()
const emit = defineEmits<{ updated: []; lock: [value: boolean]; review: []; recipient: [] }>()
const workspace = inject<CoreWorkspace>('opc')!, api = workspace.settlementPaymentApi!, http = workspace.http
const scope = computed(() => ({ moduleId: props.document.scope.moduleId, projectId: props.document.scope.projectId, accountId: props.document.scope.accountId, leaderId: props.document.scope.leaderId }))
const view = ref<SettlementPaymentOverview | null>(null), page = ref(1), loading = ref(false), busy = ref(false), error = ref(''), notice = ref('')
const mode = ref<'' | 'funding' | 'create' | 'legacy'>(''), fundingReference = ref(''), fundingAccepted = ref(false), recipientOpen = ref(false)
const applicant = reactive({ amount: '', receiverName: '', payMethod: 'wechat' as SettlementPayMethod, payAccount: '' })
const quote = ref<SettlementPaymentQuote | null>(null), accepted = ref(false)
const legacy = ref<(PageResult<SettlementPaymentRow> & { version: string }) | null>(null), legacyPage = ref(1), legacyBusy = ref(false), legacyError = ref(''), linkWithdrawalId = ref(''), linkPreview = ref<SettlementPaymentLinkPreview | null>(null), linkAccepted = ref(false)
const allocations = reactive<Record<string, string>>({})
const selected = ref<SettlementPaymentRow | null>(null), selectedError = ref(''), action = ref(''), reason = ref(''), proof = ref<File | null>(null), actualPaid = ref(false)
const recordFilter = ref<'all' | 'processing' | 'paid'>('all'), recordsAnchor = ref<HTMLElement | null>(null)
const invoiceInstructions = ref(''), invoiceReason = ref('')
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const payment = reactive({ reference: '', paidOn: today, remark: '', payMethod: 'wechat' as SettlementPayMethod, payAccount: '' })
const history = ref<Array<{ action: string; reason: string; createdAt: string }> | null>(null), historyError = ref('')
const settlementEvents = ref<Array<{ id: string; action: string; reason: string; createdAt: string; actorName: string; beforeData: unknown; afterData: unknown }>>([])
const historySourceNames = computed(() => new Map(view.value?.sources.map(source => [source.sourceId, source.businessDate + ' · ' + source.taskName]) || []))
const pending = shallowRef<PaymentOperation | null>(null)
const locked = computed(() => busy.value || !!pending.value)
const paymentLabels = { not_initiated: '尚未办理付款', processing: '付款办理中', partially_paid: '部分已付款', paid: '已付款', needs_review: '付款待核对' }
const rowLabels = { pending: '待审核', approved: '待实际付款', paid: '已登记付款', rejected: '已退回', cancelled: '已取消' }
const methodLabels = { wechat: '微信', alipay: '支付宝', bank: '银行卡' }
const invoiceLabels: Record<string, string> = { pending: '待财务核验', accepted: '已核验', rejected: '待补充发票' }
const selectedId = computed(() => selected.value?.withdrawalId || '')
const commentsContext = computed(() => paymentCommentContext(props.document.id, scope.value))
const comments = computed(() => { const context = JSON.parse(commentsContext.value) as { id: string; scope: typeof scope.value }; return selectedId.value ? api.comments(context.id, selectedId.value, context.scope) : null })
const canCreate = computed(() => !!view.value && view.value.policy.enabled && cashUnits(view.value.totals.availableAmount) >= 100n && cashUnits(view.value.policy.remainingAmount) >= 100n)
const recipientComments = computed(() => workspace.settlementApi?.comments('settlement', props.document.id, scope.value))
const canManageRecipient = computed(() => workspace.role.value === 'developer' || (workspace.role.value === 'admin' && workspace.duty?.value === 'all'))
const candidate = computed(() => editingLegacy.value?.withdrawalId === linkWithdrawalId.value ? editingLegacy.value : legacy.value?.list.find(row => row.withdrawalId === linkWithdrawalId.value))
let generation = 0, legacyGeneration = 0, requestedTarget = '', afterTarget = ''

watch([locked, mode, selected, recipientOpen], () => emit('lock', locked.value || !!mode.value || !!selected.value || recipientOpen.value))
watch(() => applicant.amount, () => { if (!pending.value) { quote.value = null; accepted.value = false } })
watch(() => [applicant.receiverName, applicant.payMethod, applicant.payAccount], () => { if (!pending.value) accepted.value = false })
watch([linkWithdrawalId, allocations], () => { if (!pending.value) { linkPreview.value = null; linkAccepted.value = false } }, { deep: true })

async function refresh() {
  const version = ++generation; loading.value = true; error.value = ''
  try {
    const data = await api.overview(props.document.id, { ...scope.value, page: page.value, pageSize: 10, paymentView: recordFilter.value })
    if (version !== generation) return
    view.value = data
    if (selected.value && !locked.value && !action.value) selected.value = data.payments.find(row => row.withdrawalId === selected.value!.withdrawalId) || selected.value
  } catch (e) { if (version === generation) error.value = apiMessage(e, '付款进度暂未加载，请重新读取。') }
  finally { if (version === generation) loading.value = false }
}
async function showRelatedPayments(filter: 'all' | 'processing' | 'paid') {
  if (locked.value) return
  recordFilter.value = filter; page.value = 1
  await refresh(); await nextTick()
  recordsAnchor.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }); recordsAnchor.value?.focus({ preventScroll: true })
}
async function mutate(label: string, send: (requestKey: string) => Promise<unknown>, success: (result: unknown) => void = () => {}) {
  if (busy.value) return
  pending.value = paymentOperation(pending.value, label, send, success, createRequestKey)
  await retry()
}
async function retry() {
  if (!pending.value || busy.value) return
  const request = pending.value; busy.value = true; error.value = ''; selectedError.value = ''; notice.value = ''
  try {
    const response = await request.send()
    pending.value = null
    request.success(response)
    notice.value = request.label + '已完成。'
  } catch (e) {
    const message = apiMessage(e, '暂未收到确定结果，请用原内容重试。')
    error.value = message; selectedError.value = message
    if (isDefinitiveRejection(e)) { pending.value = null; if (Number((e as { status?: number })?.status) === 409) { quote.value = null; linkPreview.value = null; accepted.value = false; linkAccepted.value = false } }
    return
  } finally { busy.value = false }
  await refresh(); emit('updated')
  if (afterTarget) { const id = afterTarget; afterTarget = ''; await openTarget(id) }
}
function closeForm() { if (locked.value) return; mode.value = ''; quote.value = null; linkPreview.value = null; error.value = '' }
function beginFunding() { mode.value = 'funding'; fundingReference.value = ''; fundingAccepted.value = false; error.value = '' }
function beginCreate() {
  mode.value = 'create'; applicant.amount = ''; applicant.receiverName = props.document.recipient.name; applicant.payMethod = 'wechat'; applicant.payAccount = ''; quote.value = null; accepted.value = false; error.value = ''
}
async function release() {
  if (!view.value || !fundingAccepted.value) return
  const id = props.document.id, input = { ...scope.value, expectedVersion: view.value.version, reference: fundingReference.value.trim() }
  await mutate('开放所选款项', key => api.funding(id, { ...input, requestKey: key }), () => { mode.value = '' })
}
async function quotePayment() {
  if (!view.value || locked.value) return
  busy.value = true; error.value = ''
  try { quote.value = await api.quote(props.document.id, { ...scope.value, amount: applicant.amount, expectedVersion: view.value.version }); accepted.value = false }
  catch (e) { error.value = apiMessage(e, '费用与到账金额未能核对，请重试。'); quote.value = null }
  finally { busy.value = false }
}
async function createPayment() {
  if (!quote.value || !accepted.value) return
  const id = props.document.id, input = { ...scope.value, ...applicant, amount: quote.value.amount, quoteToken: quote.value.quoteToken, expectedVersion: quote.value.expectedVersion, policyVersion: quote.value.policyVersion }
  await mutate('建立付款办理记录', key => api.create(id, { ...input, requestKey: key }), result => { afterTarget = (result as { withdrawalId: string }).withdrawalId; mode.value = ''; quote.value = null; page.value = 1 })
}
function choose(row: SettlementPaymentRow) {
  if (locked.value) return
  selected.value = row; action.value = ''; selectedError.value = ''; reason.value = ''; proof.value = null; actualPaid.value = false; history.value = null; settlementEvents.value = []; historyError.value = ''
  payment.reference = row.paymentReference || ''; payment.paidOn = row.paidOn || today; payment.remark = ''; payment.payMethod = row.payMethod; payment.payAccount = row.payAccount || ''
  invoiceInstructions.value = row.invoiceInstructions || ''
  invoiceReason.value = ''
}
function closePayment() { if (!locked.value) { selected.value = null; action.value = ''; selectedError.value = '' } }
async function openTarget(id: string) {
  if (!id || locked.value) return
  error.value = ''
  try {
    const data = await api.overview(props.document.id, { ...scope.value, withdrawalId: id, pageSize: 10 })
    const found = data.payments.find(row => row.withdrawalId === id)
    if (!found) throw new Error('这笔付款不在当前结算范围，或你已无权查看。请核对提醒中的收款人和项目。')
    view.value = data; page.value = data.page; recordFilter.value = 'all'
    choose(found)
  } catch (e) { error.value = apiMessage(e, '指定的付款记录暂未加载，请重新打开。') }
}
function operation(next: string) { action.value = next; reason.value = ''; selectedError.value = ''; proof.value = null; actualPaid.value = false }
async function reviewPayment(decision: 'approve' | 'reject') {
  if (!selected.value) return
  const path = '/finance/withdrawals/' + encodeURIComponent(selected.value.withdrawalId) + '/review', input = { ...scope.value, action: decision, reason: reason.value }
  await mutate(decision === 'approve' ? '审核付款' : '退回申请', () => http.post(path, input), () => { selected.value = null; action.value = '' })
}
async function paymentAction(kind: 'cancel' | 'failed' | 'retry') {
  if (!selected.value || !view.value) return
  const id = props.document.id, withdrawalId = selected.value.withdrawalId, input = { ...scope.value, expectedVersion: view.value.version, action: kind, reason: reason.value }
  await mutate(kind === 'cancel' ? '取消付款办理' : kind === 'failed' ? '保存付款失败原因' : '恢复原付款办理', key => api.action(id, withdrawalId, { ...input, requestKey: key }), () => { selected.value = null; action.value = '' })
}
async function savePayment() {
  if (!selected.value || !actualPaid.value) return
  const row = selected.value, path = '/finance/withdrawals/' + encodeURIComponent(row.withdrawalId) + '/pay', input = { ...scope.value, ...payment, acknowledged: 'true', ...(row.policyVersion ? { policyVersion: row.policyVersion, netAmount: row.netAmount } : {}) }, file = proof.value
  if (file && file.size > 5 * 1024 * 1024) { selectedError.value = '凭证超过 5 MB，请选择较小的图片或 PDF。'; return }
  let body: FormData | null = null
  await mutate('登记实际付款', key => {
    if (!body) { body = new FormData(); for (const [name, value] of Object.entries({ ...input, requestKey: key })) body.append(name, value); if (file) body.append('proof', file) }
    return http.postForm(path, body)
  }, () => { selected.value = null; action.value = '' })
}
async function correctPayment() {
  if (!selected.value) return
  const row = selected.value, path = '/finance/withdrawals/' + encodeURIComponent(row.withdrawalId) + '/correct', input = { ...scope.value, ...payment, action: action.value, expectedVersion: row.paymentVersion, reason: reason.value }
  await mutate('保存付款更正', key => http.post(path, { ...input, requestKey: key }), () => { selected.value = null; action.value = '' })
}
async function loadHistory() {
  if (!selected.value) return
  historyError.value = ''; const id = selected.value.withdrawalId
  try { const data = await http.get<{ list: NonNullable<typeof history.value>; settlementEvents?: typeof settlementEvents.value }>('/finance/withdrawals/' + encodeURIComponent(id) + '/history', scope.value); if (selected.value?.withdrawalId === id) { history.value = data.list; settlementEvents.value = data.settlementEvents || [] } }
  catch (e) { historyError.value = apiMessage(e, '付款记录暂未加载，请重试。') }
}
function saveBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
async function download(row: SettlementPaymentRow, kind: 'proof' | 'invoice') {
  try { const blob = await http.getBlob('/finance/withdrawals/' + encodeURIComponent(row.withdrawalId) + '/' + kind + '?' + new URLSearchParams(scope.value)); saveBlob(blob, kind === 'proof' ? row.proofName || '付款凭证' : '发票') }
  catch (e) { const message = apiMessage(e, '文件暂未读取，请重试下载。'); if (selected.value) selectedError.value = message; else error.value = message }
}
async function exportScope() {
  if (locked.value) return
  busy.value = true; error.value = ''
  try { const blob = await api.export(props.document.id, scope.value); saveBlob(blob, '结算明细_' + props.document.scope.from + '_' + props.document.scope.to + (blob.type.includes('spreadsheet') ? '.xlsx' : '.csv')); notice.value = '已导出当前收款人与周期的完整核对明细。' }
  catch (e) { error.value = apiMessage(e, '导出暂未完成，请重试。') }
  finally { busy.value = false }
}
async function saveInvoiceInstructions() {
  if (!selected.value) return
  const path = '/finance/withdrawals/' + encodeURIComponent(selected.value.withdrawalId) + '/invoice-instructions', input = { ...scope.value, instructions: invoiceInstructions.value }
  await mutate('保存开票要求', () => http.post(path, input), () => { selected.value = null })
}
async function reviewInvoice(decision: 'accept' | 'reject') {
  if (!selected.value) return
  const path = '/finance/withdrawals/' + encodeURIComponent(selected.value.withdrawalId) + '/invoice-review', input = { ...scope.value, expectedVersion: selected.value.invoiceVersion, action: decision, reason: invoiceReason.value }
  await mutate('核验发票', () => http.post(path, input), () => { selected.value = null })
}
async function loadLegacy() {
  const version = ++legacyGeneration; legacyBusy.value = true; legacyError.value = ''
  try { const data = await api.legacy(props.document.id, { ...scope.value, page: legacyPage.value, pageSize: 10 }); if (version === legacyGeneration) legacy.value = data }
  catch (e) { if (version === legacyGeneration) legacyError.value = apiMessage(e, '待核对的历史付款暂未加载，请重试。') }
  finally { if (version === legacyGeneration) legacyBusy.value = false }
}
const editingLegacy = ref<SettlementPaymentRow | null>(null)
async function beginLegacy(row?: SettlementPaymentRow) {
  mode.value = 'legacy'; legacyPage.value = 1; editingLegacy.value = row || null; linkWithdrawalId.value = row?.withdrawalId || ''; linkPreview.value = null; Object.keys(allocations).forEach(key => delete allocations[key]); selected.value = null; action.value = ''
  if (row) Object.assign(allocations, editablePaymentAllocations(row))
  await loadLegacy()
}
function linkInput() { return { ...scope.value, withdrawalId: linkWithdrawalId.value, allocations: Object.entries(allocations).filter(([, amount]) => amount.trim()).map(([sourceId, amount]) => ({ sourceId, amount })) } }
async function previewLink() {
  busy.value = true; error.value = ''
  try { linkPreview.value = await api.previewLink(props.document.id, linkInput()); linkAccepted.value = false }
  catch (e) { error.value = apiMessage(e, '付款与收益的对应关系未能核对，请检查金额后重试。') }
  finally { busy.value = false }
}
async function confirmLink() {
  if (!linkPreview.value || !linkAccepted.value) return
  const id = props.document.id, input = { ...linkInput(), expectedVersion: linkPreview.value.version }
  await mutate('保存付款对应关系', key => api.link(id, { ...input, requestKey: key }), () => { mode.value = ''; linkPreview.value = null })
}
async function openFailedPayment() {
  if (locked.value) return
  error.value = ''; loading.value = true
  try {
    for (let p = 1; ; p++) {
      const data = await api.overview(props.document.id, { ...scope.value, page: p, pageSize: 50 })
      const row = data.payments.find(item => item.canRetry)
      if (row) { choose(row); return }
      if (p * data.pageSize >= data.total) { await refresh(); notice.value = '待重试的付款已更新，请查看最新进度。'; return }
    }
  } catch (e) { error.value = apiMessage(e, '待重试付款暂未加载，请重试。') }
  finally { loading.value = false }
}
function blockerAction(action: string) { if (action === 'funding') beginFunding(); else if (action === 'link') void beginLegacy(); else if (action === 'recipient') recipientOpen.value = true; else if (action === 'review_sources') emit('review') }
watch(() => [props.document.id, props.document.scope.moduleId, props.document.scope.projectId, props.document.scope.accountId, props.document.scope.leaderId], async () => {
  generation++; legacyGeneration++; recordFilter.value = 'all'; view.value = null; selected.value = null; mode.value = ''; quote.value = null; pending.value = null; page.value = 1; notice.value = ''; requestedTarget = ''
  await refresh()
  if (props.withdrawalId) { requestedTarget = props.withdrawalId; await openTarget(props.withdrawalId) }
}, { immediate: true })
watch(() => props.withdrawalId, id => { if (id && id !== requestedTarget && view.value) { requestedTarget = id; void openTarget(id) } })
</script>

<template>
  <section class="settlement-payments" :aria-busy="loading || busy">
    <header class="payment-heading"><div><h3>付款办理</h3><p>{{ document.recipient.name }} · {{ document.scope.from }} 至 {{ document.scope.to }}</p></div><div class="actions"><button :disabled="locked" @click="exportScope">导出本次完整明细</button><button :disabled="locked || loading" @click="refresh">刷新付款进度</button></div></header>
    <p v-if="notice" role="status">{{ notice }}</p>
    <div v-if="error" class="error" role="alert"><p>{{ error }}</p><button v-if="!pending" :disabled="busy" @click="refresh">重新读取付款进度</button></div>
    <div v-if="pending" class="attention" role="status"><p>正在核实「{{ pending.label }}」的结果，原内容已保留。</p><button :disabled="busy" @click="retry">{{ busy ? '正在处理…' : '用原内容重试' }}</button></div>
    <p v-if="loading && !view">正在读取付款进度…</p>
    <template v-if="view">
      <p class="status">{{ paymentLabels[view.paymentStatus] }}</p>
      <div class="metrics"><button @click="emit('review')" :disabled="locked"><span>本期已确认</span><strong>{{ money(view.totals.confirmedAmount) }}</strong><small>查看来源与更正</small></button><button :disabled="locked || loading" @click="showRelatedPayments('processing')"><span>本期办理中</span><strong>{{ money(view.totals.processingAmount) }}</strong><small>查看办理中的付款记录</small></button><button :disabled="locked || loading" @click="showRelatedPayments('paid')"><span>本期已付</span><strong>{{ money(view.totals.paidGrossAmount) }}</strong><small>实际到账 {{ money(view.totals.paidNetAmount) }}</small><small>查看实际登记及凭证</small></button><button @click="emit('review')" :disabled="locked"><span>本期尚未办理</span><strong>{{ money(view.totals.remainingAmount) }}</strong><small>现在可办理 {{ money(view.totals.availableAmount) }} · 查看收益来源</small></button></div>
      <p v-if="cashUnits(view.totals.residualAmount) > 0n" class="muted">不足一分的余额 ¥{{ cashAmount(view.totals.residualAmount) }} 继续保留，累计后可办理。</p>
      <p v-if="cashUnits(view.totals.legacyUnallocatedAmount) > 0n" class="attention">另有 {{ money(view.totals.legacyUnallocatedAmount) }} 历史申请尚未确认对应周期，已按原记录占用资金。<button :disabled="locked" @click="beginLegacy()">核对历史付款</button></p>
      <article v-for="(blocker, index) in view.blockers" :key="index" class="attention"><p>{{ blocker.reason }}</p><p>下一步：{{ blocker.next }}</p><button v-if="blocker.kind === 'failure'" :disabled="locked || loading" @click="openFailedPayment">查看待重试付款</button><button v-if="blocker.action !== 'none'" :disabled="locked" @click="blockerAction(blocker.action)">{{ { funding: '办理款项开放', link: '核对历史付款', review_sources: '查看收益来源', recipient: '查看收款人资料' }[blocker.action] }}</button></article>
      <div v-if="!mode" class="actions next-step"><button v-if="cashUnits(view.funding.amount) > 0n" class="primary" :disabled="locked" @click="beginFunding">开放本次款项 {{ money(view.funding.amount) }}</button><button v-else-if="canCreate" class="primary" :disabled="locked" @click="beginCreate">为这位收款人办理付款</button><p v-else-if="!view.payments.length && !view.blockers.length">本次没有可办理款项。下一步：财务核对收益来源。</p><button v-if="cashUnits(view.funding.amount) > 0n && canCreate" :disabled="locked" @click="beginCreate">先办理已开放部分</button><button :disabled="locked" @click="beginLegacy()">查看历史付款对应关系</button></div>
      <form v-if="mode === 'funding'" class="flow-form" @submit.prevent="release"><h4>开放本次款项</h4><p>仅开放 {{ document.recipient.name }} 在当前收益范围内的 {{ money(view.funding.amount) }}。</p><fieldset :disabled="locked"><label>单号或说明（选填）<input v-model="fundingReference" maxlength="255" /></label><label class="check"><input v-model="fundingAccepted" type="checkbox" required />已核对这些款项，资金已经备妥</label></fieldset><div class="actions"><button class="primary" :disabled="locked || !fundingAccepted">确认开放这些款项</button><button type="button" :disabled="locked" @click="closeForm">返回</button></div></form>
      <form v-if="mode === 'create'" class="flow-form" @submit.prevent="quote ? createPayment() : quotePayment()"><h4>为 {{ document.recipient.name }} 办理付款</h4><div class="rules"><p v-for="line in view.policy.lines" :key="line">{{ line }}</p><p v-if="view.policy.enabled">今日剩余额度 {{ money(view.policy.remainingAmount) }}，可办理款项 {{ money(view.totals.availableAmount) }}。</p></div><fieldset :disabled="locked"><label>本次扣减余额（元）<input v-model="applicant.amount" inputmode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" required /></label><label>实际收款人姓名<input v-model="applicant.receiverName" maxlength="128" required /></label><label>收款方式<select v-model="applicant.payMethod"><option value="wechat">微信</option><option value="alipay">支付宝</option><option value="bank">银行卡</option></select></label><label>收款账号<input v-model="applicant.payAccount" maxlength="128" required autocomplete="off" /></label></fieldset><section v-if="quote" class="rules"><h4>核对本次付款</h4><p>扣减余额 {{ money(quote.amount) }} · 费用 {{ money(quote.feeAmount) }}</p><strong>实际应付 {{ money(quote.netAmount) }}</strong><p v-if="quote.reviewDeadline">审核截止 {{ quote.reviewDeadline }}；最迟结算 {{ quote.settlementDeadline }}。</p><p v-if="quote.invoiceRequired">本笔需按原申请要求核验发票后付款。</p><details><summary>查看本次对应的收益</summary><p v-for="item in quote.allocations" :key="item.sourceId">{{ item.businessDate }} · {{ view.sources.find(source => source.sourceId === item.sourceId)?.taskName || '收益来源' }} · {{ money(item.amount) }}</p></details><label class="check"><input v-model="accepted" type="checkbox" :disabled="locked" required />已核对收款资料、费用及实际应付金额</label></section><div class="actions"><button class="primary" :disabled="locked || (!!quote && !accepted)">{{ quote ? '确认建立付款办理记录' : '核对费用和到账金额' }}</button><button type="button" :disabled="locked" @click="closeForm">返回</button></div></form>
      <section v-if="mode === 'legacy'" class="flow-form"><h4>核对历史付款对应关系</h4><p>按原付款凭证选择收益，核对后再保存。保存对应关系不会再次付款或扣减余额。</p><div v-if="legacyError" role="alert"><p>{{ legacyError }}</p><button :disabled="legacyBusy" @click="loadLegacy">重新读取历史付款</button></div><p v-if="legacyBusy">正在读取历史付款…</p><p v-if="legacy && !legacy.total">当前没有可核对的历史付款。</p><form @submit.prevent="linkPreview ? confirmLink() : previewLink()"><fieldset :disabled="locked || legacyBusy"><label>选择原付款或提现申请<select v-model="linkWithdrawalId" required><option value="">请选择需要核对的记录</option><option v-if="editingLegacy && !legacy?.list.some(row => row.withdrawalId === editingLegacy!.withdrawalId)" :value="editingLegacy.withdrawalId">{{ editingLegacy.recipientName }} · 原已关联付款 · {{ money(editingLegacy.amount) }}</option><option v-for="row in legacy?.list" :key="row.withdrawalId" :value="row.withdrawalId">{{ row.recipientName }} · {{ rowLabels[row.status] }} · {{ money(row.amount) }} · {{ row.paidOn || '尚未付款' }} · {{ row.paymentReference || '未填流水号' }}</option></select></label><div v-if="legacy && legacy.total > legacy.pageSize" class="pager"><button type="button" :disabled="legacyPage === 1" @click="legacyPage--;linkWithdrawalId='';loadLegacy()">上一页付款</button><span>第 {{ legacyPage }} 页</span><button type="button" :disabled="legacyPage * legacy.pageSize >= legacy.total" @click="legacyPage++;linkWithdrawalId='';loadLegacy()">下一页付款</button></div><button v-if="candidate?.proofName" type="button" :disabled="locked" @click="download(candidate, 'proof')">查看原付款凭证</button><p v-if="candidate">原记录 {{ money(candidate.amount) }}；尚未对应收益 {{ money(candidate.unallocatedAmount) }}。收款方式 {{ methodLabels[candidate.payMethod] }}。</p><section v-if="editingLegacy" class="rules"><h4>原对应关系</h4><p v-for="item in editingLegacy.allocations" :key="item.sourceId">{{ item.businessDate }} · {{ view.sources.find(source => source.sourceId === item.sourceId)?.taskName || '收益来源' }} · {{ money(item.amount) }}{{ item.editable ? '' : '（其他周期，当前范围不修改）' }}</p><p>填写新的对应金额；填 0 撤销该项原对应，留空则保持原值。</p></section><div v-if="linkWithdrawalId" class="source-list"><label v-for="source in view.sources" :key="source.sourceId"><span>{{ source.businessDate }} · {{ source.taskName }} · 原确认 {{ money(source.originalConfirmedAmount) }} · 当前确认 {{ money(source.currentConfirmedAmount) }} · 可核对 {{ money(source.remainingAmount) }}</span><small v-if="source.reason">{{ source.reason }}</small><input v-model="allocations[source.sourceId]" inputmode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" placeholder="本笔对应金额；填 0 撤销原对应" /></label></div></fieldset><section v-if="linkPreview" class="rules"><h4>本次将保存的对应关系</h4><p v-for="item in linkPreview.allocations" :key="item.sourceId">{{ item.businessDate }} · {{ view.sources.find(source => source.sourceId === item.sourceId)?.taskName || '收益来源' }} · {{ money(item.amount) }}</p><strong>对应金额 {{ money(linkPreview.totalAmount) }}</strong><p v-for="warning in linkPreview.warnings" :key="warning">{{ warning }}</p><label class="check"><input v-model="linkAccepted" type="checkbox" :disabled="locked" required />已按原记录核实这些收益，确认保存对应关系</label></section><div class="actions"><button v-if="linkWithdrawalId" class="primary" :disabled="locked || (!!linkPreview && !linkAccepted)">{{ linkPreview ? '确认保存对应关系' : '预览对应关系' }}</button><button type="button" :disabled="locked" @click="closeForm">返回</button></div></form></section>
      <div ref="recordsAnchor" tabindex="-1" class="actions"><h4>{{ recordFilter === 'paid' ? '本期已付：实际登记及凭证' : recordFilter === 'processing' ? '本期办理中的付款记录' : '本期付款记录' }}</h4><button v-if="recordFilter !== 'all'" :disabled="locked" @click="showRelatedPayments('all')">查看全部本期记录</button></div><p v-if="loading" role="status">正在读取相关付款记录…</p><div v-if="!loading && !error" class="payment-rows"><button v-for="row in view.payments" :key="row.withdrawalId" class="payment-row" :disabled="locked" @click="choose(row)"><span><b>{{ row.recipientName }}</b><small>发起经办：{{ row.initiatorName || (row.initiatedBy ? '原记录未留存' : '本人申请') }}</small><small v-if="row.status === 'paid'">付款登记：{{ row.paidByName || '原记录未留存' }}</small></span><span class="tag" :data-state="row.failureReason ? 'failed' : row.status">{{ row.failureReason ? '付款待重试' : rowLabels[row.status] }}</span><span>本期对应 {{ money(row.allocatedAmount) }}<small>整笔实际应付 {{ money(row.netAmount) }}</small></span><small>{{ row.next }}</small><span>查看详情与办理 →</span></button></div><p v-if="!view.payments.length && !loading && !error" class="muted">{{ recordFilter === 'all' ? '还没有与本期收益对应的付款记录。可从上方办理付款或核对历史记录。' : '本期没有这类付款记录，可查看全部记录或核对收益来源。' }}<button v-if="recordFilter !== 'all'" :disabled="locked" @click="emit('review')">查看收益来源</button></p><div v-if="view.total > view.pageSize" class="pager"><button :disabled="locked || loading || page === 1" @click="page--;refresh()">上一页</button><span>第 {{ page }} 页 · 共 {{ view.total }} 笔</span><button :disabled="locked || loading || page * view.pageSize >= view.total" @click="page++;refresh()">下一页</button></div>
    </template>
    <DetailDrawer :open="recipientOpen" title="收款人状态核对" @close="recipientOpen=false"><div class="payment-detail"><h3>{{ document.recipient.name }}</h3><p>当前账号状态或角色不能办理付款。下一步：完整管理员核对账号资料，处理后财务可继续原结算。</p><router-link v-if="canManageRecipient" :to="{path:'/members',query:{member:document.scope.leaderId}}">打开这位收款人的成员资料</router-link><RecordComments v-if="recipientComments" :api="recipientComments" title="请完整管理员跟进账号状态" /></div></DetailDrawer><DetailDrawer :open="!!selected" :title="selected ? selected.recipientName + '的付款办理' : '付款办理'" @close="closePayment"><section v-if="selected" class="payment-detail"><p class="status">{{ selected.failureReason ? '付款待重试' : rowLabels[selected.status] }}</p><p>本期对应 {{ money(selected.allocatedAmount) }} · 整笔扣减 {{ money(selected.amount) }} · 费用 {{ money(selected.feeAmount) }}</p><strong>整笔实际应付 {{ money(selected.netAmount) }}</strong><p>{{ selected.receiverName || selected.recipientName }} · {{ methodLabels[selected.payMethod] }} · {{ selected.payAccount || '收款账号待补齐' }}</p><p>发起经办：{{ selected.initiatorName || (selected.initiatedBy ? '原记录未留存' : '本人申请') }}</p><div v-if="selected.status === 'paid'" class="rules"><p>实际付款日期：{{ selected.paidOn || '原记录未留存' }}</p><p>付款流水：{{ selected.paymentReference || '未填写' }}</p><p>付款登记：{{ selected.paidByName || '原记录未留存' }}</p><button v-if="selected.proofName" :disabled="locked" @click="download(selected, 'proof')">查看本次付款凭证</button></div><p v-if="selected.reviewDeadline">审核截止 {{ selected.reviewDeadline }} · 最迟结算 {{ selected.settlementDeadline }}</p><p v-if="selected.failureReason" class="attention">{{ selected.failureReason }}</p><p>{{ selected.next }}</p><p v-if="selectedError" class="error" role="alert">{{ selectedError }}</p><div v-if="pending" class="attention"><p>原办理内容已保留，请等待结果或原样重试。</p><button :disabled="busy" @click="retry">{{ busy ? '正在办理…' : '用原内容重试' }}</button></div>
      <div v-if="!action" class="actions"><button v-if="selected.status === 'pending' && !selected.failureReason" class="primary" :disabled="locked" @click="operation('approve')">审核这笔付款</button><button v-else-if="selected.status === 'approved' && !selected.failureReason && (!selected.invoiceRequired || selected.invoiceStatus === 'accepted')" class="primary" :disabled="locked" @click="operation('pay')">登记实际付款</button><button v-if="selected.canRetry" class="primary" :disabled="locked" @click="operation('retry')">继续原付款办理</button><button v-if="selected.status === 'pending'" :disabled="locked" @click="operation('reject')">退回申请</button><button v-if="selected.canCancel" :disabled="locked" @click="operation('cancel')">取消这笔办理</button><button v-if="selected.initiatedBy && ['pending','approved'].includes(selected.status) && !selected.failureReason" :disabled="locked" @click="operation('failed')">登记付款失败</button><button v-if="selected.status === 'paid'" :disabled="locked" @click="operation('amend')">更正付款资料</button><button v-if="selected.status === 'paid'" :disabled="locked" @click="operation('void')">撤销付款标记</button></div>
      <form v-if="['approve','reject','cancel','failed','retry'].includes(action)" class="flow-form" @submit.prevent="action === 'approve' || action === 'reject' ? reviewPayment(action) : paymentAction(action as 'cancel' | 'failed' | 'retry')"><p v-if="action === 'cancel'">仅取消尚未实际付款的办理，释放原占用及原申请日额度。请先核实没有转出款项。</p><p v-if="action === 'failed'">确认本次未转出款项后记录失败。金额继续保留，后续使用原记录重试。</p><p v-if="action === 'retry'">继续使用原付款记录、费用和期限，不会重复扣减余额。</p><label>{{ ['reject','cancel','failed'].includes(action) ? '原因' : '备注（选填）' }}<textarea v-model="reason" :required="['reject','cancel','failed'].includes(action)" maxlength="500" :disabled="locked" /></label><div class="actions"><button class="primary" :disabled="locked">{{ { approve: '确认审核通过', reject: '确认退回', cancel: '确认取消未付款办理', failed: '保存失败原因', retry: '继续原付款办理' }[action] }}</button><button type="button" :disabled="locked" @click="action=''">返回详情</button></div></form>
      <form v-if="['pay','amend','void'].includes(action)" class="flow-form" @submit.prevent="action === 'pay' ? savePayment() : correctPayment()"><p v-if="action === 'void'" class="attention">仅撤销系统中的付款标记，恢复待付款状态；不会退回已转出的款项。请核实后再办理。</p><fieldset :disabled="locked"><template v-if="action !== 'void'"><label>实际付款日期<input v-model="payment.paidOn" type="date" :max="today" required /></label><label>付款方式<select v-model="payment.payMethod"><option value="wechat">微信</option><option value="alipay">支付宝</option><option value="bank">银行卡</option></select></label><label>实际收款账号<input v-model="payment.payAccount" maxlength="128" required /></label><label>流水号（选填）<input v-model="payment.reference" maxlength="128" /></label><label>备注（选填）<input v-model="payment.remark" maxlength="500" /></label><label v-if="action === 'pay'">付款凭证（图片或 PDF，最大 5 MB）<input type="file" accept=".png,.jpg,.jpeg,.pdf" @change="proof=($event.target as HTMLInputElement).files?.[0] || null" /></label></template><label v-if="action !== 'pay'">更正原因<textarea v-model="reason" required maxlength="500" /></label><label v-else class="check"><input v-model="actualPaid" type="checkbox" required />已经实际转账，收款账号和实际应付金额已核对</label></fieldset><div class="actions"><button class="primary" :disabled="locked || (action === 'pay' && !actualPaid)">{{ action === 'pay' ? '保存实际付款及凭证' : '保存更正记录' }}</button><button type="button" :disabled="locked" @click="action=''">返回详情</button></div></form>
      <section v-if="selected.invoiceRequired" class="rules"><h4>原申请的发票要求</h4><p>{{ invoiceLabels[selected.invoiceStatus || ''] || '待提供发票' }}</p><p v-if="selected.invoiceReason" class="error">{{ selected.invoiceReason }}</p><button v-if="selected.invoiceName" :disabled="locked" @click="download(selected, 'invoice')">查看已提交发票</button><template v-if="['pending','approved'].includes(selected.status)"><label>开票要求<textarea v-model="invoiceInstructions" maxlength="2000" :disabled="locked" /></label><button :disabled="locked || !invoiceInstructions.trim()" @click="saveInvoiceInstructions">保存开票要求</button><label>核验备注／退回原因<input v-model="invoiceReason" maxlength="500" :disabled="locked" /></label><div class="actions"><button :disabled="locked" @click="reviewInvoice('accept')">核验发票通过</button><button :disabled="locked || !invoiceReason.trim()" @click="reviewInvoice('reject')">退回补充发票</button></div></template></section>
      <div class="actions"><button v-if="!selected.initiatedBy && ['pending','approved','paid'].includes(selected.status)" :disabled="locked" @click="beginLegacy(selected)">更正对应收益</button><button v-if="selected.proofName" :disabled="locked" @click="download(selected, 'proof')">查看付款凭证</button><button :disabled="locked" @click="loadHistory">查看登记与更正记录</button></div><div v-if="historyError" role="alert"><p>{{ historyError }}</p><button @click="loadHistory">重新读取记录</button></div><section v-if="history"><p v-if="!history.length && !settlementEvents.length">还没有付款登记或更正记录。</p><p v-for="(item, index) in history" :key="index">{{ new Date(item.createdAt).toLocaleString('zh-CN') }} · {{ { void: '撤销付款标记', amend: '更正付款资料', pay: '登记付款' }[item.action] || '付款处理' }} · {{ item.reason || '已保存' }}</p></section>
            <section v-if="settlementEvents.length" class="history-events"><h4>办理与对应关系记录</h4><article v-for="event in settlementEvents" :key="event.id"><b>{{ { create: '建立付款办理', funding: '开放款项', cancel: '取消办理', failed: '登记付款失败', retry: '继续付款办理', link: '核对付款对应收益' }[event.action] || '付款办理更新' }}</b><p>{{ event.actorName }} · {{ new Date(event.createdAt).toLocaleString('zh-CN') }}</p><p v-if="event.reason">{{ event.reason }}</p><template v-if="event.action === 'link'"><p v-for="(entry,index) in paymentHistoryAmounts(event.beforeData,historySourceNames)" :key="'before'+index">原对应：{{ entry.title }} · {{ money(entry.amount) }}</p><p v-for="(entry,index) in paymentHistoryAmounts(event.afterData,historySourceNames)" :key="'after'+index">现对应：{{ entry.title }} · {{ money(entry.amount) }}</p></template></article></section>
      <RecordComments v-if="comments" :api="comments" title="这笔付款的沟通" />
    </section></DetailDrawer>
  </section>
</template>

<style scoped>
.settlement-payments{display:grid;gap:16px;min-width:0;padding-top:24px;border-top:1px solid var(--line,#e8e6dc)}.payment-heading,.actions,.pager{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:space-between}.payment-heading h3,.payment-heading p,.payment-detail p,.flow-form p{margin:0}.payment-heading p,.muted,small{color:var(--ink-soft,#5e5d59);font-size:13px}.actions{justify-content:flex-start}.settlement-payments button,.payment-detail button{min-height:44px;padding:10px 14px;border:1px solid var(--line,#e8e6dc);border-radius:9px;color:inherit;background:var(--paper,#fff);font:inherit;cursor:pointer;white-space:normal;max-width:100%}.settlement-payments button:disabled,.payment-detail button:disabled{opacity:.5;cursor:default}.settlement-payments .primary,.payment-detail .primary{background:var(--ink,#24231f);color:var(--paper,#fff);border-color:var(--ink,#24231f)}.status{font-weight:600}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metrics article,.metrics button{padding:16px;background:var(--paper-deep,#f3f1ea);border-radius:12px;min-width:0;text-align:left}.metrics span,.metrics strong,.metrics small{display:block}.metrics strong{font-size:23px;margin:8px 0;overflow-wrap:anywhere}.attention,.rules{padding:14px;background:var(--paper-deep,#f3f1ea);border-radius:10px;display:grid;gap:10px;min-width:0;overflow-wrap:anywhere}.attention p,.rules p,.rules h4{margin:0}.error{color:#a23b2a;overflow-wrap:anywhere}.flow-form,.flow-form form,.flow-form fieldset,.payment-detail,.payment-detail label{display:grid;gap:14px;min-width:0}.flow-form{padding:18px;border:1px solid var(--line,#e8e6dc);border-radius:12px}.flow-form h4{margin:0}.flow-form fieldset{padding:0;margin:0;border:0}.flow-form label,.rules label{display:grid;gap:7px;min-width:0}.flow-form input,.flow-form select,.flow-form textarea,.payment-detail input,.payment-detail select,.payment-detail textarea{box-sizing:border-box;width:100%;min-width:0;max-width:100%;min-height:44px;padding:10px;border:1px solid var(--line,#d6d3c7);border-radius:7px;background:var(--paper,#fff);color:inherit;font:inherit}.flow-form textarea,.payment-detail textarea{min-height:80px;resize:vertical}.flow-form .check,.rules .check,.payment-detail .check{display:flex;align-items:flex-start;gap:9px}.check input{width:18px;height:18px;min-height:18px;flex:0 0 18px;margin:3px 0}.payment-rows,.source-list{display:grid;gap:9px}.settlement-payments .payment-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;text-align:left;padding:16px}.payment-row>span:first-child{flex:1;min-width:140px}.payment-row small{display:block}.payment-row>small{flex-basis:100%}.tag{border-radius:8px;padding:4px 9px;background:#e8eee6;color:#365b38}.tag[data-state=pending],.tag[data-state=approved]{background:#f8efda;color:#825d12}.tag[data-state=failed]{background:#f6e6e1;color:#a23b2a}.tag[data-state=cancelled],.tag[data-state=rejected]{background:#efeeea;color:#5e5d59}.source-list label{padding:12px;border:1px solid var(--line);border-radius:9px}.payment-detail{overflow-wrap:anywhere}.payment-detail .flow-form{padding:0;border:0}.payment-detail .actions{margin:8px 0}.next-step p{margin:0}.pager{justify-content:flex-end}@media(max-width:650px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.metrics article,.metrics button{padding:12px}.metrics strong{font-size:20px}.payment-heading>div{min-width:0}.flow-form{padding:14px}.settlement-payments .payment-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.payment-row>span:first-child,.payment-row>small,.payment-row>span:last-child{grid-column:1/-1}.payment-row>span:nth-child(3){grid-column:1/-1}.payment-row>span:first-child{min-width:0}.pager span{flex:1}.payment-detail input[type=file]{font-size:13px}}
</style>
