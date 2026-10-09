<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import Issues from './Issues.vue'
import BillDetails from './BillDetails.vue'
import type {BillEntry as Entry} from './bill-entry'
import AssignExecutor from './AssignExecutor.vue'
import ReportAnalysis from './ReportAnalysis.vue'
import RiskReview from './RiskReview.vue'
import type {RiskCase,ReportAnswer} from './report-analysis'
import {CashWallet,RateSettings,type AnalysisRunModel} from '@zhihu-koc/shared-components'
import { errorText, requestKey, type EngineContext } from './context'
const props=defineProps<{context:EngineContext; wallet?:boolean;initialFrom?:string;initialTo?:string}>()
const emit=defineEmits<{issues:[]}>()
interface Group {payeeId:string;name:string;confirmed:string;pending:string;total:string;blockers:string[];ready:number}
interface TypeSummary {staffAmount:string;excludedQuantity:string;records:number;quantity:string;billableQuantity:string;pendingQuantity:string;payable:string;confirmedPayable:string;pendingPayable:string;receivable:string;confirmedReceivable:string;pendingReceivable:string}
interface View {summary:{records:number;totalRecords:number;orders:string;totalOrders:string;billableOrders:string;pendingOrders:string;issues:number;receivable:string;confirmedReceivable:string;pendingReceivable:string;payable:string;confirmedPayable:string;pendingPayable:string;retained:string;byType:Record<'newUser'|'activation',TypeSummary>;staffAmount:string};entries:Entry[];groups:Group[];teamPerformance?:{executorId:string;name:string;orders:string;commission:string;activations:string;activationCommission:string}[];reviewHash:string;needsReview:boolean;withdrawal:{enabled:boolean;message:string}}
interface Batch {id:string;fileName:string;status:string;lastError?:string}
interface ImportDetail {fileName:string;counts:{processingStatus:string;total:number}[];rows:{id:string;lineNumber:number;processingStatus:string;errorText:string|null;next?:string}[]}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
const requestedPeriod = /^\d{4}-\d{2}-\d{2}$/.test(props.initialFrom||'') && /^\d{4}-\d{2}-\d{2}$/.test(props.initialTo||'') && props.initialFrom! <= props.initialTo!
const period=reactive({from:requestedPeriod?props.initialFrom!:today.slice(0,7)+'-01',to:requestedPeriod?props.initialTo!:today})
const view=ref<View|null>(null),busy=ref(false),error=ref(''),errorHelp=ref(''),notice=ref(''),file=ref<File|null>(null),progress=ref(''),history=ref<Batch[]>([])
const walletVersion=ref(0)
const risk=ref<RiskCase|null>(null)
const riskEntry=(e:Entry)=>{risk.value={factId:e.factId,revisionId:e.revisionId,keyword:e.keyword,riskAssessment:e.riskAssessment??""}}
const assignment=ref<Entry|null>(null)
async function assigned(name:string){assignment.value=null;notice.value='已指定给 '+name+'，相关金额已重新计算。';await run(refresh)}
type ReportType='new_user'|'activation'
function savedReportType():ReportType{try{return localStorage.getItem('zhihu.reportType')==='activation'?'activation':'new_user'}catch{return 'new_user'}}
const reportType=ref<ReportType>(savedReportType()),suggestedType=ref<ReportType|null>(null)
const typeFilter=ref<ReportType|''>('')
const ratesOpen=ref(false),ratesType=ref<ReportType>('new_user')
function openRates(type:ReportType){ratesType.value=type;ratesOpen.value=true}
async function ratesPublished(result:{effectiveFrom:string;recalculated:number}){notice.value='已发布单价，'+result.effectiveFrom+' 起生效。';await run(async()=>{await refresh();if(importId.value)await inspectImport(importId.value)})}
const types:ReportType[]=['new_user','activation']
const typeName=(type:ReportType)=>type==='activation'?'拉活':'拉新'
const typeKey=(type:ReportType)=>type==='new_user'?'newUser':'activation'
const unit=(type:ReportType)=>type==='activation'?'个':'单'
function chooseReportType(value:ReportType){reportType.value=value;suggestedType.value=null;try{localStorage.setItem('zhihu.reportType',value)}catch{}}
const importResult=ref<ImportDetail|null>(null),importId=ref(''),importPage=ref(1),uploadInput=ref<HTMLInputElement|null>(null)
const analysis=ref<AnalysisRunModel|null>(null),busyAskId=ref(''),askErrors=reactive<Record<string,string>>({})
const importTotal=computed(()=>importResult.value?.counts.reduce((sum,c)=>sum+c.total,0)??0)
const rowStatus=(status:string)=>({invalid:'需要修正',skipped:'已跳过',pending:'正在处理',processed:'已计算',duplicate:'已读取，不重复计算',exception:'需要处理',legacy_settled:'旧系统已结算'}[status]??'已读取')
async function inspectImport(id:string,page=1){
 importId.value=id;importPage.value=page
 const [detail,run]=await Promise.all([props.context.http.get<ImportDetail>('/imports/'+id,{...props.context.scope,page,pageSize:25}),props.context.http.get<AnalysisRunModel>('/imports/'+id+'/analysis',props.context.scope)])
 importResult.value=detail;analysis.value=run
}
async function answerAnalysis(answer:ReportAnswer){
 if(busy.value||busyAskId.value)return
 busy.value=true;busyAskId.value=answer.askId;askErrors[answer.askId]=''
 try{analysis.value=await post('/imports/'+importId.value+'/answers',answer) as AnalysisRunModel;await refresh();await inspectImport(importId.value);notice.value=answer.option==='skip'?'已暂时跳过，这项记录仍保留在待处理中。':'已保存选择，相关金额已自动更新。'}
 catch(error){askErrors[answer.askId]=errorText(error)}finally{busyAskId.value='';busy.value=false}
}
function analysisAction(action:string){
 if(action==='details')openDetails('')
 else if(action==='replace-file')uploadInput.value?.click()
 else if(action==='retry')void run(async()=>{await post('/imports/'+importId.value+'/process');await track(importId.value)})
}
const confirming=ref(false),checked=ref(false),selected=ref(''),detailPage=ref(1),detailsOpen=ref(false),detailPanel=ref<HTMLDetailsElement|null>(null)
const money=(v:string|null|undefined)=>{
 if(v===null)return '—'
 const raw=v||'0',negative=raw.startsWith('-'),[whole='0',fraction='']=raw.replace(/^-/,'').split('.')
 const cents=(BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0').slice(0,4))+50n)/100n
 return (negative&&cents?'-':'')+String(cents/100n).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+String(cents%100n).padStart(2,'0')
}
const priceSource=(e:Entry)=>(e.priceSources??[]).map(source=>source==='role_rate'?'按角色单价':'按成员报价').join(' · ')
const entryStatus=(e:Entry)=>e.status==='confirmed'?(e.reasonCode==='RISK_EXCLUDED'?'已确认不计费':'已确认'):e.reason||e.blocked||'待财务确认'
const admin=computed(()=>props.context.role==='admin'&&props.context.adminDuty!=='operations'),creator=computed(()=>props.context.role==='creator')
const visible=computed(()=>view.value?.entries.filter(e=>props.wallet?e.ownReceivable:e.ownPayable)??[])
const performanceOnly=ref(false)
const details=computed(()=>visible.value.filter(e=>(!performanceOnly.value||e.internal)&&(!typeFilter.value||e.metricType===typeFilter.value)&&(!selected.value||e.payeeId===selected.value||(props.context.role==='admin'&&e.parentId===selected.value))))
const issues=ref<InstanceType<typeof Issues>>(),issuePanel=ref<HTMLDetailsElement>()
async function inspectConflict(entry:Entry){if(issuePanel.value)issuePanel.value.open=true;await nextTick();await issues.value?.inspectFact(entry.factId)}
const total=(field:keyof Pick<TypeSummary,'payable'|'confirmedPayable'|'pendingPayable'|'receivable'|'confirmedReceivable'|'pendingReceivable'>)=>{
 const value=types.reduce((sum,type)=>{const [whole='0',fraction='']=(view.value?.summary.byType[typeKey(type)][field]??'0').split('.');return sum+BigInt(whole.replace('-',''))*10000n*(whole.startsWith('-')?-1n:1n)+BigInt(fraction.padEnd(4,'0'))*(whole.startsWith('-')?-1n:1n)},0n)
 const magnitude=value<0n?-value:value
 return (value<0n?'-':'')+String(magnitude/10000n)+'.'+String(magnitude%10000n).padStart(4,'0')
}
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false,polling=false
function post(path:string,data:object={}){return props.context.http.post(path,{...props.context.scope,...data,requestKey:requestKey()})}
async function refresh(){view.value=await props.context.http.get<View>('/workbench',{...props.context.scope,...period,viewVersion:'2'});detailPage.value=1;if(view.value.entries.some(e=>e.status==='pending'))detailsOpen.value=true}
async function load(){await refresh();if(admin.value)history.value=(await props.context.http.get<{list:Batch[]}>('/imports',{...props.context.scope,page:1,pageSize:5})).list}
function showError(e:unknown){
 const message=errorText(e);error.value=message;errorHelp.value='';
 const suggested=typeof e==='object'&&e!==null&&'extras' in e?(e as {extras?:{suggestedType?:unknown}}).extras?.suggestedType:undefined
 suggestedType.value=suggested==='activation'||suggested==='new_user'?suggested:null
 if(message.includes('上传文件不符合')){error.value='报表文件暂时无法读取';errorHelp.value='请在 Excel 或 WPS 中另存为 .xlsx 或 CSV 后再上传。';}
 else if(message.includes('无法识别')){errorHelp.value='请按行号检查日期、渠道名称、关键词和订单量；空白行可以保留，修正后重新上传。';}
}
async function run(work:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';errorHelp.value='';try{await work()}catch(e){showError(e)}finally{busy.value=false}}
async function track(id:string){
 if(disposed||polling)return
 polling=true
 try{
  importId.value=id;analysis.value=await props.context.http.get<AnalysisRunModel>('/imports/'+id+'/analysis',props.context.scope)
  if(analysis.value.status!=='running'){progress.value='';notice.value=analysis.value.status==='failed'?'报表处理暂时中断，已完成的结果已保留。':'报表已分析完成，人员归属和金额已更新。';await load();await inspectImport(id)}
  else{progress.value='正在分析报表，剩余 '+((analysis.value.progress?.total??0)-(analysis.value.progress?.done??0))+' 条…';timer=setTimeout(()=>{void track(id)},1000)}
 }catch(e){progress.value='';showError(new Error('分析进度暂时无法读取，请刷新查看：'+errorText(e)))}
 finally{polling=false}
}
async function upload(){
 if(!file.value)return
 const form=new FormData();form.append('file',file.value);form.append('projectId',props.context.scope.projectId);form.append('accountId',props.context.scope.accountId);form.append('reportType',reportType.value)
 progress.value='正在读取报表并计算…';notice.value=''
 try{
  const r=await props.context.http.postForm<{id:string;from:string;to:string;duplicate:boolean}>('/workbench/import',form)
  period.from=r.from;period.to=r.to
  if(r.duplicate)notice.value='这份报表已经上传，已为你打开原来的结果，不会重复计账。'
  await load();await track(r.id)
 }catch(e){progress.value='';throw e}
}
async function confirm(){
 if(!view.value||!checked.value)return
 const r=await post('/workbench/confirm',{...period,viewVersion:'2',reviewHash:view.value.reviewHash,acknowledged:true}) as {confirmed:number;waiting:number}
 confirming.value=false;checked.value=false
 notice.value='已核对本期金额，确认 '+r.confirmed+' 条账单。'+(r.waiting?'其余账单待作品提交成功或数据问题处理完成后再确认。':'')
 await refresh();walletVersion.value++
}
function openDetails(payeeId:string){
 performanceOnly.value=false;selected.value=payeeId
 detailPage.value=1
 detailsOpen.value=true
 void nextTick(()=>detailPanel.value?.scrollIntoView({behavior:'smooth',block:'start'}))
}
function exportBill(){
 if(!view.value)return
 const cell=(s:unknown)=>'"'+String(s??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"'
 const rows=props.wallet?[['日期','类型','关键词','数量','单位','付款方','收入（元）','状态'],...details.value.map(e=>[e.date,typeName(e.metricType),e.keyword,e.quantity,unit(e.metricType),e.payerName,e.amount,entryStatus(e)])]
 :[['收款人','已确认应付（元）','待确认应付（元）','合计（元）','待办'],...view.value.groups.map(g=>[g.name,g.confirmed,g.pending,g.total,g.blockers.join('；')])]
 const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})
 const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=(props.wallet?'收入明细':'财务对账单')+'_'+period.from+'_'+period.to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
onMounted(()=>run(async()=>{await load();const pending=history.value.find(b=>b.status==='committed');if(pending)await track(pending.id)}))
onUnmounted(()=>{disposed=true;if(timer)clearTimeout(timer)})
</script>
<template>
 <section class="work-section">
  <div v-if="admin && !wallet" class="upload-box">
   <div><h2>上传知乎报表，自动计算每个人的金额</h2><p>{{reportType==='activation'?'读取日期、渠道、关键词和拉活量，按拉活单价计算金额。':'读取日期、渠道、关键词、搜索量和订单量，按拉新单价计算金额。'}}</p></div>
   <fieldset class="report-types" :disabled="busy||!!progress"><legend>报表类型</legend><label :class="{chosen:reportType==='new_user'}"><input type="radio" name="reportType" value="new_user" :checked="reportType==='new_user'" @change="chooseReportType('new_user')" /><strong>拉新订单</strong><span>知乎邮件订单报表 · 订单量</span></label><label :class="{chosen:reportType==='activation'}"><input type="radio" name="reportType" value="activation" :checked="reportType==='activation'" @change="chooseReportType('activation')" /><strong>拉活</strong><span>拉活补贴表 · 拉活量</span></label></fieldset>
   <ol class="upload-steps"><li>选择知乎导出的 .xlsx 或 CSV 文件</li><li>点击“上传并自动分析”</li><li>查看识别结果和待处理原因，确认无误后再核对账单</li></ol>
   <p class="upload-tip">{{reportType==='activation'?'支持含有“日期 / 渠道名称 / 关键词 / 拉活量”表头的报表。':'支持含有“日期 / 渠道名称 / 关键词”以及“搜索量”或“订单量”表头的报表。'}}任何日期的报表都可以在这里上传。</p>
   <form @submit.prevent="run(upload)"><label>选择报表文件<input ref="uploadInput" type="file" accept=".xlsx,.csv,.xls" required :disabled="busy||!!progress" @change="file=($event.target as HTMLInputElement).files?.[0]??null" /></label><button class="primary" :disabled="busy||!!progress||!file">{{progress?'正在分析…':'上传并自动分析'}}</button></form>
  </div>
  <div v-if="error" role="alert" class="engine-error"><strong>{{error}}</strong><span v-if="errorHelp">{{errorHelp}}</span><button v-if="suggestedType" :disabled="busy" @click="chooseReportType(suggestedType);run(upload)">{{suggestedType==='activation'?'按拉活处理':'按拉新订单处理'}}</button></div><p v-if="notice" role="status">{{notice}}</p><p v-if="progress" role="status">{{progress}}</p>
  <ReportAnalysis v-if="admin&&!wallet&&analysis" :context="context" :run="analysis" :busy-ask-id="busyAskId" :errors="askErrors" :busy-action="busy?'working':''" @answer="answerAnalysis" @action="analysisAction" @refresh="run(async()=>{await inspectImport(importId);await refresh()})" />
  <section v-if="admin&&!wallet&&importResult" class="work-card" aria-label="报表读取结果">
   <h2>{{importResult.fileName}} · 读取结果</h2>
   <p>共读取 {{importTotal}} 行，每行的处理结果都已保留。</p>
   <ul class="report-rows"><li v-for="row in importResult.rows" :key="row.id"><strong>第 {{row.lineNumber}} 行 · {{rowStatus(row.processingStatus)}}</strong><span>{{row.errorText||'这行已读取，金额和待处理事项见下方账单。'}}</span><span v-if="row.next">下一步：{{row.next}}</span><span v-if="row.processingStatus==='invalid'">下一步：财务：修正这行后补传报表 <button :disabled="busy" @click="uploadInput?.click()">选择修正后的报表</button></span></li></ul>
   <div v-if="importTotal>25" class="engine-actions"><button :disabled="busy||importPage===1" @click="run(()=>inspectImport(importId,importPage-1))">上一页</button><span>第 {{importPage}} 页</span><button :disabled="busy||importPage*25>=importTotal" @click="run(()=>inspectImport(importId,importPage+1))">下一页</button></div>
  </section>
  <form class="period-filter" @submit.prevent="run(refresh)"><label>开始日期<input type="date" v-model="period.from" required /></label><label>结束日期<input type="date" v-model="period.to" required /></label><button :disabled="busy">查看账单</button><button v-if="admin&&!wallet" type="button" :disabled="busy" @click="openRates(typeFilter||reportType)">查看与设置单价</button></form>
  <div v-if="view" class="metric-grid">
   <article><span>{{wallet?'已确认收入':'应付合计'}}</span><strong>¥{{money(total(wallet?'confirmedReceivable':'payable'))}}</strong></article>
   <article><span>{{wallet?'待确认收入':'已确认应付'}}</span><strong>¥{{money(total(wallet?'pendingReceivable':'confirmedPayable'))}}</strong></article>
   <article><span>{{wallet&&!creator?'本人应得收入':'拉新订单'}}</span><strong>{{wallet&&!creator?'¥'+money(total('receivable')):view.summary.totalOrders+' 单'}}</strong><span v-if="!wallet||creator">拉活 {{view.summary.byType.activation.quantity}} 个</span></article>
  </div>
   <div v-if="view" class="analysis-result type-totals"><div v-for="type in types" :key="type"><strong>{{typeName(type)}}：{{wallet?'本人收益':'可计费 '+view.summary.byType[typeKey(type)].billableQuantity+' '+unit(type)}} ¥{{money(view.summary.byType[typeKey(type)][wallet?'receivable':'payable'])}}</strong><span v-if="wallet">已确认 ¥{{money(view.summary.byType[typeKey(type)].confirmedReceivable)}} · 待确认 ¥{{money(view.summary.byType[typeKey(type)].pendingReceivable)}}</span><span v-else>读取 {{view.summary.byType[typeKey(type)].records}} 行 · 共 {{view.summary.byType[typeKey(type)].quantity}} {{unit(type)}} · {{view.summary.byType[typeKey(type)].pendingQuantity}} {{unit(type)}}在等处理<span v-if="view.summary.byType[typeKey(type)].excludedQuantity!=='0'"> · {{view.summary.byType[typeKey(type)].excludedQuantity}}{{unit(type)}}已核实不计费</span></span></div><div v-if="admin&&!wallet"><button type="button" class="staff-total" @click="openDetails('');performanceOnly=true">管理员业绩 ¥{{money(view.summary.staffAmount)}}（不计入应付）</button><span>拉新 ¥{{money(view.summary.byType.newUser.staffAmount)}} · 拉活 ¥{{money(view.summary.byType.activation.staffAmount)}}</span></div></div>

   <div v-if="view?.summary.issues && admin" class="attention"><strong>{{view.summary.issues}} 项数据需要处理</strong><span>明细已列出原因和下一步，金额已算出的记录可以继续核对。</span></div>
  <div v-if="view && !wallet" class="work-card bill-groups">
   <div class="section-heading"><div><h2>{{admin?'本期财务账单':'团队应付账单'}}</h2><p>{{admin?'按团长（含团队达人）和独立达人汇总，便于核对和做账。':'只需核对你应付给团队达人的金额。'}}</p></div>
    <div class="engine-actions"><button :disabled="!view.groups.length||busy" @click="exportBill">导出对账单</button><button v-if="admin" class="primary" :disabled="busy||!view.entries.some(e=>e.ready)&&!(admin&&view.needsReview&&view.summary.records>0)" @click="confirming=true;checked=false">核对并确认账单</button></div>
   </div>
   <div class="engine-table"><table><thead><tr><th>收款人</th><th>合计（元）</th><th>已确认</th><th>待确认</th><th>下一步</th><th></th></tr></thead><tbody><tr v-for="g in view.groups" :key="g.payeeId"><td>{{g.name}}</td><td>{{money(g.total)}}</td><td>{{money(g.confirmed)}}</td><td>{{money(g.pending)}}</td><td>{{g.blockers.join('；')||(g.ready?'可以确认':'已核对完成')}}</td><td><button @click="openDetails(g.payeeId)">看明细</button></td></tr></tbody></table></div>
   <ul class="bill-cards"><li v-for="g in view.groups" :key="g.payeeId"><strong>{{g.name}} · ¥{{money(g.total)}}</strong><span>已确认 ¥{{money(g.confirmed)}} · 待确认 ¥{{money(g.pending)}}</span><span>{{g.blockers.join('；')||(g.ready?'可以确认':'已核对完成')}}</span><button @click="openDetails(g.payeeId)">看明细</button></li></ul>
   <p class="empty-state" v-if="!view.groups.length">{{admin?'还没有账单，请先上传报表。':'财务上传报表后，这里会自动显示团队账单。'}}</p>
  </div>
  <div v-if="admin && confirming && view" class="confirm-box" role="region" aria-label="核对账单"><h2>确认本期账单</h2><p>{{period.from}} 至 {{period.to}}，本期应付合计 <strong>¥{{money(total('payable'))}}</strong>。</p><p>审核完成的账单会被确认；有待办的账单继续等待处理。此操作不会发起银行转账。</p><label class="check-label"><input type="checkbox" v-model="checked" />我已核对报表、人员和计算金额</label><div class="engine-actions"><button class="primary" :disabled="!checked||busy" @click="run(confirm)">确认核对结果</button><button :disabled="busy" @click="confirming=false">返回检查</button></div></div>
  <details ref="detailPanel" class="work-card bill-details" :open="wallet||detailsOpen" @toggle="detailsOpen=($event.currentTarget as HTMLDetailsElement).open"><summary>{{wallet?'我的收入明细':'查看关键词与金额明细'}}</summary><div class="engine-actions"><button v-if="selected||performanceOnly" @click="selected='';performanceOnly=false;detailPage=1">查看全部人员</button><button v-if="wallet" :disabled="!visible.length" @click="exportBill">导出收入明细</button></div>
   <label class="type-filter">业绩类型<select v-model="typeFilter" @change="detailPage=1"><option value="">全部</option><option value="new_user">拉新</option><option value="activation">拉活</option></select></label>
   <BillDetails :entries="details" :wallet="wallet" :admin-duty="context.adminDuty" :can-set-rates="admin&&!wallet" :busy="busy" @assign="assignment=$event" @risk="riskEntry" @changes="inspectConflict" @rates="openRates($event.metricType)" />
  </details>
  <div v-if="wallet&&context.role==='leader'&&view" class="work-card team-performance"><h2>团队业绩与分成</h2><div class="engine-table"><table><thead><tr><th>达人</th><th>订单量</th><th>拉新分成（元）</th><th>拉活量</th><th>拉活分成（元）</th></tr></thead><tbody><tr v-for="g in view.teamPerformance" :key="g.executorId"><td>{{g.name}}</td><td>{{g.orders}}单</td><td>{{money(g.commission)}}</td><td>{{g.activations}}个</td><td>{{money(g.activationCommission)}}</td></tr></tbody></table></div><ul class="team-cards"><li v-for="g in view.teamPerformance" :key="g.executorId"><strong>{{g.name}}</strong><span>拉新 {{g.orders}}单 · 给我的分成 ¥{{money(g.commission)}}</span><span>拉活 {{g.activations}}个 · 给我的分成 ¥{{money(g.activationCommission)}}</span></li></ul></div>
  <details ref="issuePanel" v-if="admin&&!wallet" class="work-card"><summary>报表问题与更正</summary><Issues ref="issues" :context="context" @changed="run(async()=>{await refresh();if(importId)await inspectImport(importId)})" /></details>
  <RiskReview :context="context" :item="risk" @close="risk=null" @saved="risk=null;run(async()=>{await refresh();if(importId)await inspectImport(importId)})" />
  <RateSettings v-if="admin&&!wallet" :open="ratesOpen" :project-id="context.scope.projectId" module-id="zhihu" :http="context.coreHttp" :initial-metric-type="ratesType" @close="ratesOpen=false" @published="ratesPublished" />
  <AssignExecutor v-if="assignment" :context="context" :keyword-id="assignment.keywordId" :keyword="assignment.keyword" :from-date="assignment.retroFromDate" @close="assignment=null" @saved="assigned" />
  <CashWallet :key="walletVersion" v-if="wallet||admin" :http="context.coreHttp" :scope="{...context.scope,moduleId:'zhihu'}" />
  <details v-if="admin&&!wallet" class="work-card"><summary>最近上传记录</summary><ul class="plain-list"><li v-for="b in history" :key="b.id"><button :disabled="busy" @click="run(()=>inspectImport(b.id))">{{b.fileName}}</button><span>{{b.status==='processed'?'已分析':b.status==='committed'?'分析中':'待处理'}}</span><button v-if="b.lastError||b.status==='committed'" :disabled="busy" @click="run(async()=>{await post('/imports/'+b.id+'/process');await track(b.id)})">继续分析</button></li></ul><p v-if="!history.length">尚未上传报表。</p></details>
 </section>
</template>



<style scoped>
.type-totals{display:grid;gap:14px}.type-totals>div{display:grid;gap:5px}.type-totals span{font-size:13px}.type-tag{display:inline-block;padding:3px 7px;font-size:12px;border-radius:4px;background:#e5eeee;color:#254f53;white-space:nowrap}.type-tag.activation{background:#ece8f5;color:#604b82}.type-filter{display:flex;align-items:center;gap:12px;margin:16px 0}.type-filter select{width:140px}.settlement-warning{display:block;color:#8e4a08;font-size:12px;line-height:1.5;max-width:230px;margin-top:6px}
.report-types{border:0;padding:0;margin:18px 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.report-types legend{margin-bottom:8px}.report-types label{display:grid;grid-template-columns:auto 1fr;gap:8px;padding:14px;border:1px solid #b5c7c6;border-radius:8px;cursor:pointer}.report-types label.chosen{border-color:#25656a;background:#e6f3f1}.report-types input{grid-row:span 2;width:auto;margin:3px 0}.report-types span{font-size:13px;color:#4b6263}.report-types label:focus-within{outline:2px solid #25656a;outline-offset:3px}
@media(max-width:600px){.report-types{grid-template-columns:1fr}}
.team-cards{display:none;list-style:none;padding:0}.team-cards li{display:grid;gap:6px;padding:12px;border-bottom:1px solid var(--line)}
.bill-cards{display:none;list-style:none;padding:0}.bill-cards li{display:grid;gap:8px;padding:14px;border:1px solid var(--line,#ddd);border-radius:8px;overflow-wrap:anywhere}.bill-cards button{justify-self:start}.pending{background:#fff8ed}.bill-details td:last-child{min-width:160px}
@media(max-width:600px){.team-performance .engine-table,.bill-groups .engine-table,.bill-details .engine-table{display:none}.team-cards,.bill-cards{display:grid;gap:8px}}
.report-rows{list-style:none;padding:0;display:grid;gap:10px}.report-rows li{display:grid;gap:6px;padding:12px;border:1px solid var(--color-border,#ddd);border-radius:8px;overflow-wrap:anywhere}
.upload-steps{display:flex;gap:24px;flex-wrap:wrap;margin:18px 0 10px;padding:0 0 0 20px;color:#31575c}
.upload-steps li{padding-right:12px}
.upload-tip{font-size:13px;margin:8px 0 18px;color:#637078}
.analysis-result{display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-top:18px;padding:16px 18px;border:1px solid #c6dfdd;border-radius:10px;background:#f2faf9;color:#31575c}
.analysis-result strong{color:#194f54}
.engine-error{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.engine-error span{color:#7a3d42}
.engine-error button{margin-left:auto}
</style>
