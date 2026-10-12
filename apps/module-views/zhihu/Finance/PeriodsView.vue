<script setup lang="ts">
import {onMounted,onUnmounted,ref} from 'vue'
import type {EngineContext} from '../context'
import {errorText} from '../context'
import {moneyValue,cashText} from '../bill-entry'
const props=defineProps<{context:EngineContext}>()
const emit=defineEmits<{open:[period:{from:string;to:string}];upload:[]}>()
interface Period {id:string;from:string;to:string;records:number;newUserRecords:number;activationRecords:number}
interface Amounts {payable:string;confirmedPayable:string;pendingPayable:string;unpricedRecords?:number}
interface Summary {byType:{newUser:Amounts;activation:Amounts}}
const list=ref<Period[]>([]),total=ref(0),page=ref(1),busy=ref(false),error=ref('')
const summaries=ref<Record<string,Summary>>({}),summaryErrors=ref<Record<string,string>>({})
let generation=0
async function loadSummary(p:Period,current=generation){try{const r=await props.context.http.get<{summary:Summary}>('/workbench',{...props.context.scope,from:p.from,to:p.to,viewVersion:'2'});if(current===generation){summaries.value[p.id]=r.summary;delete summaryErrors.value[p.id]}}catch(e){if(current===generation)summaryErrors.value[p.id]=errorText(e)}}
async function load(){const current=++generation;busy.value=true;error.value='';summaries.value={};summaryErrors.value={};try{const r=await props.context.http.get<{list:Period[];total:number}>('/workbench/periods',{...props.context.scope,page:page.value});if(current!==generation)return;list.value=r.list;total.value=r.total;await Promise.allSettled(r.list.map(p=>loadSummary(p,current)))}catch(e){if(current===generation)error.value=errorText(e)}finally{if(current===generation)busy.value=false}}
const amount=(id:string,key:'payable'|'confirmedPayable'|'pendingPayable')=>{const s=summaries.value[id];return s?'¥'+cashText(moneyValue(s.byType.newUser[key])+moneyValue(s.byType.activation[key])):'—'}
const unpriced=(id:string)=>{const s=summaries.value[id];return (s?.byType.newUser.unpricedRecords??0)+(s?.byType.activation.unpricedRecords??0)}
onMounted(load)
onUnmounted(()=>generation++)
</script>
<template><section class="periods-view"><header class="periods-heading"><div><h2>财务账期</h2><p class="muted">按月份查看报表、核对金额和登记线下发放。</p></div><button class="primary" @click="emit('upload')">上传报表</button></header>
<div class="banner"><div class="grow"><b>从报表到发放，每笔金额有据可查</b><div class="small muted">先预览报表，再确认导入。传错后可在上传记录中撤销并重传。</div></div></div>
<p v-if="busy&&!list.length" role="status">正在读取账期…</p><div v-if="error" role="alert">{{error}} <button @click="load">重新加载</button></div>
<div v-else-if="!busy&&!list.length" class="card"><h3>还没有正式导入的报表</h3><p>确认导入后，账期和金额会显示在这里。</p></div>
<div class="periods-list"><article v-for="p in list" :key="p.id" class="card period-card"><div class="period-caption"><h3 class="title">{{p.id}}</h3><span class="badge">{{p.records}} 条已识别记录</span><div class="small muted">{{p.from}} 至 {{p.to}}</div></div><div class="nums"><div><span>成员应付{{unpriced(p.id)?'已算出':''}}</span><b>{{amount(p.id,'payable')}}</b></div><div><span>已确认应付</span><b>{{amount(p.id,'confirmedPayable')}}</b></div><div><span>待确认应付</span><b>{{amount(p.id,'pendingPayable')}}</b></div></div><div class="period-next"><span v-if="summaryErrors[p.id]" role="alert">金额读取失败 <button class="ghost" @click="loadSummary(p)">重试</button></span><span v-else-if="!summaries[p.id]" class="small muted" role="status">正在读取金额…</span><span v-else-if="unpriced(p.id)" class="small muted">另有 {{unpriced(p.id)}} 条待计算</span><button @click="emit('open',p)">查看账单 →</button></div></article></div>
<footer v-if="total>12"><button :disabled="busy||page===1" @click="page--;load()">上一页</button>第 {{page}} 页<button :disabled="busy||page*12>=total" @click="page++;load()">下一页</button></footer></section></template>
<style scoped>
.periods-view{min-width:0}.periods-heading,footer{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px}h2,p{margin:0 0 8px}.period-caption{display:grid;gap:6px}.period-caption .badge{justify-self:start}.period-next{display:grid;gap:8px}.period-next [role=alert]{font-size:12px;color:var(--danger)}.period-card{margin-bottom:14px}.nums{min-width:0}.nums>div{min-width:120px}.period-card .nums b{font-size:22px}.period-card h3{margin:0}.period-caption .small{font-size:11px}@media(max-width:600px){.period-card{padding:16px}.nums{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px!important;flex-basis:100%!important}.nums>div{min-width:0}.period-next{width:100%}}
</style>
