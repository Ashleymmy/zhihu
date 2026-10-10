<script setup lang="ts">
import {ref,watch} from 'vue'
import type {BillEntry} from '../../bill-entry'
import {errorText,type EngineContext} from '../../context'
const props=defineProps<{context:EngineContext;entry:BillEntry}>()
interface Source {batchId:string;fileName:string;lineNumber:number;metrics:string[]}
const sources=ref<Source[]>([]),busy=ref(false),error=ref('')
const names:Record<string,string>={orders:'订单量',search:'搜索量',revenue:'结算金额',activations:'拉活量',settlement:'补贴金额',agency:'代理名称',riskAssessment:'风险信息'}
let generation=0
async function load(){const v=++generation;busy.value=true;error.value='';sources.value=[];try{const data=await props.context.http.get<{currentSource?:Source[]}>('/attributions/'+props.entry.factId+'/trace',props.context.scope);if(v===generation)sources.value=data.currentSource??[]}catch(e){if(v===generation)error.value=errorText(e)}finally{if(v===generation)busy.value=false}}
async function download(source:Source){busy.value=true;error.value='';try{const blob=await props.context.http.getBlob('/imports/'+source.batchId+'/file?'+new URLSearchParams({...props.context.scope}));const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=source.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){error.value=errorText(e)}finally{busy.value=false}}
watch(()=>props.entry.factId,()=>{if(props.entry.factId)void load()},{immediate:true})
</script>
<template><section class="source-trace"><h3>原表来源</h3><p v-if="busy" role="status">正在读取来源…</p><div v-if="error" role="alert">{{error}} <button :disabled="busy" @click="load">重新读取</button></div><article v-for="s in sources" :key="s.batchId+':'+s.lineNumber"><strong>{{s.fileName}} · 第 {{s.lineNumber}} 行</strong><p>采用字段：{{s.metrics.map(m=>names[m]||'其他字段').join('、')}}</p><button :disabled="busy" @click="download(s)">下载原报表</button></article><p v-if="!sources.length&&!error&&!busy">当前记录没有可展示的原报表来源。</p><h3>执行与计算</h3><p>{{entry.executorName||entry.payeeName}} · {{entry.date}} · {{entry.metricType==='activation'?'拉活':'拉新'}}</p><p v-if="entry.next">下一步：{{entry.next}}</p></section></template>
<style scoped>.source-trace{display:grid;gap:12px;border-top:1px solid var(--line,#ddd);padding-top:16px}h3,p{margin:0}article{padding:12px;border:1px solid var(--line,#ddd);border-radius:8px;display:grid;gap:8px;overflow-wrap:anywhere}button{padding:10px;font:inherit;justify-self:start;cursor:pointer;border:1px solid var(--line,#ddd);background:var(--paper,#fff);color:inherit;border-radius:8px}</style>
