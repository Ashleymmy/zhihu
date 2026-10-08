<script setup lang="ts">
import {ref,watch} from 'vue'
import {AnalysisRun,DetailDrawer,type AnalysisRunModel} from '@zhihu-koc/shared-components'
import {errorText,type EngineContext,type Option} from './context'
const props=defineProps<{context:EngineContext;run:AnalysisRunModel;busyAskId?:string;errors?:Record<string,string>;busyAction?:string}>()
type Selection={channelId:string}|{upstreamId:string;generation:1|2}
const emit=defineEmits<{answer:[answer:{askId:string;option:string;selection?:Selection}];action:[key:string]}>()
const channelAsk=ref(''),channelId=ref(''),upstreamId=ref(''),generation=ref<1|2>(1),channels=ref<Option[]>([]),loading=ref(false),error=ref('')
watch(()=>props.run,run=>{if(channelAsk.value&&!run.steps.some(step=>step.asks?.some(ask=>ask.id===channelAsk.value)))channelAsk.value=''}, {deep:true})
async function answer(value:{askId:string;option:string}){
 if(value.option!=='other-channel'){emit('answer',value);return}
 channelAsk.value=value.askId;channelId.value='';upstreamId.value='';error.value='';loading.value=true
 try{channels.value=(await props.context.http.get<{channels:Option[]}>('/attribution-options',props.context.scope)).channels}
 catch(e){error.value=errorText(e)}finally{loading.value=false}
}
function save(){
 const selection:Selection=channelId.value==='new'?{upstreamId:upstreamId.value,generation:generation.value}:{channelId:channelId.value}
 emit('answer',{askId:channelAsk.value,option:'other-channel',selection})
}
</script>
<template>
 <AnalysisRun :run="run" :busy-ask-id="busyAskId" :errors="errors" :busy-action="busyAction" @answer="answer" @action="emit('action',$event)" />
 <DetailDrawer :open="!!channelAsk" title="确认报表中的渠道" @close="channelAsk=''">
  <form class="channel-choice" @submit.prevent="save">
   <p>{{run.steps.flatMap(step=>step.asks??[]).find(ask=>ask.id===channelAsk)?.text}}</p>
   <p v-if="loading" role="status">正在读取渠道…</p>
   <p v-if="error||errors?.[channelAsk]" class="engine-error" role="alert">{{error||errors?.[channelAsk]}}</p>
   <label>对应哪个渠道<select v-model="channelId" required :disabled="loading"><option value="" disabled>请选择</option><option v-for="channel in channels" :key="channel.id" :value="channel.id">{{channel.name}}</option><option value="new">登记新渠道</option></select></label>
   <template v-if="channelId==='new'">
    <label>知乎渠道号<input v-model="upstreamId" required maxlength="32" autocomplete="off" /></label>
    <label>渠道级别<select v-model="generation"><option :value="1">一级渠道</option><option :value="2">二级渠道</option></select></label>
   </template>
   <p>保存后，这份报表中的相关行会自动继续处理。</p>
   <button class="primary" :disabled="loading||!!busyAskId||!channelId">{{busyAskId?'正在保存…':'确认并继续'}}</button>
  </form>
 </DetailDrawer>
</template>
<style scoped>
.channel-choice{display:grid;gap:18px}.channel-choice p{margin:0;overflow-wrap:anywhere}.channel-choice label{display:grid;gap:8px}.channel-choice select,.channel-choice input{box-sizing:border-box;width:100%;min-width:0;min-height:44px;padding:10px;border:1px solid var(--line,#ddd);border-radius:8px;color:inherit;background:var(--paper,#fff);font:inherit}.channel-choice button{min-height:44px;justify-self:start;padding:10px 16px;border:1px solid #195e62;border-radius:8px;background:#195e62;color:#fff;font:inherit;cursor:pointer}.channel-choice button:disabled{opacity:.5;cursor:wait}.channel-choice button:focus-visible{outline:3px solid #195e62;outline-offset:3px}.channel-choice .engine-error{padding:12px;border-radius:8px;color:#a02f39;background:#fff1f1}
</style>
