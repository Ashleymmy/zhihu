<script setup lang="ts">
import {computed,nextTick,onMounted,reactive,ref} from 'vue'
import {DataGrid,DetailDrawer,ValueComparison,type AnalysisComparison,type AnalysisRunModel,type DataGridRow} from '@zhihu-koc/shared-components'
import ReportAnalysis from './ReportAnalysis.vue'
import type {RiskCase,ReportAnswer} from './report-analysis'
import RiskReview from './RiskReview.vue'
import {errorText,requestKey,type EngineContext} from './context'
const props=defineProps<{context:EngineContext}>()
const emit=defineEmits<{changed:[]}>()
interface Issue{id:string;batchId:string|null;reasonCode:string;reason:string;next:string;status:string;resolution?:string|null;factId:string|null;keyword:string|null;revisionId:string|null;expectedRevisionId:string|null;riskAssessment?:string;comparison?:AnalysisComparison[];normalizedJson:{keyword:string;orders:string}|null}
const list=ref<Issue[]>([]),page=ref(1),total=ref(0),busy=ref(false),error=ref(''),notice=ref(''),selected=ref<Issue|null>(null)
const finance=props.context.adminDuty==='finance',operations=props.context.adminDuty==='operations'
const risk=ref<RiskCase|null>(null)
const analysis=ref<AnalysisRunModel|null>(null),analysisHost=ref<HTMLElement|null>(null),busyAskId=ref(''),askErrors=reactive<Record<string,string>>({})
const title=(i:Issue)=>i.normalizedJson?.keyword||i.keyword||'报表记录'
const canMatch=(i:Issue)=>i.status==='open'&&!!i.batchId&&!finance&&['CHANNEL_UNMAPPED','CHANNEL_AMBIGUOUS','PROJECT_MISMATCH','KEYWORD_UNKNOWN'].includes(i.reasonCode)
const canReviewRisk=(i:Issue)=>!finance&&i.status==='open'&&i.reasonCode==='RISK_REVIEW_REQUIRED'&&!!i.factId&&!!i.expectedRevisionId
const canChoose=(i:Issue)=>i.status==='open'&&!!i.revisionId&&!operations
const canRetry=(i:Issue)=>i.status==='open'&&!i.revisionId&&!i.factId&&!!i.batchId&&!finance&&!canMatch(i)&&i.reasonCode!=='RISK_REVIEW_REQUIRED'
function action(i:Issue){return canMatch(i)?{key:'match',label:i.reasonCode==='KEYWORD_UNKNOWN'?'核对关键词':'确认渠道'}:canReviewRisk(i)?{key:'risk',label:'核实风险'}:canChoose(i)?{key:'choose',label:'核对原值与新值'}:canRetry(i)?{key:'retry',label:'继续处理'}:undefined}
const rows=computed<DataGridRow[]>(()=>list.value.map(i=>{const next=i.next.split('：'),closed=i.status!=='open';return{id:i.id,title:title(i),status:{key:closed?'done':i.reasonCode,label:closed?'已处理':i.reason,tone:closed?'success':action(i)?'danger':'warning'},cells:{reason:i.reason,comparison:i.comparison?.map(row=>`${row.label}：${row.previous} → ${row.incoming}`).join('；')??'—'},next:closed?undefined:{actor:next.length>1?next[0]!:'运营',text:next.length>1?next.slice(1).join('：'):i.next,action:action(i)},viewKeys:closed?['done']:['pending']}}))
const item=(row:DataGridRow)=>list.value.find(i=>i.id===row.id)!
async function load(){busy.value=true;error.value='';try{const data=await props.context.http.get<{list:Issue[];total:number}>('/exceptions',{...props.context.scope,page:page.value,pageSize:25});list.value=data.list;total.value=data.total;if(selected.value)selected.value=list.value.find(i=>i.id===selected.value?.id)??null}catch(e){error.value=errorText(e)}finally{busy.value=false}}
async function inspect(i:Issue){error.value='';try{analysis.value=await props.context.http.get<AnalysisRunModel>('/imports/'+i.batchId+'/analysis',props.context.scope);await nextTick();analysisHost.value?.scrollIntoView({block:'start',behavior:'smooth'})}catch(e){error.value=errorText(e)}}
async function changed(){if(analysis.value)analysis.value=await props.context.http.get<AnalysisRunModel>('/imports/'+analysis.value.id+'/analysis',props.context.scope);await load();emit('changed')}
async function answer(value:ReportAnswer){
 if(!analysis.value||busyAskId.value)return;busyAskId.value=value.askId;askErrors[value.askId]=''
 try{analysis.value=await props.context.http.post<AnalysisRunModel>('/imports/'+analysis.value.id+'/answers',{...props.context.scope,...value,requestKey:requestKey()});await changed()}
 catch(e){askErrors[value.askId]=errorText(e)}finally{busyAskId.value=''}
}
async function handle(i:Issue){
 selected.value=null;await nextTick()
 if(canMatch(i))await inspect(i)
 else if(canReviewRisk(i))risk.value={factId:i.factId!,revisionId:i.expectedRevisionId!,keyword:title(i),riskAssessment:i.riskAssessment??''}
 else if(canChoose(i))selected.value=i
 else if(canRetry(i)){busy.value=true;error.value='';try{await props.context.http.post('/exceptions/'+i.id+'/retry',{...props.context.scope,requestKey:requestKey(),reason:'继续处理报表中保留的记录'});await changed()}catch(e){error.value=errorText(e)}finally{busy.value=false}}
}
async function choose(option:'new'|'old'|'skip'){
 const i=selected.value;if(!i||busy.value)return
 busy.value=true;error.value=''
 try{await props.context.http.post('/imports/'+i.batchId+'/answers',{...props.context.scope,requestKey:requestKey(),askId:'revision:'+i.revisionId+':'+(i.expectedRevisionId??'0'),option});selected.value=null;notice.value=option==='skip'?'这项记录仍保留在需要跟进中。':option==='new'?'已采用新值，相关金额已自动更新。':'已保留原值，新报表仍可查看。';await changed()}
 catch(e){error.value=errorText(e)}finally{busy.value=false}
}
async function inspectFact(factId:string){error.value='';try{const data=await props.context.http.get<{list:Issue[]}>('/exceptions',{...props.context.scope,factId,page:1,pageSize:25});selected.value=data.list.find(canChoose)??null;if(!selected.value){notice.value='这项报表问题已更新，请查看最新结果。';await changed()}}catch(e){error.value=errorText(e)}}
defineExpose({inspectFact})
onMounted(load)
</script>
<template>
 <section class="work-card issues">
  <div class="section-heading"><div><h2>数据待办</h2><p>按下一步补齐资料，金额已算出的记录可以继续核对。</p></div><button :disabled="busy" @click="load">刷新</button></div>
  <p v-if="error&&!selected" class="engine-error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
  <div v-if="analysis" ref="analysisHost" class="issue-analysis"><ReportAnalysis :context="context" :run="analysis" :busy-ask-id="busyAskId" :errors="askErrors" @answer="answer" @action="load" @refresh="changed" /><button @click="analysis=null">收起分析</button></div>
  <DataGrid title="报表待办" title-label="关键词" :rows="rows" :columns="[{key:'reason',label:'需要处理什么'},...(operations?[]:[{key:'comparison',label:'原值与新值'}])]" :views="[{key:'pending',label:'需要跟进'},{key:'all',label:'全部'},{key:'done',label:'已处理'}]" :busy="busy" external-details empty-text="这里的报表问题已处理完，可以继续核对其他记录。" @inspect="selected=item($event)" @action="handle(item($event.row))">
   <template #cell="{row,column,value}"><ValueComparison v-if="column.key==='comparison'&&item(row).comparison?.length" :rows="item(row).comparison!" /><template v-else>{{value}}</template></template>
  </DataGrid>
  <DetailDrawer :open="!!selected" :title="selected?title(selected):'报表记录'" @close="selected=null">
   <div v-if="selected" class="issue-detail"><p>{{selected.reason}} · {{selected.status==='open'?'待处理':'已处理'}}</p><p v-if="error" class="engine-error" role="alert">{{error}}</p>
    <ValueComparison v-if="selected.comparison?.length" :rows="selected.comparison" />
    <p v-if="selected.resolution">处理说明：{{selected.resolution}}</p><p v-if="selected.status==='open'">下一步：{{selected.next}}</p>
    <div v-if="canChoose(selected)" class="issue-actions"><button class="primary" :disabled="busy" @click="choose('new')">采用这份报表</button><button :disabled="busy" @click="choose('old')">保留原来的数字</button><button :disabled="busy" @click="choose('skip')">暂时跳过</button></div>
    <button v-else-if="action(selected)" :disabled="busy" @click="handle(selected)">{{action(selected)?.label}}</button>
   </div>
  </DetailDrawer>
  <RiskReview :context="context" :item="risk" @close="risk=null" @saved="risk=null;changed()" />
  <div class="engine-actions" v-if="total>25"><button :disabled="busy||page===1" @click="page--;load()">上一页</button><span>第 {{page}} 页，共 {{total}} 条</span><button :disabled="busy||page*25>=total" @click="page++;load()">下一页</button></div>
 </section>
</template>
<style scoped>
.issue-detail{display:grid;gap:16px;overflow-wrap:anywhere}.issue-detail p{margin:0}.issue-actions{display:flex;gap:10px;flex-wrap:wrap}.issue-detail button{min-height:44px;padding:10px 14px;border:1px solid var(--line,#dce3e5);border-radius:8px;font:inherit;cursor:pointer}.issue-detail .primary{background:#195e62;color:#fff}.issue-detail button:disabled{opacity:.5;cursor:wait}
</style>
