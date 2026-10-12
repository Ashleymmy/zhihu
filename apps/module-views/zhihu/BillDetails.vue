<script setup lang="ts">
import {computed,nextTick,ref,watch} from 'vue'
import {DataGrid,DetailDrawer,ValueComparison,type DataGridRow} from '@zhihu-koc/shared-components'
import {type BillEntry,moneyValue,cashText} from './bill-entry'
import TraceDrawer from './Finance/components/TraceDrawer.vue'
import type {EngineContext} from './context'
const props=defineProps<{context?:EngineContext;entries:BillEntry[];wallet?:boolean;adminDuty:string;canSetRates?:boolean;busy?:boolean;layout?:'table'|'cards'|'todo'}>()
const emit=defineEmits<{assign:[entry:BillEntry];risk:[entry:BillEntry];changes:[entry:BillEntry];rates:[entry:BillEntry];agency:[];followup:[entry:BillEntry];match:[entry:BillEntry]}>()
const cardPage=ref(1)
const expanded=ref('')
watch(()=>props.entries,()=>{cardPage.value=1;expanded.value=''})
const pageEntries=computed(()=>props.entries.slice((cardPage.value-1)*20,cardPage.value*20))
const todoGroups=computed(()=>{
 const groups=new Map<string,BillEntry[]>()
 for(const e of pageEntries.value){const name=e.reasonCode?.startsWith('PRICE_')?'单价待补齐':e.reasonCode?.startsWith('AGENCY_')||['CHANNEL_UNMAPPED','CHANNEL_AMBIGUOUS','PROJECT_MISMATCH','KEYWORD_UNKNOWN'].includes(e.reasonCode)?'报表信息待核对':e.reasonCode==='SOURCE_REVISION_PENDING'?'报表更正待核对':e.reasonCode==='RISK_REVIEW_REQUIRED'?'风险信息待核实':'执行与金额待核对';groups.set(name,[...(groups.get(name)??[]),e])}
 return [...groups].map(([name,entries])=>({name,entries}))
})
const selected=ref<BillEntry|null>(null)
watch(()=>props.entries,entries=>{if(selected.value)selected.value=entries.find(e=>e.id===selected.value?.id)??null})
const money=(v:string|null)=>v===null?'待计算':'¥'+cashText(moneyValue(v))
const typeName=(e:BillEntry)=>e.metricType==='activation'?'拉活':'拉新'
const unit=(e:BillEntry)=>e.metricType==='activation'?'个':'单'
const priceSource=(e:BillEntry)=>(e.priceSources??[]).map(source=>source==='role_rate'?'按角色单价':'按成员报价').join(' · ')
const status=(e:BillEntry)=>e.internal&&!e.reasonCode?'已记录管理员业绩':e.status==='confirmed'?(e.reasonCode==='RISK_EXCLUDED'?'已确认不计费':'已确认'):e.ready?'待财务确认':e.reason||e.blocked||'平台核对中'
const action=(e:BillEntry)=>e.reasonCode?.startsWith('AGENCY_')&&!props.wallet?{key:'agency',label:'核对代理名称'}:e.reasonCode==='BINDING_MISSING'&&Number(e.canAssignRetro)===1?{key:'assign',label:'指定执行人'}:!props.wallet&&props.adminDuty!=='finance'&&e.reasonCode==='RISK_REVIEW_REQUIRED'?{key:'risk',label:'核实风险'}:!props.wallet&&e.reasonCode==='SOURCE_REVISION_PENDING'?{key:'changes',label:'核对原值与新值'}:props.canSetRates&&e.reasonCode?.startsWith('PRICE_')?{key:'rates',label:'查看与设置单价'}:!props.wallet&&['KEYWORD_UNKNOWN','CHANNEL_UNMAPPED','CHANNEL_AMBIGUOUS','PROJECT_MISMATCH'].includes(e.reasonCode)?{key:'match',label:props.adminDuty==='finance'?'查看报表处理进度':'核对报表记录'}:e.keywordId&&['BINDING_MISSING','PERIOD_AMBIGUOUS','WORK_MISSING','WORK_UNVERIFIED','WORK_DISPUTED'].includes(e.reasonCode)?{key:'followup',label:props.adminDuty==='finance'?'查看执行进度':'核对执行与作品'}:undefined
const rows=computed<DataGridRow[]>(()=>props.entries.map(e=>{const done=e.status==='confirmed'||e.status==='excluded'||!!e.internal&&!e.reasonCode,waiting=!!e.reasonCode&&!done,next=e.next.split('：');return{id:e.id,title:e.keyword,status:{key:done?e.status:e.ready?'ready':e.reasonCode||'waiting',label:status(e),tone:done?'success':e.ready?'success':action(e)?'danger':'warning'},cells:{date:e.date,type:typeName(e),person:props.wallet?e.payerName:e.payeeName,quantity:(e.quantity??'—')+unit(e),amount:money(e.amount)},next:done?undefined:{actor:next.length>1?next[0]!:'财务',text:next.length>1?next.slice(1).join('：'):e.next||'核对金额',action:action(e)},viewKeys:waiting?['pending']:e.ready?['ready']:[]}}))
const entry=(row:DataGridRow)=>props.entries.find(e=>e.id===row.id)!
function totals(filtered:DataGridRow[]){const values=filtered.map(entry),unique=[...new Map(values.map(e=>[e.factId||e.id,e])).values()];return[...(unique.some(e=>e.amount===null)?[{label:'待计算',value:unique.filter(e=>e.amount===null).length+' 条'}]:[]),{label:'拉新订单',value:String(unique.filter(e=>e.metricType==='new_user').reduce((sum,e)=>sum+BigInt(e.quantity??'0'),0n))+' 单'},{label:'拉活量',value:String(unique.filter(e=>e.metricType==='activation').reduce((sum,e)=>sum+BigInt(e.quantity??'0'),0n))+' 个'},{label:props.wallet?'本人收益':'金额合计',value:'¥'+cashText(values.filter(e=>!e.internal).reduce((sum,e)=>sum+moneyValue(e.amount??'0'),0n))},...(values.some(e=>e.internal)?[{label:'管理员业绩（不计入应付）',value:'¥'+cashText(values.filter(e=>e.internal).reduce((sum,e)=>sum+moneyValue(e.amount??'0'),0n))}]:[])]}
async function handle(e:BillEntry,key:string){selected.value=null;await nextTick();if(key==='assign')emit('assign',e);else if(key==='risk')emit('risk',e);else if(key==='changes')emit('changes',e);else if(key==='rates')emit('rates',e);else if(key==='agency')emit('agency');else if(key==='followup')emit('followup',e);else if(key==='match')emit('match',e)}
</script>
<template>
 <DataGrid v-if="!layout||layout==='table'" title="金额明细" title-label="关键词" :rows="rows" :columns="[{key:'date',label:'日期'},{key:'type',label:'类型'},{key:'person',label:wallet?'付款方':'人员'},{key:'quantity',label:'业绩',numeric:true},{key:'amount',label:'金额',numeric:true}]" :views="[{key:'all',label:'全部明细'},{key:'pending',label:'需要跟进'},...(!wallet?[{key:'ready',label:'可以确认'}]:[])]" :group-options="[{key:'status',label:'按状态'},{key:'person',label:wallet?'按付款方':'按人员'},{key:'type',label:'按类型'}]" :totals="totals" :busy="busy" external-details empty-text="当前条件下还没有金额记录。财务上传报表后会自动显示。" @inspect="selected=entry($event)" @action="handle(entry($event.row),$event.key)">
  <template #cell="{row,column,value}"><template v-if="column.key==='amount'"><strong>{{value}}</strong><small>{{priceSource(entry(row))}}</small><small v-if="entry(row).internal">管理员业绩，不计入应付</small><small v-if="entry(row).settlementMismatch" class="warning">结算金额对不上：报表 {{money(entry(row).settlementMismatch!.actual)}}，按拉活量应为 {{money(entry(row).settlementMismatch!.expected)}}</small></template><template v-else-if="column.key==='quantity'"><span>{{value}}</span><ValueComparison v-if="entry(row).comparison?.length" :rows="entry(row).comparison!" /></template><template v-else>{{value}}</template></template>
 </DataGrid>
 <template v-if="layout==='cards'">
  <article v-for="e in pageEntries" :key="e.id" class="fact">
   <button class="fact-header" :aria-expanded="expanded===e.id" @click="expanded=expanded===e.id?'':e.id"><span><b>{{e.keyword}}</b><span class="fact-meta">{{e.date}} · {{typeName(e)}} {{e.quantity??'—'}}{{unit(e)}} · {{e.payeeName}}</span></span><span><strong>{{money(e.amount)}}</strong><span class="badge" :class="e.status==='confirmed'?'ok':e.ready?'info':'warn'">{{status(e)}}</span></span></button>
   <div v-if="expanded===e.id" class="detail drill">
    <div class="layer"><b>金额计算</b><p v-if="e.calculation">{{e.calculation.quantity}}{{unit(e)}} × ¥{{e.calculation.unitPrice}} = {{money(e.calculation.beforeRiskAmount)}}</p><p v-else>{{e.reason||'金额资料待补齐'}}</p><p>{{priceSource(e)}}</p><p v-if="e.riskReview">核实结果：{{e.riskReview.decision==='excluded'?'本条不计费':'已核实通过'}}。{{e.riskReview.reason}}</p><p v-if="e.settlementMismatch" class="warning">报表结算 {{money(e.settlementMismatch.actual)}}，按拉活量计算 {{money(e.settlementMismatch.expected)}}</p></div>
    <ValueComparison v-if="e.comparison?.length" :rows="e.comparison"/>
    <TraceDrawer v-if="context&&!wallet&&e.factId" :context="context" :entry="e"/>
    <div class="fact-actions"><button @click="selected=e">查看完整明细</button><button v-if="action(e)" :disabled="busy" @click="handle(e,action(e)!.key)">{{action(e)?.label}}</button></div>
   </div>
  </article>
 </template>
 <template v-if="layout==='todo'">
  <section v-for="g in todoGroups" :key="g.name" class="todo-group"><header><b>{{g.name}}</b><span class="badge warn">本页 {{g.entries.length}} 条</span></header><article v-for="e in g.entries" :key="e.id" class="todo"><div class="body"><b>{{e.keyword}}</b><p>{{e.date}} · {{typeName(e)}} {{e.quantity??'—'}}{{unit(e)}} · {{e.payeeName}}</p><p>{{e.reason||e.blocked||status(e)}}</p><small v-if="e.next">{{e.next}}</small></div><div class="actions"><button v-if="action(e)" :disabled="busy" @click="handle(e,action(e)!.key)">{{action(e)?.label}}</button><button @click="selected=e">查看明细</button></div></article></section>
 </template>
 <template v-if="layout==='cards'||layout==='todo'"><p v-if="!entries.length" class="muted">{{layout==='todo'?'当前账单没有待处理记录，报表问题见下方。':'当前条件下没有金额记录，请调整人员、日期或业绩类型。'}}</p><div v-if="entries.length>20" class="fact-pagination"><button :disabled="busy||cardPage===1" @click="cardPage--;expanded=''">上一页明细</button><span>第 {{cardPage}} / {{Math.ceil(entries.length/20)}} 页 · {{entries.length}} 条</span><button :disabled="busy||cardPage*20>=entries.length" @click="cardPage++;expanded=''">下一页明细</button></div></template>
 <DetailDrawer :open="!!selected" :title="selected?.keyword??'金额明细'" @close="selected=null">
  <div v-if="selected" class="bill-detail">
   <p>{{selected.date}} · {{typeName(selected)}} · {{status(selected)}}</p><p>{{selected.internal?'执行人':wallet?'付款方':'收款人'}}：{{wallet?selected.payerName:selected.payeeName}}</p>
   <p v-if="selected.reportedSettlement!==undefined&&!wallet">报表结算金额：{{selected.reportedSettlement==null?'原表未提供':money(selected.reportedSettlement)}}<small>报表金额与成员应付分别核对。</small></p>
   <p v-if="selected.internal">按当前结算约定，只记录内部业绩，不计入成员应付。</p><h3>{{selected.internal?'内部业绩计算':'成员金额计算'}}</h3><p v-if="selected.calculation">{{selected.calculation.quantity}}{{unit(selected)}} × ¥{{selected.calculation.unitPrice}} = {{money(selected.calculation.beforeRiskAmount)}}</p><p v-else>数量：{{selected.quantity??'未提供'}}{{unit(selected)}}。{{selected.reason}}</p>
   <p>{{priceSource(selected)}}</p><p v-if="selected.riskReview">核实结果：{{selected.riskReview.decision==='excluded'?'本条不计费':'已核实通过'}}。{{selected.riskReview.reason}}</p>
   <dl><div><dt>{{selected.internal?'管理员业绩':wallet?'本人收益':'应付金额'}}</dt><dd>{{money(selected.amount)}}</dd></div><div v-if="!selected.internal"><dt>已确认</dt><dd>{{money(selected.confirmedAmount)}}</dd></div><div v-if="!selected.internal"><dt>{{selected.kind==='adjustment'?'待确认更正':'待确认'}}</dt><dd>{{money(selected.amount===null?null:selected.pendingAmount)}}</dd></div></dl>
   <ValueComparison v-if="selected.comparison?.length" :rows="selected.comparison" />
   <TraceDrawer v-if="context&&!wallet&&selected.factId" :context="context" :entry="selected"/>
   <p v-if="selected.next">下一步：{{selected.next}}</p><button v-if="action(selected)" :disabled="busy" @click="handle(selected,action(selected)!.key)">{{action(selected)?.label}}</button>
   <button v-if="selected.keywordId&&action(selected)?.key!=='followup'" :disabled="busy" @click="handle(selected,'followup')">查看执行人与已有作品</button>
  </div>
 </DetailDrawer>
