<script setup lang="ts">
import {computed,nextTick,ref} from 'vue'
import {DataGrid,DetailDrawer,ValueComparison,type DataGridRow} from '@zhihu-koc/shared-components'
import {type BillEntry,moneyValue,cashText} from './bill-entry'
const props=defineProps<{entries:BillEntry[];wallet?:boolean;adminDuty:string;busy?:boolean}>()
const emit=defineEmits<{assign:[entry:BillEntry];risk:[entry:BillEntry];changes:[entry:BillEntry]}>()
const selected=ref<BillEntry|null>(null)
const money=(v:string|null)=>v===null?'待计算':'¥'+cashText(moneyValue(v))
const typeName=(e:BillEntry)=>e.metricType==='activation'?'拉活':'拉新'
const unit=(e:BillEntry)=>e.metricType==='activation'?'个':'单'
const priceSource=(e:BillEntry)=>(e.priceSources??[]).map(source=>source==='role_rate'?'按角色单价':'按成员报价').join(' · ')
const status=(e:BillEntry)=>e.status==='confirmed'?(e.reasonCode==='RISK_EXCLUDED'?'已确认不计费':'已确认'):e.ready?'待财务确认':e.reason||e.blocked||'平台核对中'
const action=(e:BillEntry)=>e.canAssignRetro?{key:'assign',label:'指定执行人'}:!props.wallet&&props.adminDuty!=='finance'&&e.reasonCode==='RISK_REVIEW_REQUIRED'?{key:'risk',label:'核实风险'}:!props.wallet&&e.reasonCode==='SOURCE_REVISION_PENDING'?{key:'changes',label:'核对原值与新值'}:undefined
const rows=computed<DataGridRow[]>(()=>props.entries.map(e=>{const done=e.status==='confirmed'||e.status==='excluded',waiting=!!e.reasonCode&&!done,next=e.next.split('：');return{id:e.id,title:e.keyword,status:{key:done?e.status:e.ready?'ready':e.reasonCode||'waiting',label:status(e),tone:done?'success':e.ready?'success':action(e)?'danger':'warning'},cells:{date:e.date,type:typeName(e),person:props.wallet?e.payerName:e.payeeName,quantity:(e.quantity??'—')+unit(e),amount:money(e.amount)},next:done?undefined:{actor:next.length>1?next[0]!:'财务',text:next.length>1?next.slice(1).join('：'):e.next||'核对金额',action:action(e)},viewKeys:waiting?['pending']:e.ready?['ready']:[]}}))
const entry=(row:DataGridRow)=>props.entries.find(e=>e.id===row.id)!
function totals(filtered:DataGridRow[]){const values=filtered.map(entry),unique=[...new Map(values.map(e=>[e.factId||e.id,e])).values()];return[{label:'拉新订单',value:String(unique.filter(e=>e.metricType==='new_user').reduce((sum,e)=>sum+BigInt(e.quantity??'0'),0n))+' 单'},{label:'拉活量',value:String(unique.filter(e=>e.metricType==='activation').reduce((sum,e)=>sum+BigInt(e.quantity??'0'),0n))+' 个'},{label:props.wallet?'本人收益':'金额合计',value:'¥'+cashText(values.reduce((sum,e)=>sum+moneyValue(e.amount??'0'),0n))}]}
async function handle(e:BillEntry,key:string){selected.value=null;await nextTick();if(key==='assign')emit('assign',e);else if(key==='risk')emit('risk',e);else if(key==='changes')emit('changes',e)}
</script>
<template>
 <DataGrid title="金额明细" title-label="关键词" :rows="rows" :columns="[{key:'date',label:'日期'},{key:'type',label:'类型'},{key:'person',label:wallet?'付款方':'收款人'},{key:'quantity',label:'业绩',numeric:true},{key:'amount',label:'金额',numeric:true}]" :views="[{key:'all',label:'全部明细'},{key:'pending',label:'需要跟进'},...(!wallet?[{key:'ready',label:'可以确认'}]:[])]" :group-options="[{key:'status',label:'按状态'},{key:'person',label:wallet?'按付款方':'按收款人'},{key:'type',label:'按类型'}]" :totals="totals" :busy="busy" external-details empty-text="当前条件下还没有金额记录。财务上传报表后会自动显示。" @inspect="selected=entry($event)" @action="handle(entry($event.row),$event.key)">
  <template #cell="{row,column,value}"><template v-if="column.key==='amount'"><strong>{{value}}</strong><small>{{priceSource(entry(row))}}</small><small v-if="entry(row).settlementMismatch" class="warning">结算金额对不上：报表 {{money(entry(row).settlementMismatch!.actual)}}，按拉活量应为 {{money(entry(row).settlementMismatch!.expected)}}</small></template><template v-else-if="column.key==='quantity'"><span>{{value}}</span><ValueComparison v-if="entry(row).comparison?.length" :rows="entry(row).comparison!" /></template><template v-else>{{value}}</template></template>
 </DataGrid>
 <DetailDrawer :open="!!selected" :title="selected?.keyword??'金额明细'" @close="selected=null">
  <div v-if="selected" class="bill-detail">
   <p>{{selected.date}} · {{typeName(selected)}} · {{status(selected)}}</p><p>{{wallet?'付款方':'收款人'}}：{{wallet?selected.payerName:selected.payeeName}}</p>
   <h3>计算过程</h3><p v-if="selected.calculation">{{selected.calculation.quantity}}{{unit(selected)}} × ¥{{selected.calculation.unitPrice}} = {{money(selected.calculation.beforeRiskAmount)}}</p><p v-else>数量：{{selected.quantity??'未提供'}}{{unit(selected)}}。{{selected.reason}}</p>
   <p>{{priceSource(selected)}}</p><p v-if="selected.riskReview">核实结果：{{selected.riskReview.decision==='excluded'?'本条不计费':'已核实通过'}}。{{selected.riskReview.reason}}</p>
   <dl><div><dt>{{wallet?'本人收益':'应付金额'}}</dt><dd>{{money(selected.amount)}}</dd></div><div><dt>已确认</dt><dd>{{money(selected.confirmedAmount)}}</dd></div><div><dt>{{selected.kind==='adjustment'?'待确认更正':'待确认'}}</dt><dd>{{money(selected.pendingAmount)}}</dd></div></dl>
   <ValueComparison v-if="selected.comparison?.length" :rows="selected.comparison" />
   <p v-if="selected.next">下一步：{{selected.next}}</p><button v-if="action(selected)" :disabled="busy" @click="handle(selected,action(selected)!.key)">{{action(selected)?.label}}</button>
  </div>
 </DetailDrawer>
</template>
<style scoped>
small{display:block;white-space:normal;overflow-wrap:anywhere;font-size:12px;font-weight:400;color:var(--muted,#52666c)}.warning{color:#8a560b}.bill-detail{display:grid;gap:16px;overflow-wrap:anywhere}.bill-detail p,.bill-detail h3{margin:0}.bill-detail dl{display:grid;gap:12px;margin:0}.bill-detail dl>div{display:flex;justify-content:space-between;gap:12px}.bill-detail dd{margin:0;font-variant-numeric:tabular-nums}.bill-detail button{justify-self:start;min-height:44px;padding:10px 14px;border:1px solid var(--line,#dce3e5);border-radius:8px;font:inherit}
</style>
