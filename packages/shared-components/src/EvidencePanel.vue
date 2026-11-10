<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from 'vue'
import type { EvidenceAction, EvidenceQuery, EvidenceResult, EvidenceRow, HistoryTarget } from '@zhihu-koc/shared-contracts/core'
import type { CoreWorkspace } from './core-workspace'
import DetailDrawer from './DetailDrawer.vue'
import HistoryEvidenceForm from './HistoryEvidenceForm.vue'
import RecordComments from './RecordComments.vue'
import { evidenceDateRanges, evidenceHistoryTarget } from './history-evidence'
import { earningMoney } from './platform-earnings'
const props = defineProps<{ scope: Pick<EvidenceQuery, 'projectId' | 'moduleId' | 'accountId'>; from?: string; to?: string; taskRef?: string }>()
const emit = defineEmits<{ updated: []; action: [action: EvidenceAction] }>()
const workspace = inject<CoreWorkspace>('opc')!
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const filter = reactive({ from: props.from || today.slice(0, 8) + '01', to: props.to || today, metricType: '' })
const data = ref<EvidenceResult | null>(null), selected = ref<EvidenceRow | null>(null), history = ref<HistoryTarget | null>(null)
const loading = ref(false), error = ref(''), page = ref(1), segment = ref(0)
const ranges = ref<{ from: string; to: string }[]>([])
let generation = 0
const officialLabels: Record<EvidenceRow['official']['status'], string> = { ready: '资料已到', valid_zero: '已核对为零', not_arrived: '资料尚未到', record_missing: '缺少对应记录', conflict: '来源数字待核对', withdrawn: '来源已撤回', processing: '正在处理', unknown: '资料待核实' }
const checkLabels = { work: '作品登记', historicalOwnership: '历史归属', projectParticipation: '项目参与', pricing: '计费资料', existingCalculation: '已有计算' }
const canAction = (action: EvidenceAction) => action.requiredDuty === 'finance' ? ['admin', 'developer'].includes(workspace.role.value) && workspace.duty?.value !== 'operations' : ['admin', 'operator', 'developer'].includes(workspace.role.value) && workspace.duty?.value !== 'finance'
const range = computed(() => ranges.value[segment.value])
const comments = computed(() => selected.value && workspace.evidenceComments?.({ ...selected.value.key, moduleId: props.scope.moduleId }))
async function load(reset = false) {
  const version = ++generation
  loading.value = true; error.value = ''; data.value = null
  try {
    if (reset) { page.value = 1; segment.value = 0 }
    ranges.value = evidenceDateRanges(filter.from, filter.to)
    if (!workspace.evidenceApi || !range.value) throw new Error('资料服务暂未接通，请刷新后重试。')
    const result = await workspace.evidenceApi.query({ ...props.scope, ...range.value, page: page.value, pageSize: 20, ...(filter.metricType ? { metricType: filter.metricType } : {}), ...(props.taskRef ? { taskRef: props.taskRef } : {}) })
    if (version === generation) data.value = result
  } catch (e) { if (version === generation) error.value = e && typeof e === 'object' && 'message' in e ? String(e.message) : '资料暂时没加载出来，请重试。' }
  finally { if (version === generation) loading.value = false }
}
watch(() => [props.scope.projectId, props.scope.accountId, props.scope.moduleId, props.taskRef, props.from, props.to], () => { filter.from = props.from || filter.from; filter.to = props.to || filter.to; selected.value = null; history.value = null; void load(true) }, { immediate: true })
function perform(action: EvidenceAction) {
  if (!canAction(action)) return
  const target = evidenceHistoryTarget(action)
  if (target) history.value = target
  else { selected.value = null; emit('action', action) }
}
async function repaired() { history.value = null; selected.value = null; await load(); emit('updated') }
function inspect(row: EvidenceRow) { selected.value = row; history.value = null }
defineExpose({ reload: () => load() })
</script>
<template>
  <section class="evidence-panel" :aria-busy="loading">
    <form class="evidence-filters" @submit.prevent="load(true)"><label>开始日期<input v-model="filter.from" type="date" required /></label><label>结束日期<input v-model="filter.to" type="date" :min="filter.from" required /></label><label>业绩类型<select v-model="filter.metricType"><option value="">分别查看全部类型</option><option value="new_user">拉新</option><option value="activation">拉活</option></select></label><button :disabled="loading">核验资料</button></form>
    <div v-if="error" role="alert"><p>{{ error }}</p><button :disabled="loading" @click="load()">重新读取</button></div><p v-if="loading" role="status">正在核验来源与计算依据…</p>
    <div v-if="ranges.length > 1" class="evidence-pagination"><button :disabled="segment === 0 || loading" @click="segment--; page=1; load()">前一日期段</button><span>{{ range?.from }} 至 {{ range?.to }}</span><button :disabled="segment + 1 >= ranges.length || loading" @click="segment++; page=1; load()">后一日期段</button></div>
    <template v-if="data">
      <p class="evidence-note">按实际收到的资料核验。没有记录不等于业绩为零，尚未登记的报表内容仍在报表待办中处理。</p>
      <div v-if="!data.list.length" class="evidence-empty"><p>这段范围还没有可核验的已登记任务。可以调整日期，或继续处理已有报表待办。</p><button @click="load(true)">重新核验当前范围</button></div>
      <div class="evidence-rows"><button v-for="row in data.list" :key="JSON.stringify(row.key)" class="evidence-row" @click="inspect(row)"><span><b>{{ row.title }}</b><small>{{ row.key.businessDate }} · {{ row.key.metricType === 'activation' ? '拉活' : '拉新' }}</small></span><span class="evidence-status" :data-ready="row.result.status === 'ready'">{{ officialLabels[row.official.status] }}</span><span>{{ row.official.quantity === null ? '数量待核对' : row.official.quantity + row.official.quantityUnit }}</span><strong v-if="row.finance">{{ earningMoney(row.finance.amount) }}</strong><small>{{ row.result.reason }}</small><span>查看依据与下一步 →</span></button></div>
      <div class="evidence-pagination"><span>本日期段共 {{ data.total }} 条 · 第 {{ page }} 页</span><button :disabled="page === 1 || loading" @click="page--; load()">上一页</button><button :disabled="page * data.pageSize >= data.total || loading" @click="page++; load()">下一页</button></div>
    </template>
    <DetailDrawer :open="!!selected" :title="selected?.title || '核验资料'" @close="selected=null; history=null">
      <HistoryEvidenceForm v-if="history" :target="history" @updated="emit('updated')" @completed="repaired" @cancel="history=null" @stale="repaired" />
      <div v-else-if="selected" class="evidence-details">
        <p>{{ selected.key.businessDate }} · {{ selected.key.metricType === 'activation' ? '拉活' : '拉新' }} · {{ officialLabels[selected.official.status] }}</p>
        <strong v-if="selected.finance">应得金额 {{ earningMoney(selected.finance.amount) }}</strong>
        <p>{{ selected.result.reason }}</p>
        <article v-for="(check,key) in selected.checks" :key="key"><h3>{{ checkLabels[key] }}</h3><p>{{ check.reason }}</p><template v-if="check.nextAction"><p>下一步：{{ check.nextAction.requiredDuty === 'finance' ? '财务' : '运营' }}：{{ check.nextAction.label }}</p><button v-if="canAction(check.nextAction)" @click="perform(check.nextAction)">{{ check.nextAction.label }}</button></template></article>
        <article><h3>资料来源</h3><p v-if="!selected.official.sourceRefs.length">还没有可采用的官方记录。</p><ul><li v-for="(source,index) in selected.official.sourceRefs" :key="source.kind+source.id">来源 {{ index + 1 }}{{ source.line ? ' · 第 ' + source.line + ' 行' : '' }} · {{ source.status === 'pending' ? '待核对' : source.status === 'superseded' ? '已被后续记录更正' : '已保存' }}</li></ul><p v-if="selected.official.withdrawnSourceRefs?.length">另有 {{ selected.official.withdrawnSourceRefs.length }} 份已撤回来源，未作为当前有效依据。</p></article>
        <template v-if="selected.result.nextAction"><p>下一步：{{ selected.result.nextAction.requiredDuty === 'finance' ? '财务' : '运营' }}：{{ selected.result.nextAction.label }}</p><button v-if="canAction(selected.result.nextAction)" @click="perform(selected.result.nextAction)">{{ selected.result.nextAction.label }}</button></template>
        <RecordComments v-if="comments" :api="comments" title="资料核对沟通" />
      </div>
    </DetailDrawer>
  </section>
