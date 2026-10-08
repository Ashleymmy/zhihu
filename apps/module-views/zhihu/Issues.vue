<script setup lang="ts">
import {nextTick,onMounted,reactive,ref} from 'vue'
import type {AnalysisRunModel} from '@zhihu-koc/shared-components'
import ReportAnalysis from './ReportAnalysis.vue'
import {errorText,requestKey,type EngineContext} from './context'
const props=defineProps<{context:EngineContext}>()
interface Issue{id:string;batchId:string|null;reasonCode:string;reason:string;next:string;status:string;factId:string|null;keyword:string|null;revisionId:string|null;expectedRevisionId:string|null;normalizedJson:{keyword:string;orders:string}|null}
const list=ref<Issue[]>([]),page=ref(1),busy=ref(false),error=ref(''),selected=ref<Issue|null>(null),reason=ref('')
const finance=props.context.adminDuty==='finance',operations=props.context.adminDuty==='operations'
const analysis=ref<AnalysisRunModel|null>(null),analysisHost=ref<HTMLElement|null>(null),busyAskId=ref(''),askErrors=reactive<Record<string,string>>({})
const canMatch=(i:Issue)=>i.status==='open'&&!!i.batchId&&!finance&&['CHANNEL_UNMAPPED','CHANNEL_AMBIGUOUS','PROJECT_MISMATCH','KEYWORD_UNKNOWN'].includes(i.reasonCode)
async function inspect(i:Issue){error.value='';try{analysis.value=await props.context.http.get<AnalysisRunModel>('/imports/'+i.batchId+'/analysis',props.context.scope);await nextTick();analysisHost.value?.scrollIntoView({block:'start',behavior:'smooth'})}catch(e){error.value=errorText(e)}}
async function answer(value:{askId:string;option:string;selection?:{channelId:string}|{upstreamId:string;generation:1|2}}){
 if(!analysis.value||busyAskId.value)return;busyAskId.value=value.askId;askErrors[value.askId]=''
 try{analysis.value=await props.context.http.post<AnalysisRunModel>('/imports/'+analysis.value.id+'/answers',{...props.context.scope,...value,requestKey:requestKey()});await load()}
 catch(e){askErrors[value.askId]=errorText(e)}finally{busyAskId.value=''}
}
const canHandle=(i:Issue)=>i.revisionId?!operations:!finance
const canRetry=(i:Issue)=>i.status==='open'&&i.reasonCode!=='RISK_REVIEW_REQUIRED'&&!canMatch(i)&&canHandle(i)&&(!!i.revisionId||!i.factId)
async function load(){try{list.value=(await props.context.http.get<{list:Issue[]}>('/exceptions',{...props.context.scope,page:page.value,pageSize:25})).list}catch(e){error.value=errorText(e)}}
async function resolve(accept:boolean){if(!selected.value)return;busy.value=true;error.value='';try{const i=selected.value;await props.context.http.post(i.revisionId?'/metric-revisions/'+i.revisionId+'/resolve':'/exceptions/'+i.id+'/retry',{...props.context.scope,requestKey:requestKey(),accept,expectedRevisionId:i.expectedRevisionId,reason:reason.value});selected.value=null;await load()}catch(e){error.value=errorText(e)}finally{busy.value=false}}
onMounted(load)
</script>
<template>
 <section class="work-card issues">
  <div class="section-heading"><div><h2>数据待办</h2><p>按下一步补齐资料，金额已算出的记录可以继续核对。</p></div><button @click="load">刷新</button></div>
  <p class="engine-error" v-if="error" role="alert">{{error}}</p>
  <div v-if="analysis" ref="analysisHost" class="issue-analysis"><ReportAnalysis :context="context" :run="analysis" :busy-ask-id="busyAskId" :errors="askErrors" @answer="answer" @action="load" /><button @click="analysis=null">收起分析</button></div>
  <div class="engine-table"><table><thead><tr><th>关键词</th><th>需要处理什么</th><th>状态</th><th>下一步</th></tr></thead><tbody><tr v-for="i in list" :key="i.id"><td>{{i.normalizedJson?.keyword||i.keyword||'报表记录'}}</td><td class="cell-note">{{i.reason}}</td><td>{{i.status==='open'?'待处理':'已处理'}}</td><td><span v-if="i.status==='open'">{{i.next}}</span><button v-if="canMatch(i)" @click="inspect(i)">{{i.reasonCode==='KEYWORD_UNKNOWN'?'核对关键词':'确认渠道'}}</button><button v-if="canRetry(i)" @click="selected=i;reason=''">{{i.revisionId?'核对更正':'资料已补齐，重新计算'}}</button></td></tr></tbody></table></div>
  <ul class="issue-cards"><li v-for="i in list" :key="i.id"><strong>{{i.normalizedJson?.keyword||i.keyword||'报表记录'}}</strong><span>{{i.reason}} · {{i.status==='open'?'待处理':'已处理'}}</span><span v-if="i.status==='open'">下一步：{{i.next}}</span><button v-if="canMatch(i)" @click="inspect(i)">{{i.reasonCode==='KEYWORD_UNKNOWN'?'核对关键词':'确认渠道'}}</button><button v-if="canRetry(i)" @click="selected=i;reason=''">{{i.revisionId?'核对更正':'资料已补齐，重新计算'}}</button></li></ul>
  <p class="empty-state" v-if="!list.length">没有需要处理的报表问题，可以继续核对账单。</p>
  <form v-if="selected" class="confirm-box" @submit.prevent="resolve(true)"><h2>{{selected.normalizedJson?.keyword||selected.keyword}}</h2><p v-if="selected.revisionId">更正后的订单量：{{selected.normalizedJson?.orders??'未提供'}}。接受后，系统会重新计算金额并保留更正记录。</p><label>处理说明<input v-model="reason" required maxlength="500" /></label><button class="primary" :disabled="busy">{{selected.revisionId?'接受更正':'重新计算'}}</button><button v-if="selected.revisionId" type="button" :disabled="!reason||busy" @click="resolve(false)">不接受更正</button><button type="button" @click="selected=null">取消</button></form>
  <div class="engine-actions" v-if="page>1||list.length===25"><button :disabled="page===1" @click="page--;load()">上一页</button><button :disabled="list.length<25" @click="page++;load()">下一页</button></div>
 </section>
</template>
<style scoped>
.issue-cards{display:none;list-style:none;padding:0}.issue-cards li{display:grid;gap:8px;padding:12px;border:1px solid var(--line,#ddd);border-radius:8px;overflow-wrap:anywhere}.issue-cards button{justify-self:start}
@media(max-width:600px){.issues>.engine-table{display:none}.issue-cards{display:grid;gap:10px}}
</style>

