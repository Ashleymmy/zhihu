<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { createRequestKey } from '@zhihu-koc/shared-utils'
import { http } from '../stores/auth'
interface InspectionRecord { id:string; time:string; item:string; duration:string; result:string; status:string; diffs:null }
interface Inspections { canRun:boolean; historyAvailable:boolean; message:string; records:InspectionRecord[] }
interface InspectionRun { runId:string; ranAt:string; status:string; records:InspectionRecord[]; saved:false; scope:'current_connectivity_only' }
const data=ref<Inspections|null>(null), result=ref<InspectionRun|null>(null), loading=ref(false), running=ref(false), error=ref(''), notice=ref('')
let requestKey=''
async function load(){loading.value=true;error.value='';try{data.value=await http.get('/insights/dev-inspections')}catch(e){error.value=e instanceof Error?e.message:'当前检测能力暂未加载，请重试。'}finally{loading.value=false}}
async function run(){if(running.value||!data.value?.canRun)return;running.value=true;error.value='';notice.value='';requestKey ||= createRequestKey();try{result.value=await http.post('/insights/dev-inspections/run',{requestKey});requestKey='';notice.value='当前数据库与队列连接检查完成。本次结果没有保存为历史记录。'}catch(e){error.value=e instanceof Error?e.message:'尚未取得本次检查结果，请重试。';const status=Number((e as {status?:number})?.status);if(status>=400&&status<500&&status!==408)requestKey=''}finally{running.value=false}}
onMounted(load)
</script>
<template><div class="page-stack inspect-page"><div class="bento enter"><section class="card" style="--s:12;--i:0"><div class="card-h"><h3>当前连接检查</h3><button v-if="data?.canRun" class="btn ink r" :disabled="running||loading" @click="run">{{running?'正在检查…':'检查当前连接'}}</button></div><div v-if="error" role="alert"><p>{{error}}</p><button class="btn" :disabled="loading||running" @click="data?.canRun?run():load()">重新尝试</button></div><p v-if="notice" role="status">{{notice}}</p><p v-if="loading" role="status">正在读取检测能力…</p><p v-else-if="data" class="muted">{{data.message || '当前仅检查数据库与队列连接；未提供历史巡检或业务差异统计。'}}</p><p v-if="result" class="muted">检查时间：{{new Date(result.ranAt).toLocaleString('zh-CN')}}</p><div v-if="result" class="inspect-table"><article v-for="r in result.records" :key="r.id" class="inspect-tr"><b>{{r.item}}</b><span>{{r.result}}</span><small class="muted">耗时 {{r.duration}}</small></article></div><div v-else-if="data&&!loading" class="bento-empty home-empty"><b>尚未进行本次检查</b><p>点击“检查当前连接”读取此刻状态。</p></div></section></div></div></template>
<style scoped>.inspect-page{min-width:0}.inspect-table{display:grid;margin-top:16px}.inspect-tr{display:grid;grid-template-columns:1fr 1fr 100px;gap:12px;padding:14px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}.inspect-page [role=alert]{padding:14px;background:var(--ground);border-radius:10px}@media(max-width:600px){.inspect-tr{grid-template-columns:1fr}.card-h{flex-wrap:wrap;gap:12px}}</style>
