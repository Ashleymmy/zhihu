<script setup lang="ts">
import {computed,inject} from 'vue'
import type {PeriodState} from '../composables/usePeriodState'
import {fmtMoney,moneyValue,cashText} from '../composables/useFinanceApi'
const state=inject<PeriodState>('financeState')!,toast=inject<(text:string)=>void>('financeToast')!
const entries=computed(()=>state.workbench.value?.entries??[])
const confirmed=computed(()=>cashText(entries.value.filter(e=>e.ownPayable&&!e.internal).reduce((n,e)=>n+moneyValue(e.confirmedAmount),0n)))
const pending=computed(()=>cashText(entries.value.filter(e=>e.ownPayable&&!e.internal).reduce((n,e)=>n+moneyValue(e.pendingAmount),0n)))
const corrections=computed(()=>entries.value.filter(e=>e.kind==='adjustment').length)
const labels:Record<string,string>={creator:'达人单价',leader_self:'团长单价',leader_override:'团队分成',adjustment:'差额调整'}
function exportCsv(){
 const esc=(raw:unknown)=>{let s=String(raw??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
 const rows=entries.value.map(e=>[e.date,e.keyword,e.payeeName,e.metricType==='activation'?'拉活':'拉新',labels[e.kind]??e.kind,e.quantity??e.orders??'',e.calculation?.unitPrice??'',e.amount??'待计算',e.confirmedAmount,e.pendingAmount])
 const csv='\uFEFF'+[['日期','关键词','收款人','类型','规则','数量','单价(元)','金额(元)','已确认(元)','待确认(元)'],...rows].map(r=>r.map(esc).join(',')).join('\r\n')
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='对账单_'+state.periodId.value+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出对账单 CSV')
}
</script>
<template><div>
 <div class="row-actions"><button @click="exportCsv">导出对账单（CSV）</button></div>
 <div class="metric-grid"><div class="metric rise"><span>本期成员应付</span><strong class="num">{{fmtMoney(state.totalPayable.value)}}</strong></div><div class="metric rise"><span>本期已确认</span><strong class="num">¥{{confirmed}}</strong></div><div class="metric rise"><span>本期待确认</span><strong class="num">¥{{pending}}</strong></div><div class="metric rise"><span>差额调整</span><strong>{{corrections}} 条</strong></div></div>
 <div class="banner"><div class="grow"><b>本轮账单已处理，可随时回看。</b><p class="small muted">成员余额仍可申请提现；后续申请或报表更正会产生新的待办。发放记录以实际线下转账登记为准。</p></div></div>
 <div class="card"><h2>账单明细</h2><div class="table-scroll"><table v-if="entries.length"><thead><tr><th>日期</th><th>关键词</th><th>收款人</th><th>类型</th><th>数量</th><th>金额</th></tr></thead><tbody><tr v-for="e in entries" :key="e.id"><td data-label="日期">{{e.date}}</td><td data-label="关键词">{{e.keyword}}</td><td data-label="收款人">{{e.payeeName}}</td><td data-label="类型">{{e.metricType==='activation'?'拉活':'拉新'}}{{e.kind==='adjustment'?' · 调整':''}}</td><td data-label="数量">{{e.quantity??e.orders??'—'}}</td><td data-label="金额">{{fmtMoney(e.amount)}}</td></tr></tbody></table></div><div v-if="!entries.length" class="empty">本期没有明细数据。</div></div>
 <div class="card"><h2>本次操作记录</h2><ul v-if="state.timeline.value.length" class="tl"><li v-for="(e,i) in state.timeline.value" :key="i"><span class="t">{{e.t}}</span><b>{{e.actor}}</b><span>{{e.text}}</span></li></ul><p v-else class="small muted">本次查看期间没有操作。原表记录可回看第一步，实际发放记录可回看第四步。</p></div>
</div></template>

<style scoped>@media(max-width:600px){table,tbody{display:block}thead{display:none}tr{display:grid;gap:8px;border:1px solid var(--line);padding:12px;margin-block:12px;border-radius:8px}td{display:grid;grid-template-columns:70px minmax(0,1fr);gap:8px;overflow-wrap:anywhere;border:0;padding:0}td::before{content:attr(data-label);color:var(--ink-soft)}}</style>
