<script setup lang="ts">
import {cashText,moneyValue} from '../../bill-entry'
interface Metric {quantity:string;billableQuantity:string;pendingQuantity:string;excludedQuantity:string;payable:string;reportedSettlement?:string|null;reportedSettlementMissing?:number;unpricedRecords?:number}
const props=defineProps<{summary:{byType:{newUser:Metric;activation:Metric};staffAmount:string};groups:{payeeId:string;name:string;total:string;confirmed:string;pending:string;blockers:string[];ready:number}[];busy:boolean;canConfirm:boolean}>()
const emit=defineEmits<{confirm:[];export:[];person:[id:string];todo:[]}>()
const money=(value:string|null|undefined)=>value==null?'原表未提供':'¥'+cashText(moneyValue(value))
const metrics=[{key:'newUser',name:'拉新',unit:'单'},{key:'activation',name:'拉活',unit:'个'}] as const
</script>
<template>
 <div class="banner"><div class="grow"><b>核对来源、数量和应付金额</b><div class="small muted">展开关键词查看原报表和计算依据。正常记录可以先确认，待处理记录补齐后再确认。</div></div></div>
 <div class="review-grid">
  <aside class="card reconciliation"><h3>对账面板</h3>
   <section v-for="m in metrics" :key="m.key" class="recon-section"><h4>{{m.name}}</h4>
    <div class="recon-item"><span>报表数量</span><b>{{summary.byType[m.key].quantity}} {{m.unit}}</b></div>
    <div class="recon-item"><span>计费数量</span><b>{{summary.byType[m.key].billableQuantity}} {{m.unit}}</b></div>
    <div class="recon-item"><span>待处理数量</span><b>{{summary.byType[m.key].pendingQuantity}} {{m.unit}}</b></div>
    <div class="recon-item"><span>不计费数量</span><b>{{summary.byType[m.key].excludedQuantity}} {{m.unit}}</b></div>
    <div class="recon-item"><span>报表结算</span><b>{{money(summary.byType[m.key].reportedSettlement)}}</b></div>
    <p v-if="summary.byType[m.key].reportedSettlementMissing" class="small muted">{{summary.byType[m.key].reportedSettlementMissing}} 条未提供报表金额</p>
    <div class="recon-item"><span>成员应付{{summary.byType[m.key].unpricedRecords?'已算出':''}}</span><b>{{money(summary.byType[m.key].payable)}}</b></div>
    <p v-if="summary.byType[m.key].unpricedRecords" class="small muted">另有 {{summary.byType[m.key].unpricedRecords}} 条待计算</p>
   </section>
   <p class="small muted">内部业绩 {{money(summary.staffAmount)}}，不计入成员应付。报表结算与成员应付采用各自的单价。</p>
   <button class="ghost" @click="emit('todo')">查看待处理记录</button>
  </aside>
  <section class="card review-evidence"><h3>关键词与金额明细</h3><p class="small muted">点击关键词展开，查看来源与计算过程。</p><slot/></section>
  <aside class="card bill-groups"><h3>本期财务账单</h3><p class="small muted">按收款人核对，确认后生成可结算收入。</p>
   <div v-for="g in groups" :key="g.payeeId" class="confirm-row"><div><b>{{g.name}}</b><strong class="group-amount">{{money(g.total)}}</strong><div class="small muted">已确认 {{money(g.confirmed)}}<br/>待确认 {{money(g.pending)}}</div><p v-if="g.blockers.length" class="small">{{g.blockers.join('；')}}</p></div><button @click="emit('person',g.payeeId)">看明细</button></div>
   <p v-if="!groups.length" class="small muted">本期尚无成员应付，请查看明细中的原因。</p>
   <div class="confirm-actions"><button class="primary" :disabled="busy||!canConfirm" @click="emit('confirm')">核对并确认账单</button><button :disabled="busy||!groups.length" @click="emit('export')">导出对账单</button></div>
  </aside>
 </div>
</template>
<style scoped>
.recon-section h4{margin:16px 0 4px}.recon-item b{text-align:right;overflow-wrap:anywhere}.group-amount{display:block;font-size:20px;font-variant-numeric:tabular-nums}.confirm-actions{display:grid;gap:10px;margin-top:18px}.confirm-row>div{flex:1;min-width:0;overflow-wrap:anywhere}.card{min-width:0;margin:0!important}.review-evidence>p{margin-bottom:16px}
</style>
