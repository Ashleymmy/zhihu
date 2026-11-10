<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from 'vue'
import { createRequestKey } from '@zhihu-koc/shared-utils'
import type { HistoryEvidenceInput, HistoryEvidenceResult, HistoryTarget } from '@zhihu-koc/shared-contracts/core'
import type { CoreWorkspace } from './core-workspace'
import { remainingHistoryTargets } from './history-evidence'
const props = defineProps<{ target: HistoryTarget }>()
const emit = defineEmits<{ updated: []; completed: []; cancel: []; stale: [] }>()
const workspace = inject<CoreWorkspace>('opc')!
const api = workspace.evidenceApi
const canEdit = computed(() => ['admin', 'operator', 'developer'].includes(workspace.role.value) && workspace.duty?.value !== 'finance')
const queue = ref<HistoryTarget[]>([]), data = ref<HistoryEvidenceResult | null>(null), name = ref(''), members = ref<{ id: string; displayName: string; role: string }[]>([])
const loading = ref(false), busy = ref(false), error = ref(''), notice = ref(''), outdated = ref(false), historyPage = ref(1)
const current = computed(() => queue.value[0])
const form = reactive({ participation: '', role: '', team: '', sourceKind: 'operator_confirmation', sourceRef: '', sourceSummary: '', supersedesId: '', confirmed: false })
let generation = 0, attempt: { memberId: string; body: HistoryEvidenceInput } | null = null
const labels = { matched: '已有依据', unknown: '需要补齐', conflict: '需要核对冲突' }
async function load() {
  const target = current.value, version = ++generation
  if (!target || !canEdit.value) return
  loading.value = true; error.value = ''; data.value = null; name.value = ''; outdated.value = false
  try {
    if (!api) throw new Error('资料服务暂未接通，请刷新后重试。')
    const [history, member, options] = await Promise.all([api.history(target.memberId, { projectId: target.projectId, at: target.at, page: historyPage.value, pageSize: 20 }), api.member(target.memberId), api.members()])
    if (version !== generation) return
    data.value = history; name.value = member.user.name; members.value = options
    outdated.value = history.version !== target.expectedVersion
    if (outdated.value) error.value = '资料已发生变化，请返回当前记录重新核对，再继续补齐。'
  } catch (e) { if (version === generation) error.value = e && typeof e === 'object' && 'message' in e ? String(e.message) : '资料暂时没加载出来，请重试。' }
  finally { if (version === generation) loading.value = false }
}
function resetForm() { Object.assign(form, { participation: '', role: '', team: '', sourceKind: 'operator_confirmation', sourceRef: '', sourceSummary: '', supersedesId: '', confirmed: false }); attempt = null; historyPage.value = 1 }
watch(() => props.target, target => { queue.value = [target]; notice.value = ''; resetForm(); void load() }, { immediate: true })
const missing = computed(() => current.value?.missingFields ?? (data.value ? [data.value.projectParticipation.status !== 'matched' ? 'projectParticipation' : '', data.value.role.status !== 'matched' ? 'role' : '', data.value.team.status !== 'matched' ? 'team' : ''].filter(Boolean) : []))
async function save() {
  const target = current.value
  if (!api || !target || busy.value || !canEdit.value || outdated.value) return
  busy.value = true; error.value = ''
  try {
    if (!attempt) {
      if (!form.participation && !form.role && !form.team) throw new Error('请选择本次已经核实的一项资料。')
      if (form.sourceSummary.trim().length < 2) throw new Error('请写明所核实的资料。')
      const verified = form.sourceKind === 'operator_confirmation'
      if (verified && (!form.confirmed || !form.sourceRef.trim())) throw new Error('请填写资料来源，并确认已核对原资料。')
      const body: HistoryEvidenceInput = {
        projectId: target.projectId, effectiveFrom: target.at, timePrecision: target.at.length === 10 ? 'date' : 'timestamp',
        sourceKind: verified ? 'operator_confirmation' : 'description', sourceSummary: form.sourceSummary.trim(), confirmed: verified && form.confirmed,
        ...(form.sourceRef.trim() ? { sourceRef: form.sourceRef.trim() } : {}), expectedVersion: target.expectedVersion, requestKey: createRequestKey(),
        ...(form.participation ? { participation: form.participation === 'yes' } : {}),
        ...(form.role ? { historicalRole: form.role as HistoryEvidenceInput['historicalRole'] } : {}),
        ...(form.team ? { leaderId: form.team === 'none' ? null : form.team } : {}),
        ...(verified && target.context ? { context: target.context } : {}),
        ...(verified && form.supersedesId ? { supersedesId: form.supersedesId } : {}),
      }
      attempt = { memberId: target.memberId, body }
    }
    const result = await api.save(attempt.memberId, attempt.body)
    attempt = null
    emit('updated')
    if (result.status === 'pending') {
      notice.value = '说明已保存为待核实，原记录仍保留待办。核对原资料后可继续办理。'
      queue.value = []; return
    }
    const next = remainingHistoryTargets(queue.value, result)
    if (!next.length) { notice.value = '资料已核实，系统已继续处理原记录。'; queue.value = []; emit('completed'); return }
    queue.value = next
    notice.value = '已保存核实结果，还有 ' + next.length + ' 项资料需要补齐。'
    resetForm(); await load()
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? Number(e.status) : 0
    if (status >= 400 && status < 500 && status !== 408) attempt = null
    if (status === 409) outdated.value = true
    error.value = e && typeof e === 'object' && 'message' in e ? String(e.message) : '保存结果暂时无法确认，请重试同一次保存。'
  } finally { busy.value = false }
}
</script>
<template>
  <section class="history-evidence" :aria-busy="loading || busy">
    <p v-if="!canEdit">下一步：运营：核实当时的成员资料。相关待办会保留，已就绪记录可以继续办理。</p>
    <template v-else>
      <p v-if="notice" role="status">{{ notice }}</p>
      <template v-if="current">
        <h3>{{ name ? name + '的历史资料' : '核实当时的资料' }}</h3>
        <p>{{ current.at }} · {{ current.reason || '按实际保存的资料核实，不改变当前团队关系。' }}</p>
        <p v-if="loading" role="status">正在读取已有依据…</p>
        <div v-if="error" role="alert"><p>{{ error }}</p><button v-if="outdated" type="button" @click="emit('stale')">返回记录重新核对</button><button v-else-if="!data" type="button" @click="load">重新读取</button></div>
        <template v-if="data">
          <dl class="history-status"><div><dt>项目参与</dt><dd>{{ labels[data.projectParticipation.status] }}</dd></div><div><dt>当时角色</dt><dd>{{ labels[data.role.status] }}</dd></div><div><dt>当时团队</dt><dd>{{ labels[data.team.status] }}</dd></div></dl>
          <details v-if="data.records.length || data.sources.length"><summary>查看已有来源与补充记录</summary><ul><li v-for="source in data.sources" :key="source.kind + source.ref">{{ source.from }}{{ source.to ? ' 至 ' + source.to : ' 起' }}{{ source.priorHistoryUnknown ? '，此前时间尚未核实' : '' }}</li><li v-for="item in data.records" :key="item.id">{{ item.sourceSummary }} · {{ item.status === 'verified' ? '已核实' : '待核实' }}</li></ul><div class="history-actions"><button type="button" :disabled="historyPage === 1 || loading" @click="historyPage--; load()">上一页</button><span>第 {{ historyPage }} 页</span><button type="button" :disabled="data.records.length < 20 || loading" @click="historyPage++; load()">下一页</button></div></details>
          <form @submit.prevent="save">
            <fieldset :disabled="busy || outdated || !!attempt">
              <label>当时是否参与项目<span v-if="missing.includes('projectParticipation')">需要补齐</span><select v-model="form.participation"><option value="">本次不补充</option><option value="yes">已参与</option><option value="no">未参与</option></select></label>
              <label>当时角色<span v-if="missing.includes('role')">需要补齐</span><select v-model="form.role"><option value="">本次不补充</option><option value="creator">达人</option><option value="leader">团长</option><option value="operator">运营</option><option value="admin">管理员</option><option value="developer">开发者</option></select></label>
              <label>当时所属团长<span v-if="missing.includes('team')">需要补齐</span><select v-model="form.team"><option value="">本次不补充</option><option value="none">当时没有所属团长</option><option v-for="member in members" :key="member.id" :value="member.id">{{ member.displayName }}</option></select></label>
              <label>这次保存什么<select v-model="form.sourceKind"><option value="operator_confirmation">已核对原资料，保存人工核实结果</option><option value="description">只保存说明，稍后核实</option></select></label>