</template>
<style scoped>
.fact-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;width:100%;text-align:left;border:0!important;border-radius:0!important;background:#fff;font:inherit;padding:14px!important;cursor:pointer}.fact-header>span{display:grid;gap:6px;min-width:0}.fact-header>span:last-child{text-align:right}.fact-header b,.fact-meta{overflow-wrap:anywhere}.fact-meta{font-size:12px;color:var(--muted,#637078)}.fact-header .badge{white-space:normal;line-height:1.5}.fact-actions,.fact-pagination{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.layer p,.todo p{margin:6px 0}.todo .body{min-width:0!important;flex-basis:200px!important}.fact strong{font-variant-numeric:tabular-nums}.fact-header:hover{background:#f8fafa}

small{display:block;white-space:normal;overflow-wrap:anywhere;font-size:12px;font-weight:400;color:var(--muted,#52666c)}.warning{color:#8a560b}.bill-detail{display:grid;gap:16px;overflow-wrap:anywhere}.bill-detail p,.bill-detail h3{margin:0}.bill-detail dl{display:grid;gap:12px;margin:0}.bill-detail dl>div{display:flex;justify-content:space-between;gap:12px}.bill-detail dd{margin:0;font-variant-numeric:tabular-nums}.bill-detail button{justify-self:start;min-height:44px;padding:10px 14px;border:1px solid var(--line,#dce3e5);border-radius:8px;font:inherit}
</style>
