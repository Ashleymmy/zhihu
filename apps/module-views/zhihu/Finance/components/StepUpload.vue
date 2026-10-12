<script setup lang="ts">
import {inject,onUnmounted,ref} from 'vue'
import type {PeriodState} from '../composables/usePeriodState'
import ReportPreview from './ReportPreview.vue'
import ReportHistory from './ReportHistory.vue'
import ReportAnalysis from '../../ReportAnalysis.vue'
import {errorText,requestKey} from '../../context'
import type {ReportAnswer} from '../../report-analysis'
import type {AnalysisRunModel} from '@zhihu-koc/shared-components'
const state=inject<PeriodState>('financeState')!,preview=ref<InstanceType<typeof ReportPreview>>(),history=ref<InstanceType<typeof ReportHistory>>()
const analysis=ref<AnalysisRunModel|null>(null),error=ref(''),busyAsk=ref(''),askErrors=ref<Record<string,string>>({})
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false,version=0
async function analyze(id:string){const current=++version;if(timer)clearTimeout(timer);error.value='';try{const r=await state.context.http.get<AnalysisRunModel>('/imports/'+id+'/analysis',state.context.scope);if(disposed||current!==version)return;analysis.value=r;state.importing.value=r.status==='running';if(r.status==='running')timer=setTimeout(()=>void analyze(id),1500);else{await state.loadPeriod();await history.value?.reload()}}catch(e){if(!disposed)error.value=errorText(e)}}
async function committed(r:{id:string;from:string;to:string}){state.periodId.value=r.from.slice(0,7);state.importing.value=true;await analyze(r.id)}
async function analysisAction(key:string){if(!analysis.value)return;if(key==='replace-file')preview.value?.chooseFile();else if(key==='retry'){try{await state.context.http.post('/imports/'+analysis.value.id+'/process',{...state.context.scope,requestKey:requestKey()});await analyze(analysis.value.id)}catch(e){error.value=errorText(e)}}else state.gotoStep(2)}
async function answer(r:ReportAnswer){if(!analysis.value||busyAsk.value)return;busyAsk.value=r.askId;try{analysis.value=await state.context.http.post<AnalysisRunModel>('/imports/'+analysis.value.id+'/answers',{...state.context.scope,...r,requestKey:requestKey()});await state.loadPeriod()}catch(e){askErrors.value[r.askId]=errorText(e)}finally{busyAsk.value=''}}
onUnmounted(()=>{disposed=true;version++;if(timer)clearTimeout(timer)})
</script>
<template><div><p v-if="error&&!analysis" role="alert">{{error}}</p><ReportPreview ref="preview" :context="state.context" @committed="committed"/><div v-if="analysis" class="card" role="region" aria-label="当前报表分析"><ReportAnalysis :context="state.context" :run="analysis" :busy-ask-id="busyAsk" :errors="askErrors" @answer="answer" @refresh="analyze(analysis!.id)" @action="analysisAction"/><p v-if="error" role="alert">{{error}}<button @click="analyze(analysis!.id)">重新读取</button></p><div class="row-actions"><button class="primary" :disabled="state.importing.value||state.loading.value" @click="state.gotoStep(2)">去处理待办 →</button></div></div><ReportHistory ref="history" @resume="preview?.resume($event)" @analyze="analyze"/></div></template>