</template>
<style scoped>
.evidence-panel{min-width:0;display:grid;gap:16px}.evidence-panel p{margin:0}.evidence-filters{display:flex;gap:12px;align-items:end;flex-wrap:wrap}.evidence-filters label{display:grid;gap:6px;min-width:0}.evidence-filters input,.evidence-filters select{box-sizing:border-box;min-width:0;max-width:100%;min-height:44px;padding:9px;border:1px solid var(--line,#ddd);border-radius:8px;background:var(--paper,#fff);color:inherit;font:inherit}.evidence-panel button{min-height:44px;padding:10px 14px;border:1px solid var(--line,#ddd);border-radius:8px;background:var(--paper,#fff);color:inherit;font:inherit;cursor:pointer}.evidence-panel button:disabled{opacity:.55;cursor:default}.evidence-note{font-size:13px;color:var(--ink-soft,#666)}.evidence-rows{display:grid;gap:8px}.evidence-panel .evidence-row{display:flex;align-items:center;gap:12px;text-align:left;flex-wrap:wrap}.evidence-row>span:first-child{display:grid;gap:5px;flex:1;min-width:140px}.evidence-row small{color:var(--ink-soft,#666)}.evidence-row>small{flex-basis:100%}.evidence-status{color:#9a562c}.evidence-status[data-ready=true]{color:#397142}.evidence-pagination{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.evidence-details{display:grid;gap:18px;overflow-wrap:anywhere}.evidence-details article{border-top:1px solid var(--line,#ddd);padding-top:14px}.evidence-details h3{font-size:15px;margin:0 0 8px}.evidence-details button{margin-top:10px}.evidence-empty{display:grid;gap:12px;padding:20px;background:var(--paper-deep,#f3f1ea);border-radius:10px}@media(max-width:500px){.evidence-filters{display:grid;grid-template-columns:1fr 1fr}.evidence-filters label:nth-child(3){grid-column:1/-1}.evidence-filters input,.evidence-filters select{width:100%}.evidence-panel .evidence-row{display:grid;grid-template-columns:1fr 1fr}.evidence-row>span:first-child,.evidence-row>small,.evidence-row>span:last-child{grid-column:1/-1}}
</style>
