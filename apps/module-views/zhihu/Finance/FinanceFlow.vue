<script setup lang="ts">
/**
 * 财务账期工作流入口（替代旧 Finance.vue 单页）
 * Workspace.vue 以 section==='finance' / 'wallet' 挂载本组件。
 * - wallet=false：财务视角 → 账期列表 → 账期详情（五步）
 * - wallet=true ：成员视角 → 钱包
 * 模块内部导航用状态机（对齐 demo 的 S.view / S.step），不走 vue-router。
 */
import { onMounted,provide,ref,watch } from 'vue'
import {FinanceHistoryLinks} from '@zhihu-koc/shared-components'
import type { EngineContext } from '../context'
import { usePeriodState } from './composables/usePeriodState'
import { useToast } from './composables/useToast'
import PeriodsView from './PeriodsView.vue'
import PeriodDetailView from './PeriodDetailView.vue'
import WalletView from './WalletView.vue'
import Toasts from './components/Toasts.vue'
import ReportHistory from './components/ReportHistory.vue'
import type {ImportBatch} from './composables/useFinanceApi'
import './styles.css'

const props = defineProps<{ context: EngineContext; wallet?: boolean;initialPeriod?:string;initialImportId?:string }>()

const emit=defineEmits<{navigate:[path:string]}>()
provide('financeNavigate',(path:string)=>emit('navigate',path))
const state = usePeriodState(props.context)
const { toast } = useToast()
const reportsOpen=ref(false),reportPeriod=ref(''),reportBusy=ref(false)
function openReports(period=''){if(state.confirmBusy.value)return;reportPeriod.value=period;reportsOpen.value=true}
async function openReport(batch:ImportBatch,action:'resume'|'analyze'){
 if(reportBusy.value)return
 reportBusy.value=true
 try{
  await state.openPeriod(batch.periodFrom?.slice(0,7)||state.periodId.value)
  if(state.error.value){toast(state.error.value);return}
  state.step.value=1;state.reportRequest.value={batch,action};reportsOpen.value=false
 }finally{reportBusy.value=false}
}
provide('financeOpenReports',openReports)

// 子组件统一注入：状态 + toast + context
provide('financeState', state)
provide('financeContext', props.context)
provide('financeToast', toast)
async function openInitialReport(id:string) {
 try {
  let found:ImportBatch|undefined
  for(let page=1;!found;page++){const data=await props.context.http.get<{list:ImportBatch[];total:number}>('/imports',{...props.context.scope,page,pageSize:100,archived:'false'});found=data.list.find(r=>r.id===id);if(page*100>=data.total)break;if(!data.list.length)throw new Error('上传记录尚未完整读取，请重新读取。')}
  if(!found)throw new Error('这份报表已隐藏或不在当前来源中，请查看上传记录。')
  await openReport(found,found.status==='preview'?'resume':'analyze')
 }
 catch(e){toast(e instanceof Error?e.message:'报表暂未读取，请在上传记录中重新查看。');openReports()}
}
watch(()=>props.initialImportId,id=>{if(id&&!props.wallet)void openInitialReport(id)})
onMounted(()=>{if(props.initialImportId&&!props.wallet)void openInitialReport(props.initialImportId);else if(!props.wallet&&props.initialPeriod&&/^\d{4}-\d{2}$/.test(props.initialPeriod))void state.openPeriod(props.initialPeriod)})
</script>

<template>
  <div class="finance-flow">
    <WalletView v-if="props.wallet" @navigate="emit('navigate',$event)"/>
    <template v-else>
      <div v-if="reportsOpen"><div class="row-actions" style="margin-bottom:16px"><button :disabled="reportBusy" @click="reportsOpen=false">{{state.view.value==='period'?'← 返回账期':'← 返回账期列表'}}</button></div><ReportHistory :period="reportPeriod" :disabled="reportBusy" @resume="openReport($event,'resume')" @analyze="openReport($event,'analyze')" @busy="reportBusy=$event"/></div>
      <PeriodDetailView v-else-if="state.view.value === 'period'" />
      <PeriodsView v-else />
    </template>
    <FinanceHistoryLinks v-if="!props.wallet"/>
    <Toasts />
  </div>
</template>