<label v-if="form.sourceKind==='operator_confirmation' && data.records.some(r=>r.status==='verified')">更正已有资料<select v-model="form.supersedesId"><option value="">本次新增核实依据</option><option v-for="record in data.records.filter(r=>r.status==='verified')" :key="record.id" :value="record.id">{{record.sourceSummary}}</option></select></label>
              <label>资料来源<input v-model="form.sourceRef" :required="form.sourceKind === 'operator_confirmation'" maxlength="255" placeholder="例如原登记记录或存档文件位置" /></label>
              <label>核实内容<textarea v-model="form.sourceSummary" rows="3" required minlength="2" maxlength="2000" /></label>
              <label v-if="form.sourceKind === 'operator_confirmation'" class="history-check"><input v-model="form.confirmed" type="checkbox" required />我已核对原资料，以上内容与当时记录一致</label>
            </fieldset>
            <div class="history-actions"><button :disabled="busy || outdated" class="primary">{{ busy ? '正在保存…' : attempt ? '重试同一次保存' : form.sourceKind === 'description' ? '保存待核实说明' : '保存并继续处理' }}</button><button type="button" :disabled="busy" @click="emit('cancel')">先保留待办</button></div>
          </form>
        </template>
      </template>
      <button v-else type="button" @click="emit('cancel')">返回当前记录</button>
    </template>
  </section>
</template>
<style scoped>
.history-evidence{display:grid;gap:14px;min-width:0;overflow-wrap:anywhere}.history-evidence h3,.history-evidence p{margin:0}.history-evidence fieldset{display:grid;gap:14px;border:0;margin:0;padding:0;min-width:0}.history-evidence label{display:grid;gap:6px}.history-evidence label>span{font-size:12px;color:var(--sun,#a86a12)}.history-evidence input:not([type=checkbox]),.history-evidence select,.history-evidence textarea{box-sizing:border-box;width:100%;min-width:0;max-width:100%;min-height:44px;padding:10px;border:1px solid var(--line,#ddd);border-radius:8px;background:var(--paper,#fff);color:inherit;font:inherit}.history-evidence .history-check{display:flex;align-items:flex-start;gap:8px}.history-status{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0;padding:12px;background:var(--paper-deep,#f3f1ea);border-radius:10px}.history-status dd{margin:6px 0 0}.history-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}.history-evidence button{min-height:44px;padding:10px 14px;border:1px solid var(--line,#ddd);border-radius:8px;background:var(--paper,#fff);color:inherit;font:inherit;cursor:pointer}.history-evidence button.primary{background:var(--ink,#24231f);color:var(--paper,#faf9f5)}.history-evidence button:disabled{opacity:.55;cursor:default}@media(max-width:500px){.history-status{grid-template-columns:1fr}}
</style>
