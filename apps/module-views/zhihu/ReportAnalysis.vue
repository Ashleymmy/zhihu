<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {AnalysisRun,DetailDrawer} from '@zhihu-koc/shared-components'
import {errorText,type EngineContext,type Option} from './context'
import type {NameSelection,ReportAnswer,ReportRun} from './report-analysis'
import HistoricalWorks from './HistoricalWorks.vue'
const props=defineProps<{context:EngineContext;run:ReportRun;busyAskId?:string;errors?:Record<string,string>;busyAction?:string}>()
const emit=defineEmits<{answer:[answer:ReportAnswer];action:[key:string];refresh:[]}>()
const channelAsk=ref(''),channelId=ref(''),upstreamId=ref(''),generation=ref<1|2>(1),channels=ref<Option[]>([]),mappings=ref<Option[]>([]),loading=ref(false),error=ref('')
const keywordAsk=ref(''),keywordId=ref('new'),taskId=ref(''),executorId=ref(''),fromDate=ref(''),tasks=ref<Option[]>([]),members=ref<Option[]>([])
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
const keywordMatch=computed(()=>props.run.nameMatches?.find(match=>match.askId===keywordAsk.value))
watch(()=>props.run,run=>{for(const target of [channelAsk,keywordAsk])if(target.value&&!run.steps.some(step=>step.asks?.some(ask=>ask.id===target.value)))target.value=''}, {deep:true})
async function answer(value:{askId:string;option:string}){
 if(!['other-channel','other-keyword'].includes(value.option)){emit('answer',value);return}
 channelAsk.value=value.option==='other-channel'?value.askId:'';keywordAsk.value=value.option==='other-keyword'?value.askId:''
 channelId.value='';upstreamId.value='';keywordId.value='new';executorId.value='';fromDate.value=keywordMatch.value?.date??today;error.value='';loading.value=true
 try{
  const options=await props.context.http.get<{channels:Option[];mappings:Option[];tasks:Option[];users:Option[]}>('/attribution-options',props.context.scope)
  channels.value=options.channels;mappings.value=options.mappings;tasks.value=options.tasks;taskId.value=options.tasks.length===1?options.tasks[0]?.id??'':''
  members.value=options.users.filter(user=>['creator','leader'].includes(user.role??''))
 }
 catch(e){error.value=errorText(e)}finally{loading.value=false}
}
function save(){
 const selection:NameSelection=channelId.value==='new'?{upstreamId:upstreamId.value,generation:generation.value}:channelId.value.startsWith('mapping:')?{mappingId:channelId.value.slice(8)}:{channelId:channelId.value}
 emit('answer',{askId:channelAsk.value,option:'other-channel',selection})
}
function saveKeyword(){
 const selection:NameSelection=keywordId.value==='new'?{taskId:taskId.value,executorId:executorId.value,fromDate:fromDate.value}:{keywordId:keywordId.value}
 emit('answer',{askId:keywordAsk.value,option:'other-keyword',selection})
}
</script>
<template>
 <AnalysisRun :run="run" :busy-ask-id="busyAskId" :errors="errors" :busy-action="busyAction" @answer="answer" @action="emit('action',$event)" />
 <HistoricalWorks v-if="context.adminDuty!=='finance'&&run.steps.some(step=>step.key==='work'&&step.status==='ask')" :key="run.id" :context="context" :batch-id="run.id" @changed="emit('refresh')" />
 <DetailDrawer :open="!!channelAsk" title="确认报表中的渠道" @close="channelAsk=''">
  <form class="channel-choice" @submit.prevent="save">
   <p>{{run.steps.flatMap(step=>step.asks??[]).find(ask=>ask.id===channelAsk)?.text}}</p>
   <p v-if="loading" role="status">正在读取渠道…</p>
   <p v-if="error||errors?.[channelAsk]" class="engine-error" role="alert">{{error||errors?.[channelAsk]}}</p>
   <label>对应哪个渠道<select v-model="channelId" required :disabled="loading"><option value="" disabled>请选择</option><option v-for="mapping in mappings" :key="'mapping:'+mapping.id" :value="'mapping:'+mapping.id">{{mapping.channelName}} · {{channels.find(channel=>channel.id===mapping.channelId)?.name}}</option><option v-for="channel in channels.filter(channel=>!mappings.some(mapping=>mapping.channelId===channel.id))" :key="channel.id" :value="channel.id">{{channel.name}}</option><option value="new">登记新渠道</option></select></label>
   <template v-if="channelId==='new'">
    <label>知乎渠道号<input v-model="upstreamId" required maxlength="32" autocomplete="off" /></label>
    <label>渠道级别<select v-model="generation"><option :value="1">一级渠道</option><option :value="2">二级渠道</option></select></label>
   </template>
   <p>保存后，这份报表中的相关行会自动继续处理。</p>
   <button class="primary" :disabled="loading||!!busyAskId||!channelId">{{busyAskId?'正在保存…':'确认并继续'}}</button>
  </form>
 </DetailDrawer>
 <DetailDrawer :open="!!keywordAsk" title="登记历史关键词" @close="keywordAsk=''">
  <form class="channel-choice" @submit.prevent="saveKeyword">
   <p>报表中的关键词：<strong>{{keywordMatch?.keyword}}</strong><br>渠道：{{keywordMatch?.channel}}</p>
   <p v-if="loading" role="status">正在读取成员和推广活动…</p>
   <p v-if="error||errors?.[keywordAsk]" class="engine-error" role="alert">{{error||errors?.[keywordAsk]}}</p>
   <label v-if="keywordMatch?.candidates.length">使用哪条记录<select v-model="keywordId" required><option v-for="candidate in keywordMatch.candidates" :key="candidate.id" :value="candidate.id">使用「{{candidate.name}}」</option><option value="new">登记报表中的关键词</option></select></label>
   <template v-if="keywordId==='new'">
    <p>登记已有关键词，核对它的执行人和开始日期。</p>
    <label>推广活动<select v-model="taskId" required :disabled="loading"><option value="" disabled>请选择</option><option v-for="task in tasks" :key="task.id" :value="task.id">{{task.name}}</option></select></label>
    <label>执行人<select v-model="executorId" required :disabled="loading"><option value="" disabled>请选择</option><option v-for="member in members" :key="member.id" :value="member.id">{{member.displayName}} · {{member.role==='leader'?'团长':'达人'}}</option></select></label>
    <label>从哪天开始<input v-model="fromDate" type="date" required :max="today" /></label>
   </template>
   <button class="primary" :disabled="loading||!!busyAskId||keywordId==='new'&&(!executorId||!taskId)">{{busyAskId?'正在保存…':'确认并继续'}}</button>
  </form>
 </DetailDrawer>
</template>
<style scoped>
.channel-choice{display:grid;gap:18px}.channel-choice p{margin:0;overflow-wrap:anywhere}.channel-choice label{display:grid;gap:8px}.channel-choice select,.channel-choice input{box-sizing:border-box;width:100%;min-width:0;min-height:44px;padding:10px;border:1px solid var(--line,#ddd);border-radius:8px;color:inherit;background:var(--paper,#fff);font:inherit}.channel-choice button{min-height:44px;justify-self:start;padding:10px 16px;border:1px solid #195e62;border-radius:8px;background:#195e62;color:#fff;font:inherit;cursor:pointer}.channel-choice button:disabled{opacity:.5;cursor:wait}.channel-choice button:focus-visible{outline:3px solid #195e62;outline-offset:3px}.channel-choice .engine-error{padding:12px;border-radius:8px;color:#a02f39;background:#fff1f1}
</style>
