<script setup lang="ts">
import {onMounted,ref} from 'vue'
import type {EngineContext} from '../context'
import {errorText} from '../context'
const props=defineProps<{context:EngineContext}>()
const emit=defineEmits<{open:[period:{from:string;to:string}];upload:[]}>()
interface Period {id:string;from:string;to:string;records:number;newUserRecords:number;activationRecords:number}
const list=ref<Period[]>([]),total=ref(0),page=ref(1),busy=ref(false),error=ref('')
async function load(){busy.value=true;error.value='';try{const r=await props.context.http.get<{list:Period[];total:number}>('/workbench/periods',{...props.context.scope,page:page.value});list.value=r.list;total.value=r.total}catch(e){error.value=errorText(e)}finally{busy.value=false}}
onMounted(load)
</script>
<template><section class="periods-view"><header><div><h2>财务账期</h2><p>按月份查看报表、核对金额和处理发放。</p></div><button class="primary" @click="emit('upload')">上传报表</button></header>
<p v-if="busy" role="status">正在读取账期…</p><div v-else-if="error" role="alert">{{error}} <button @click="load">重新加载</button></div>
<div v-else-if="!list.length" class="empty"><h3>还没有正式导入的报表</h3><p>上传后先看预览，确认导入才会进入账期。</p></div>
<div class="periods-list"><button v-for="p in list" :key="p.id" class="period-card" @click="emit('open',p)"><span class="period-title"><strong>{{p.id}}</strong><span>查看账单 →</span></span><span>{{p.from}} 至 {{p.to}}</span><span class="period-metrics"><span><small>已识别记录</small><strong>{{p.records}} 条</strong></span><span><small>拉新</small><strong>{{p.newUserRecords}} 条</strong></span><span><small>拉活</small><strong>{{p.activationRecords}} 条</strong></span></span><small v-if="!p.records">报表仍有待处理内容，点击查看原因。</small></button></div>
<footer v-if="total>12"><button :disabled="busy||page===1" @click="page--;load()">上一页</button>第 {{page}} 页<button :disabled="busy||page*12>=total" @click="page++;load()">下一页</button></footer></section></template>
<style scoped>
.periods-view{display:grid;gap:20px;min-width:0}.periods-view header,.period-title,footer{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}h2,p{margin:0 0 8px}.periods-view p,small{color:var(--muted,#637078)}button{font:inherit;cursor:pointer;border:1px solid var(--line,#dce3e5);background:var(--paper,#fff);color:inherit;border-radius:10px;padding:12px 18px}.primary{background:var(--primary,#195e62);color:white}.periods-list{display:grid;gap:16px}.period-card{text-align:left;display:grid;gap:14px;width:100%}.period-card:hover{border-color:var(--primary,#195e62)}.period-title>strong{font-size:20px}.period-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.period-metrics>span{display:grid;gap:8px}.empty{padding:24px;background:var(--paper,#fff);border-radius:12px}.period-card strong{font-variant-numeric:tabular-nums}button:focus-visible{outline:2px solid var(--primary,#195e62);outline-offset:3px}@media(max-width:600px){.period-metrics{gap:8px}.period-card{padding:16px}}
</style>
