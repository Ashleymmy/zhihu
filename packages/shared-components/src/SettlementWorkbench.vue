<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from 'vue'
import { createRequestKey } from '@zhihu-koc/shared-utils'
import type { EvidenceAction, HistoryTarget, PageResult, SettlementAccount, SettlementDocument, SettlementRecord, SettlementRecipient, SettlementReview, SettlementScope, SettlementSummary } from '@zhihu-koc/shared-contracts/core'
import type { CoreWorkspace } from './core-workspace'
import type { DataGridRow } from './data-grid'
import DataGrid from './DataGrid.vue'
import DetailDrawer from './DetailDrawer.vue'
import HistoryEvidenceForm from './HistoryEvidenceForm.vue'
import RecordComments from './RecordComments.vue'
import SettlementSavedLabel from './SettlementSavedLabel.vue'
import { evidenceDateRanges, evidenceHistoryTarget } from './history-evidence'
import { earningMoney as money } from './platform-earnings'
import { createMutationAttempt, isStaleSettlement, canPreviewSettlement, apiMessage } from './settlement-request'
const props = defineProps<{ scope: SettlementAccount; leaderId?: string; from?: string; to?: string }>()
const emit = defineEmits<{ context: [value: SettlementScope]; action: [value: EvidenceAction]; updated: []; lock: [value:boolean] }>()
const w = inject<CoreWorkspace>('opc')!, api = w.settlementApi!
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const filter = reactive({ leaderId: props.leaderId || '', from: props.from || today.slice(0, 8) + '01', to: props.to || today, metricType: '' })
const search = ref(''), recipientPage = ref(1), recipients = ref<PageResult<SettlementRecipient> | null>(null), recipientsBusy = ref(false), recipientError = ref('')
const review = ref<SettlementReview | null>(null), page = ref(1), status = ref('all'), loading = ref(false), error = ref(''), notice = ref(''), busy = ref(false), stale = ref(false), uncertain = ref(false)
const result = ref<SettlementDocument | null>(null), saved = ref<PageResult<SettlementSummary> | null>(null), savedPage = ref(1), savedError = ref(''), savedBusy = ref(false), resultPage = ref(1)
const source = ref<Awaited<ReturnType<typeof api.source>> | null>(null), selected = ref<SettlementRecord | null>(null), detailBusy = ref(false), detailError = ref(''), history = ref<HistoryTarget | null>(null), acknowledged = ref(false)
const previewAttempt = createMutationAttempt<Omit<Parameters<typeof api.preview>[0], 'requestKey'>>(createRequestKey)
const confirmAttempt = createMutationAttempt<Omit<Parameters<typeof api.confirm>[1], 'requestKey'>>(createRequestKey)
let generation = 0, recipientGeneration = 0, detailGeneration = 0
watch([busy,uncertain],()=>emit('lock',busy.value||uncertain.value))
const accountScope = (): SettlementAccount => ({ moduleId:props.scope.moduleId, projectId:props.scope.projectId, accountId:props.scope.accountId })
const scope = (): SettlementScope => ({ ...accountScope(), leaderId: filter.leaderId, from: filter.from, to: filter.to, ...(filter.metricType ? { metricType: filter.metricType } : {}) })
const recipientScope = computed(() => ({ ...accountScope(), leaderId: result.value?.scope.leaderId || review.value?.scope.leaderId || filter.leaderId }))
const totals = computed(() => result.value?.summary || review.value?.summary)
const comments = computed(() => source.value && (result.value || review.value) ? api.comments('source', source.value.record.id, (result.value || review.value)!.scope) : null)
const evidenceComments = computed(()=>source.value?.evidence ? w.evidenceComments?.({...source.value.evidence.key,moduleId:props.scope.moduleId}) : null)
const resultComments = computed(() => result.value ? api.comments('settlement', result.value.id, { moduleId: result.value.scope.moduleId, projectId: result.value.scope.projectId, accountId: result.value.scope.accountId, leaderId: result.value.scope.leaderId }) : null)
const labels = { ready: '可以确认', blocked: '待补齐', confirmed: '已确认' }
const rows = computed<DataGridRow[]>(() => (result.value ? result.value.items.map(i => i.record) : review.value?.list || []).map(r => ({ id: r.id, title: r.taskName, status: { key: r.status, label: labels[r.status], tone: r.status === 'blocked' ? 'warning' : 'success', description: r.reason }, cells: { date: r.businessDate, group: r.group === 'self' ? '本人收益' : '应得团队分成', performer: r.performerName, type: r.metricLabel, quantity: r.quantity === null ? '待核对' : r.quantity + r.quantityUnit, amount: money(r.amount), confirmed: money(r.confirmedAmount), delta: money(r.deltaAmount) }, next: { actor: '', text: r.next || (r.status === 'confirmed' ? '财务：查看确认结果' : '查看资料与计算依据'), action: { key: 'inspect', label: '查看来源' } } })))
async function loadRecipients() {
  const version = ++recipientGeneration; recipientsBusy.value = true; recipientError.value = ''
  try { const data = await api.recipients({ ...accountScope(), search: search.value, page: recipientPage.value, pageSize: 20 }); if (version === recipientGeneration) recipients.value = data }
  catch(e) { if (version === recipientGeneration) recipientError.value = apiMessage(e, '收款人暂未加载，请重试。') }
  finally { if (version === recipientGeneration) recipientsBusy.value = false }
}
async function loadSaved() {
  savedBusy.value = true; savedError.value = ''; saved.value = null
  try { saved.value = await api.list({ ...accountScope(), ...(filter.leaderId ? { leaderId: filter.leaderId } : {}), page: savedPage.value, pageSize: 10 }) }
  catch(e) { savedError.value = apiMessage(e, '已保存的核对结果暂未加载，请重试。') }
  finally { savedBusy.value = false }
}
async function load(reset = false) {
  if (uncertain.value || busy.value) return
  const version = ++generation; loading.value = true; error.value = ''; result.value = null; stale.value = false; acknowledged.value = false
  if (reset) { page.value = 1; savedPage.value = 1; status.value = 'all' }
  try {
    evidenceDateRanges(filter.from, filter.to)
    if (!filter.leaderId) throw new Error('请先选择本次要核对的团长或历史分成收款人。')
    const selectedScope = scope(); emit('context', selectedScope)
    const data = await api.review({ ...selectedScope, page: page.value, pageSize: 20, status: status.value })
    if (version === generation) review.value = data
    void loadSaved()
  } catch(e) { if (version === generation) { review.value = null; error.value = apiMessage(e, '核对资料暂未加载，请重试。') } }
  finally { if (version === generation) loading.value = false }
}
async function preview() {
  if (!review.value || busy.value || !canPreviewSettlement(review.value.summary)) return
  busy.value = true; error.value = ''; notice.value = ''
  try { result.value = await api.preview(previewAttempt.prepare({ ...review.value.scope, expectedReviewVersion: review.value.reviewVersion })); previewAttempt.complete(); uncertain.value = false; resultPage.value = 1; acknowledged.value = false; void loadSaved() }
  catch(e) { previewAttempt.reject(e); uncertain.value = !!previewAttempt.pending; stale.value = isStaleSettlement(e); error.value = stale.value ? '资料已更新，请重新核对后再生成确认预览。' : apiMessage(e, '暂未确认预览是否保存，请用原范围重试。') }
  finally { busy.value = false }
}
async function confirm() {
  if (!result.value || result.value.status !== 'preview' || (!acknowledged.value && !confirmAttempt.pending) || busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { result.value = await api.confirm(result.value.id, confirmAttempt.prepare({ ...recipientScope.value, expectedVersion: result.value.version })); confirmAttempt.complete(); uncertain.value = false; notice.value = '账目已确认。尚未发起付款。'; emit('updated'); void loadSaved() }
  catch(e) { confirmAttempt.reject(e); uncertain.value = !!confirmAttempt.pending; stale.value = isStaleSettlement(e); error.value = stale.value ? '来源或金额已有变化，本次预览已不能确认。请重新核对并查看新的影响范围。' : apiMessage(e, '尚未确认结果，请保留此页并用原内容重试。') }
  finally { busy.value = false }
}
async function openResult(id: string, atPage = 1) {
  if (busy.value || uncertain.value) return
  loading.value = true; error.value = ''; acknowledged.value = false
  try { const entry = saved.value?.list.find(x => x.id === id); result.value = await api.detail(id, { ...accountScope(), leaderId: entry?.scope.leaderId || result.value?.scope.leaderId || filter.leaderId, page: atPage, pageSize: 20 }); resultPage.value = atPage; stale.value = false }
  catch(e) { error.value = apiMessage(e, '核对结果暂未加载，请重试。') }
  finally { loading.value = false }
}
async function inspect(row: DataGridRow) {
  const record = (result.value?.items.map(i => i.record) || review.value?.list || []).find(r => r.id === row.id)
  if (!record) return
  selected.value = record; source.value = null; history.value = null; detailError.value = ''; detailBusy.value = true
  const version = ++detailGeneration
  try { const data = await api.source(record.id, result.value?.scope || review.value!.scope); if (version === detailGeneration) source.value = data }
  catch(e) { if (version === detailGeneration) detailError.value = apiMessage(e, '来源详情暂未加载，请重试。') }
  finally { if (version === detailGeneration) detailBusy.value = false }
}
function action(value: EvidenceAction) {
  if (value.requiredDuty === 'operations' && w.duty?.value === 'finance') return
  const target = evidenceHistoryTarget(value)
  if (target) history.value = target
  else { selected.value = null; emit('action', value) }
}
async function repaired() { history.value = null; selected.value = null; await load(); emit('updated') }
watch(() => [props.scope.moduleId, props.scope.projectId, props.scope.accountId], () => { filter.leaderId = props.leaderId || ''; filter.from = props.from || filter.from; filter.to = props.to || filter.to; review.value = null; result.value = null; previewAttempt.complete(); confirmAttempt.complete(); uncertain.value = false; void loadRecipients(); void loadSaved(); if (filter.leaderId) void load(true) }, { immediate: true })
</script>
<template>
  <section class="settlement-workbench panel">
    <header><h2>团长收益核对</h2><p>分别核对本人收益与应得团队分成。旧任务使用保存的归属。</p></header>
    <form class="filters" @submit.prevent="recipientPage=1; loadRecipients()"><label>查找收款人<input v-model="search" type="search" placeholder="团长或历史分成收款人" :disabled="uncertain || busy" /></label><button :disabled="recipientsBusy || uncertain || busy">查找</button></form>
    <div v-if="recipientError" role="alert"><p>{{ recipientError }}</p><button @click="loadRecipients">重新读取收款人</button></div>
    <form class="filters" @submit.prevent="load(true)"><fieldset :disabled="uncertain || busy || loading"><label>收款人<select v-model="filter.leaderId" required><option value="">选择收款人</option><option v-if="filter.leaderId && !recipients?.list.some(r=>r.id===filter.leaderId)" :value="filter.leaderId">{{ review?.recipient.name || result?.recipient.name || '当前选中收款人' }}</option><option v-for="r in recipients?.list" :key="r.id" :value="r.id">{{ r.name }}{{ r.active ? '' : '（历史收款人）' }}</option></select></label><label>开始日期<input v-model="filter.from" type="date" required /></label><label>结束日期<input v-model="filter.to" type="date" :min="filter.from" required /></label><label>业绩类型<select v-model="filter.metricType"><option value="">全部类型分别核对</option><option value="new_user">拉新</option><option value="activation">拉活</option></select></label><button :disabled="!filter.leaderId">核对这位收款人</button></fieldset></form>
    <div v-if="recipients && recipients.total > recipients.pageSize" class="pager"><button :disabled="recipientPage===1 || recipientsBusy" @click="recipientPage--;loadRecipients()">前一页收款人</button><span>第 {{ recipientPage }} 页</span><button :disabled="recipientPage*recipients.pageSize>=recipients.total || recipientsBusy" @click="recipientPage++;loadRecipients()">后一页收款人</button></div>
    <div v-if="error" role="alert"><p>{{ error }}</p><button v-if="stale" @click="load(true)" :disabled="busy">重新核对范围</button><button v-else-if="!uncertain" @click="load()" :disabled="loading || busy">重新读取</button></div><p v-if="notice" role="status">{{ notice }}</p><p v-if="loading" role="status">正在读取核对资料…</p><p v-if="busy" role="status">正在处理本次完整范围，请保留当前页面。结果返回前不改变范围。</p><p v-if="uncertain" role="status">尚未收到确定结果。请用原内容重试，系统会识别同一次办理。</p>
    <template v-if="totals">
      <h3>{{ result?.recipient.name || review?.recipient.name }} · {{ result?.scope.from || review?.scope.from }} 至 {{ result?.scope.to || review?.scope.to }}</h3>
      <div class="summary"><article><span>所选收款人应得</span><strong>{{ money(totals.amount) }}</strong><small v-if="totals.pendingCalculations">已核对部分 {{ money(totals.knownAmount) }} · {{ totals.pendingCalculations }} 条待核对</small></article><article><span>可以确认的金额</span><strong>{{ money(totals.confirmableAmount) }}</strong><small>{{ totals.ready }} 条可以确认 · {{ totals.blocked }} 条待补齐</small></article><article><span>已确认金额</span><strong>{{ money(totals.confirmedAmount) }}</strong><small>{{ totals.confirmed }} 条已确认，后续变化另记更正</small></article></div>
      <div class="groups"><article v-for="g in totals.groups" :key="g.group+g.metricType"><h4>{{ g.group === 'self' ? '本人收益' : '应得团队分成' }} · {{ g.metricLabel }}</h4><p>{{ g.quantity === null ? '数量待核对' : g.quantity + g.quantityUnit }} · {{ money(g.amount) }}</p><small v-if="g.pendingCalculations">已核对部分 {{ money(g.knownAmount) }}，另有 {{ g.pendingCalculations }} 条待核对。</small></article></div>
    </template>
    <template v-if="review && !result"><p>{{ review.coverage.message }}</p><article v-if="review.unresolvedContext?.records" class="notice"><h3>范围内另有 {{ review.unresolvedContext.records }} 条待确认归属</h3><p>{{ review.unresolvedContext.reason }}</p><p>{{ review.unresolvedContext.next }}</p><button v-if="review.unresolvedContext.nextAction && (w.duty?.value !== 'finance' || review.unresolvedContext.nextAction.requiredDuty === 'finance')" @click="action(review.unresolvedContext.nextAction)">{{ review.unresolvedContext.nextAction.label }}</button></article><label>记录状态<select v-model="status" @change="page=1;load()" :disabled="uncertain || busy"><option value="all">全部记录</option><option value="ready">可以确认</option><option value="blocked">待补齐</option><option value="confirmed">已确认</option></select></label></template>
    <template v-if="result"><h3>{{ result.status === 'confirmed' ? '已保存的确认结果' : '本次确认将影响的全部收款人' }}</h3><p>本次{{ result.status === 'confirmed' ? '已处理' : '将处理' }} {{ result.impactSummary.records }} 条来源，共 {{ result.impactSummary.recipients }} 位收款人；确认变动 {{ money(result.impactSummary.deltaAmount) }}。</p><div class="impacts"><article v-for="impact in result.impacts" :key="impact.payeeId"><b>{{ impact.payeeName }}{{ impact.selectedRecipient ? '（所选收款人）' : '' }}</b><p>应得 {{ money(impact.amount) }} · 原已确认 {{ money(impact.confirmedAmount) }} · 本次变动 {{ money(impact.deltaAmount) }}</p></article></div><p v-if="result.status === 'confirmed'" class="notice">账目已确认，尚未发起付款。这里的确认结果不代表已经到账。</p></template>
    <DataGrid v-if="review || result" :rows="rows" :busy="loading" title="收益核对明细" title-label="任务与来源" :columns="[{key:'date',label:'业务日期'},{key:'group',label:'收益构成'},{key:'performer',label:'执行人'},{key:'type',label:'业绩类型'},{key:'quantity',label:'数量'},{key:'amount',label:'应得金额',numeric:true},{key:'confirmed',label:'已确认',numeric:true},{key:'delta',label:'本次变动',numeric:true}]" :group-options="[{key:'status',label:'按状态'},{key:'group',label:'按收益构成'}]" empty-text="尚无可归属这位收款人的记录。请核对日期，并查看范围内待确认归属的资料。" :external-details="true" @inspect="inspect" @action="({row})=>inspect(row)" />
    <div v-if="result" class="pager"><span>共 {{ result.total }} 条 · 第 {{ resultPage }} 页</span><button :disabled="resultPage===1 || loading || uncertain || busy" @click="openResult(result.id,resultPage-1)">上一页</button><button :disabled="resultPage*result.pageSize>=result.total || loading || uncertain || busy" @click="openResult(result.id,resultPage+1)">下一页</button></div>
    <div v-else-if="review" class="pager"><span>共 {{ review.total }} 条 · 第 {{ page }} 页</span><button :disabled="page===1 || loading || uncertain || busy" @click="page--;load()">上一页</button><button :disabled="page*review.pageSize>=review.total || loading || uncertain || busy" @click="page++;load()">下一页</button></div>
    <div v-if="review && !result" class="settlement-actions"><p>待补齐记录继续保留；可以确认的部分单独进入预览。</p><button class="primary" :disabled="!canPreviewSettlement(review.summary) || busy || stale || loading" @click="preview">{{ busy ? '正在生成…' : uncertain ? '用原范围重试生成预览' : '预览本次确认' }}</button></div>
    <div v-if="result?.status === 'preview' && !stale" class="settlement-actions"><label><input v-model="acknowledged" type="checkbox" :disabled="busy || uncertain" />已核对本人、团队分成以及其他收款人的变化</label><button class="primary" :disabled="(!acknowledged && !uncertain) || busy || loading" @click="confirm">{{ busy ? '正在确认…' : uncertain ? '用原内容重试确认' : '确认这些账目' }}</button><button :disabled="busy || uncertain" @click="result=null;load()">返回核对</button></div>
    <RecordComments v-if="resultComments" :api="resultComments" title="本次财务核对沟通" />
    <details class="saved"><summary>查看已保存的核对与确认结果</summary><p v-if="savedBusy">正在读取…</p><div v-if="savedError" role="alert"><p>{{ savedError }}</p><button @click="loadSaved">重新读取结果</button></div><p v-if="saved && !saved.total">还没有保存的核对结果。先选择收款人及日期，核对后生成预览。</p><button v-for="item in saved?.list" :key="item.id" :disabled="uncertain || busy" @click="openResult(item.id)"><SettlementSavedLabel :item="item" /></button><div v-if="saved && saved.total>saved.pageSize" class="pager"><button :disabled="savedPage===1 || savedBusy" @click="savedPage--;loadSaved()">上一页结果</button><span>第 {{ savedPage }} 页</span><button :disabled="savedPage*saved.pageSize>=saved.total || savedBusy" @click="savedPage++;loadSaved()">下一页结果</button></div></details>
    <DetailDrawer :open="!!selected || !!history" :title="selected?.taskName || '补充历史依据'" @close="selected=null;history=null;detailGeneration++"><HistoryEvidenceForm v-if="history" :target="history" @completed="repaired" @updated="emit('updated')" @cancel="history=null" @stale="repaired" /><div v-else-if="selected" class="source-details"><p v-if="detailBusy">正在读取来源…</p><div v-if="detailError" role="alert"><p>{{ detailError }}</p><button @click="inspect(rows.find(r=>r.id===selected!.id)!)">重新读取来源</button></div><template v-if="source"><p>{{ source.record.businessDate }} · {{ source.record.metricLabel }} · {{ source.record.performerName }}</p><p>所选收款人应得 {{ money(source.record.amount) }}，已确认 {{ money(source.record.confirmedAmount) }}</p><p>{{ source.record.reason }}</p><article v-for="impact in source.impacts" :key="impact.payeeId"><b>{{ impact.payeeName }}</b><p>应得 {{ money(impact.amount) }} · 变动 {{ money(impact.deltaAmount) }}</p></article><template v-if="source.evidence"><h3>来源与计算依据</h3><article v-for="(check,key) in source.evidence.checks" :key="key"><p>{{ check.reason }}</p><p v-if="check.nextAction">下一步：{{ check.nextAction.requiredDuty === 'operations' ? '运营' : '财务' }}：{{ check.nextAction.label }}</p><button v-if="check.nextAction && (w.duty?.value !== 'finance' || check.nextAction.requiredDuty === 'finance')" @click="action(check.nextAction)">{{ check.nextAction.label }}</button></article></template><p v-else>当前来源没有可展示的完整核验资料，请按这条记录的下一步继续处理。</p><p>下一步：{{ source.record.next }}</p><button v-if="source.record.nextAction && (w.duty?.value !== 'finance' || source.record.nextAction.requiredDuty === 'finance')" @click="action(source.record.nextAction)">{{ source.record.nextAction.label }}</button><RecordComments v-if="evidenceComments" :api="evidenceComments" title="资料核对沟通（运营与财务）" /><RecordComments v-if="comments" :api="comments" title="这条财务记录的沟通" /></template></div></DetailDrawer>
  </section>
</template>
<style scoped>
.settlement-workbench{padding:24px;display:grid;gap:18px;min-width:0}.settlement-workbench h2,.settlement-workbench h3,.settlement-workbench h4,.settlement-workbench p{margin:0}.settlement-workbench header{display:grid;gap:8px}.settlement-workbench header p,.settlement-workbench small{color:var(--ink-soft)}.filters,.filters fieldset,.pager{display:flex;align-items:end;gap:12px;flex-wrap:wrap;min-width:0}.filters fieldset{padding:0;border:0;margin:0;width:100%}.filters label{display:grid;gap:6px;min-width:0}.settlement-workbench input:not([type=checkbox]),.settlement-workbench select{min-height:44px;padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:inherit;font:inherit;box-sizing:border-box;min-width:0;max-width:100%}.settlement-workbench button{min-height:44px;padding:10px 14px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);font:inherit;cursor:pointer}.settlement-workbench button:disabled{opacity:.5;cursor:default}.summary,.groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.summary article,.groups article{padding:16px;border:1px solid var(--line);border-radius:10px;display:grid;gap:8px}.summary strong{font-size:24px}.impacts,.source-details,.saved{display:grid;gap:12px;min-width:0;overflow-wrap:anywhere}.saved{grid-template-columns:minmax(0,1fr)}.impacts article,.source-details article{padding:12px;border-bottom:1px solid var(--line)}.notice{padding:14px;background:var(--paper-deep);border-radius:10px;display:grid;gap:8px}.settlement-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.settlement-actions p{flex-basis:100%}.settlement-actions label{flex:1}.settlement-workbench .primary{background:var(--ink);color:var(--paper)}.saved summary{cursor:pointer;padding:12px 0}.saved>button{display:block;text-align:left;width:100%;min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere}.pager{align-items:center}.source-details button{margin-top:8px}@media(max-width:600px){.settlement-workbench{padding:16px}.filters label{width:100%}.filters input,.filters select{width:100%}.summary,.groups{grid-template-columns:1fr}.settlement-actions{display:grid}.settlement-actions button{width:100%}.saved>button{overflow-wrap:anywhere}}
</style>
