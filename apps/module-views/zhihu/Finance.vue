<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import StepUpload from './Finance/components/StepUpload.vue'
import Objections from './Finance/components/Objections.vue'
import AgencySettings from './AgencySettings.vue'
import ExecutionFollowUp from './ExecutionFollowUp.vue'
import Issues from './Issues.vue'
import BillDetails from './BillDetails.vue'
import type {BillEntry as Entry} from './bill-entry'
import AssignExecutor from './AssignExecutor.vue'
import ReportAnalysis from './ReportAnalysis.vue'
import RiskReview from './RiskReview.vue'
import type {RiskCase,ReportAnswer} from './report-analysis'
import {ActionDialog,CashWallet,FinanceHistoryLinks,RateSettings,type AnalysisRunModel} from '@zhihu-koc/shared-components'
import { errorText, requestKey, type EngineContext } from './context'
const props=defineProps<{context:EngineContext; wallet?:boolean;initialFrom?:string;initialTo?:string;flow?:boolean;flowStep?:string}>()
const emit=defineEmits<{issues:[];navigate:[path:string];step:[value:string];period:[value:{from:string;to:string}]}>()
const steps=[{id:'upload',label:'上传与预览'},{id:'todo',label:'待处理'},{id:'review',label:'核对与确认'},{id:'payout',label:'线下发放'},{id:'records',label:'记录与导出'}]
const step=computed(()=>steps.some(s=>s.id===props.flowStep)?String(props.flowStep):'review')
const show=(...values:string[])=>!props.flow||values.includes(step.value)
function goStep(value:string){if(props.flow)emit('step',value)}

interface Group {payeeId:string;name:string;confirmed:string;pending:string;total:string;blockers:string[];ready:number}
interface TypeSummary {reportedSettlement?:string|null;reportedSettlementMissing?:number;unpricedRecords?:number;staffAmount:string;excludedQuantity:string;records:number;quantity:string;billableQuantity:string;pendingQuantity:string;payable:string;confirmedPayable:string;pendingPayable:string;receivable:string;confirmedReceivable:string;pendingReceivable:string}
interface View {summary:{records:number;totalRecords:number;orders:string;totalOrders:string;billableOrders:string;pendingOrders:string;issues:number;receivable:string;confirmedReceivable:string;pendingReceivable:string;payable:string;confirmedPayable:string;pendingPayable:string;retained:string;byType:Record<'newUser'|'activation',TypeSummary>;staffAmount:string};entries:Entry[];groups:Group[];teamPerformance?:{executorId:string;name:string;orders:string;commission:string;activations:string;activationCommission:string}[];reviewHash:string;needsReview:boolean;withdrawal:{enabled:boolean;message:string}}
interface Batch {id:string;fileName:string;reportKind:string;status:string;archivedAt:string|null;createdAt:string;lastError?:string}
interface ImportDetail extends Batch {counts:{processingStatus:string;total:number}[];rows:{id:string;lineNumber:number;processingStatus:string;errorText:string|null;next?:string}[]}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
const requestedPeriod = /^\d{4}-\d{2}-\d{2}$/.test(props.initialFrom||'') && /^\d{4}-\d{2}-\d{2}$/.test(props.initialTo||'') && props.initialFrom! <= props.initialTo!
const period=reactive({from:requestedPeriod?props.initialFrom!:today.slice(0,7)+'-01',to:requestedPeriod?props.initialTo!:today})
const view=ref<View|null>(null),busy=ref(false),error=ref(''),errorHelp=ref(''),notice=ref(''),progress=ref(''),history=ref<Batch[]>([])
watch(()=>view.value?.entries,entries=>{if(execution.value&&entries)execution.value=entries.find(e=>e.id===execution.value?.id)??entries.find(e=>e.factId===execution.value?.factId&&e.payeeId===execution.value?.payeeId)??entries.find(e=>e.factId===execution.value?.factId)??null})
const uploadWidget=ref<InstanceType<typeof StepUpload>>()
async function resumePreview(b:Batch){goStep('upload');await uploadWidget.value?.resume(b)}
const walletVersion=ref(0)
interface ConfirmProgress {jobId:string|null;status:'pending'|'done'|'failed';confirmed:number;waiting:number;remaining:number;skipped:number;total:number;error:string|null}
const confirmation=ref<ConfirmProgress|null>(null),confirmError=ref('')
let confirmTimer:ReturnType<typeof setTimeout>|undefined
const confirmStorage='zhihu.confirm.'+props.context.userId+'.'+props.context.scope.projectId+'.'+props.context.scope.accountId
let confirmRequest:{requestKey:string;reviewHash:string;from:string;to:string}|null=null
function saveConfirmation(){try{sessionStorage.setItem(confirmStorage,JSON.stringify({request:confirmRequest,job:confirmation.value?.jobId}))}catch{}}
async function pollConfirmation(){
 if(!confirmation.value?.jobId||disposed)return
 confirmError.value=''
 try{confirmation.value=await props.context.http.get<ConfirmProgress>('/workbench/confirm/'+confirmation.value.jobId,props.context.scope);saveConfirmation();if(confirmation.value.status==='pending')confirmTimer=setTimeout(()=>{void pollConfirmation()},2000);else{await refresh();walletVersion.value++;if(confirmation.value.status==='done'){confirmRequest=null;try{sessionStorage.removeItem(confirmStorage)}catch{}}}}
 catch(e){confirmError.value=errorText(e)}
}
async function retryConfirmation(){if(!confirmation.value?.jobId)return;await post('/workbench/confirm/'+confirmation.value.jobId+'/retry');await pollConfirmation()}
async function imported(r:{id:string;from:string;to:string;duplicate:boolean}){period.from=r.from;period.to=r.to;historyArchived.value=false;historyPage.value=1;goStep('todo');await run(async()=>{await inspectImport(r.id);await track(r.id)});if(props.flow)emit('period',{from:r.from,to:r.to})}

const risk=ref<RiskCase|null>(null)
const riskEntry=(e:Entry)=>{risk.value={factId:e.factId,revisionId:e.revisionId,keyword:e.keyword,riskAssessment:e.riskAssessment??""}}
const assignment=ref<Entry|null>(null),execution=ref<Entry|null>(null),agencyOpen=ref(false),updatedAt=ref('')
async function assigned(name:string){assignment.value=null;notice.value='已指定给 '+name+'，相关金额已重新计算。';await run(reloadResults)}
type ReportType='new_user'|'activation'
const typeFilter=ref<ReportType|''>('')
const ratesOpen=ref(false),ratesType=ref<ReportType>('new_user')
function openRates(type:ReportType){ratesType.value=type;ratesOpen.value=true}
async function ratesPublished(result:{effectiveFrom:string;recalculated:number}){notice.value='已发布单价，'+result.effectiveFrom+' 起生效。';await run(async()=>{await refresh();if(importId.value)await inspectImport(importId.value)})}
const types:ReportType[]=['new_user','activation']
const typeName=(type:ReportType)=>type==='activation'?'拉活':'拉新'
const typeKey=(type:ReportType)=>type==='new_user'?'newUser':'activation'
const unit=(type:ReportType)=>type==='activation'?'个':'单'
const importResult=ref<ImportDetail|null>(null),importId=ref(''),importPage=ref(1)
const historyArchived=ref(false),historyPage=ref(1),historyTotal=ref(0),historyOpen=ref(false),archiveTarget=ref<Batch|null>(null),archiveError=ref('')
interface ImportWithdrawal {period:{from:string;to:string}|null;id:string;fileName:string;reviewHash:string;rows:number;removed:number;restored:number;retained:number;corrections:number}
const withdrawalTarget=ref<ImportWithdrawal|null>(null),withdrawalError=ref('')
async function previewWithdrawal(b:Batch){withdrawalError.value='';withdrawalTarget.value=await props.context.http.get<ImportWithdrawal>('/imports/'+b.id+'/withdrawal',props.context.scope)}
async function withdrawCurrent(reupload=false){
 if(!withdrawalTarget.value)return
 const target=withdrawalTarget.value
 withdrawalError.value=''
 try{
  await post('/imports/'+target.id+'/withdrawal',{reviewHash:target.reviewHash})
  const old=history.value.find(b=>b.id===target.id)??importResult.value
  if(importId.value===target.id)closeAnalysis()
  withdrawalTarget.value=null
  notice.value='已撤销并移除上传记录，相关业绩、金额和待办已更新。'+(target.corrections?target.corrections+' 条已确认记录已生成待核对的更正金额，原账保留。':'可以重新上传正确的报表。')
  if(target.period)Object.assign(period,target.period)
  await reloadResults();walletVersion.value++;if(target.corrections)openDetails('')
  if(reupload)replaceFile(old??undefined)
 }catch(e){if(withdrawalTarget.value)withdrawalError.value=errorText(e);else showError(e)}
}
const analysisPanel=ref<HTMLElement|null>(null)
const batchStatus=(b:Batch)=>b.lastError?'处理曾中断':b.status==='processed'?'已读取，查看处理结果':b.status==='committed'?'分析中':b.status==='preview'?'待确认导入':'待处理'
const reportName=(b:Batch)=>b.reportKind==='activation'?'拉活':'拉新'
function closeAnalysis(){stopTracking();importId.value='';analysis.value=null;importResult.value=null}
async function openImport(id:string){stopTracking();await inspectImport(id);await nextTick();analysisPanel.value?.scrollIntoView({behavior:'smooth',block:'start'});if(analysis.value?.status==='running')await track(id)}
async function replaceFile(b?:Batch){
 goStep('upload');notice.value='请在上传与预览中选择修正后的报表。'
 await nextTick();uploadWidget.value?.chooseFile(b?.reportKind)
}
async function reanalyze(b:Batch){
 stopTracking();progress.value='正在重新分析 '+b.fileName+'…';notice.value='';
 try{const result=await post('/imports/'+b.id+'/reanalyze') as {reanalysis?:{refreshed:number;changed:number}};historyArchived.value=false;historyPage.value=1;await inspectImport(b.id);const stats=result.reanalysis;await track(b.id,++trackingVersion,'已重新检查原报表。'+(stats?`检查 ${stats.refreshed} 条未确认记录，${stats.changed} 条结果有变化。`:''));await nextTick();analysisPanel.value?.scrollIntoView({behavior:'smooth',block:'start'})}catch(e){progress.value='';throw e}
}
async function archiveCurrent(){
 if(!archiveTarget.value)return
 archiveError.value=''
 try{const target=archiveTarget.value;await post('/imports/'+target.id+'/archive',{archived:true});if(importId.value===target.id)closeAnalysis();archiveTarget.value=null;notice.value='已隐藏这条分析记录，业绩和账单保留。可在“已隐藏”中恢复。';await loadHistory()}catch(e){if(archiveTarget.value)archiveError.value=errorText(e);else showError(e)}
}
async function restore(b:Batch){await post('/imports/'+b.id+'/archive',{archived:false});if(importId.value===b.id)await inspectImport(b.id);notice.value='已恢复上传记录，可查看或重新分析。';await loadHistory()}
const analysis=ref<AnalysisRunModel|null>(null),busyAskId=ref(''),askErrors=reactive<Record<string,string>>({})
const importTotal=computed(()=>importResult.value?.counts.reduce((sum,c)=>sum+c.total,0)??0)
const rowStatus=(status:string)=>({invalid:'需要修正',skipped:'已跳过',pending:'正在处理',processed:'已读取',duplicate:'已读取，不重复计算',exception:'需要处理',legacy_settled:'早于本期计账日期，未计入本期'}[status]??'已读取')
async function inspectImport(id:string,page=1){
 importId.value=id;importPage.value=page
 const [detail,run]=await Promise.all([props.context.http.get<ImportDetail>('/imports/'+id,{...props.context.scope,page,pageSize:25}),props.context.http.get<AnalysisRunModel>('/imports/'+id+'/analysis',props.context.scope)])
 if(disposed||importId.value!==id||importPage.value!==page)return
 importResult.value=detail;analysis.value=run
}
async function answerAnalysis(answer:ReportAnswer){
 if(busy.value||busyAskId.value)return
 busy.value=true;busyAskId.value=answer.askId;askErrors[answer.askId]=''
 try{analysis.value=await post('/imports/'+importId.value+'/answers',answer) as AnalysisRunModel;await reloadResults();notice.value=answer.option==='skip'?'已暂时跳过，这项记录仍保留在待处理中。':'已保存选择，报表已更新。'+(analysis.value?.conclusion?.pendingText??'')}
 catch(error){askErrors[answer.askId]=errorText(error)}finally{busyAskId.value='';busy.value=false}
}
function analysisAction(action:string){
 if(action==='details')void run(async()=>{const selectedPeriod=(analysis.value as (AnalysisRunModel&{period?:{from:string;to:string}})|null)?.period;if(selectedPeriod)Object.assign(period,selectedPeriod);await refresh();openDetails('')})
 else if(action==='replace-file')replaceFile(importResult.value??undefined)
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
const unpricedCount=computed(()=>new Set(visible.value.filter(e=>e.amount===null).map(e=>e.factId||e.id)).size)
const attentionCount=computed(()=>new Set(visible.value.filter(e=>!!e.reasonCode).map(e=>e.factId||e.id)).size)
const performanceOnly=ref(false)
const details=computed(()=>visible.value.filter(e=>(!props.flow||step.value!=='todo'||!!e.reasonCode)&&(!performanceOnly.value||e.internal)&&(!typeFilter.value||e.metricType===typeFilter.value)&&(!selected.value||e.payeeId===selected.value||(props.context.role==='admin'&&e.parentId===selected.value))))
const issues=ref<InstanceType<typeof Issues>>(),issuePanel=ref<HTMLDetailsElement>()
async function inspectKeyword(entry:Entry){goStep('todo');await nextTick();if(issuePanel.value)issuePanel.value.open=true;await nextTick();await issues.value?.inspectKeyword(entry.keyword)}
async function inspectConflict(entry:Entry){goStep('todo');await nextTick();if(issuePanel.value)issuePanel.value.open=true;await nextTick();await issues.value?.inspectFact(entry.factId)}
const total=(field:keyof Pick<TypeSummary,'payable'|'confirmedPayable'|'pendingPayable'|'receivable'|'confirmedReceivable'|'pendingReceivable'>)=>{
 const value=types.reduce((sum,type)=>{const [whole='0',fraction='']=(view.value?.summary.byType[typeKey(type)][field]??'0').split('.');return sum+BigInt(whole.replace('-',''))*10000n*(whole.startsWith('-')?-1n:1n)+BigInt(fraction.padEnd(4,'0'))*(whole.startsWith('-')?-1n:1n)},0n)
 const magnitude=value<0n?-value:value
 return (value<0n?'-':'')+String(magnitude/10000n)+'.'+String(magnitude%10000n).padStart(4,'0')
}
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false,trackingVersion=0
function stopTracking(){trackingVersion++;if(timer)clearTimeout(timer);progress.value=''}
function post(path:string,data:object={}){return props.context.http.post(path,{...props.context.scope,...data,requestKey:requestKey()})}
async function refresh(){view.value=await props.context.http.get<View>('/workbench',{...props.context.scope,...period,viewVersion:'2'});updatedAt.value=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date());detailPage.value=1;if(view.value.entries.some(e=>!!e.reasonCode))detailsOpen.value=true}
async function loadHistory(){
 const result=await props.context.http.get<{list:Batch[];total:number}>('/imports',{...props.context.scope,page:historyPage.value,pageSize:10,archived:String(historyArchived.value)})
 history.value=result.list;historyTotal.value=result.total
 if(!result.list.length&&historyPage.value>1){historyPage.value--;await loadHistory()}
}
async function historyView(archived:boolean){historyArchived.value=archived;historyPage.value=1;await loadHistory()}
async function load(){await refresh();if(admin.value&&!props.wallet)await loadHistory()}
async function reloadResults(){await load();if(importId.value)await inspectImport(importId.value);await issues.value?.reload()}
function showError(e:unknown){
 const message=errorText(e);error.value=message;errorHelp.value='';
 if(message.includes('上传文件不符合')){error.value='报表文件暂时无法读取';errorHelp.value='请在 Excel 或 WPS 中另存为 .xlsx 或 CSV 后再上传。';}
 else if(message.includes('无法识别')){errorHelp.value='请按行号检查日期、渠道名称、关键词和订单量；空白行可以保留，修正后重新上传。';}
}
async function run(work:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';errorHelp.value='';try{await work()}catch(e){showError(e)}finally{busy.value=false}}
async function track(id:string,version=++trackingVersion,prefix=''){
 if(disposed||version!==trackingVersion)return
 if(timer)clearTimeout(timer)
 try{
  const result=await props.context.http.get<AnalysisRunModel>('/imports/'+id+'/analysis',props.context.scope)
  if(disposed||version!==trackingVersion)return
  importId.value=id;analysis.value=result
  if(result.status!=='running'){progress.value='';notice.value=prefix+(result.status==='failed'?'报表处理暂时中断，已完成的结果已保留。':result.status==='needs_input'?'报表已读取，仍有待处理记录。'+(result.conclusion?.pendingText??''):'报表已分析完成，金额与待办已更新。');await reloadResults()}
  else{progress.value='正在分析报表，剩余 '+((result.progress?.total??0)-(result.progress?.done??0))+' 条…';timer=setTimeout(()=>{void track(id,version,prefix)},1000)}
 }catch(e){if(version===trackingVersion){progress.value='';showError(new Error('分析进度暂时无法读取，请刷新查看：'+errorText(e)))}}
}
async function confirm(){
 if(!view.value||!checked.value)return
 confirmError.value=''
 confirmRequest??={requestKey:requestKey(),reviewHash:view.value.reviewHash,...period};saveConfirmation()
 try{
  const r=await props.context.http.post<ConfirmProgress>('/workbench/confirm',{...props.context.scope,...confirmRequest,viewVersion:'2',acknowledged:true})
  confirmation.value=r;saveConfirmation();confirming.value=false;checked.value=false
  notice.value=r.status==='pending'?'正在逐段确认，已完成的金额不会重复入账。':'已确认 '+r.confirmed+' 条，另有 '+r.waiting+' 条待处理。'
  if(r.status==='pending')await pollConfirmation();else{confirmRequest=null;try{sessionStorage.removeItem(confirmStorage)}catch{};await refresh();walletVersion.value++}
 }catch(e){if(typeof e==='object'&&e&&'status' in e&&e.status===409){confirmRequest=null;try{sessionStorage.removeItem(confirmStorage)}catch{};checked.value=false;confirming.value=false;await refresh();notice.value='数据已变化，请重新核对后再确认。'}throw e}
}

function openDetails(payeeId:string){
 goStep('review');performanceOnly.value=false;selected.value=payeeId
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
onMounted(()=>run(async()=>{await load();try{const saved=JSON.parse(sessionStorage.getItem(confirmStorage)||'null');if(saved?.request)confirmRequest=saved.request;if(saved?.job){confirmation.value={jobId:saved.job,status:'pending',confirmed:0,waiting:0,remaining:0,skipped:0,total:0,error:null};await pollConfirmation()}}catch{};const pending=history.value.find(b=>b.status==='committed');if(pending)await track(pending.id)}))
watch(()=>[props.initialFrom,props.initialTo],()=>{if(props.initialFrom&&props.initialTo){period.from=props.initialFrom;period.to=props.initialTo;void run(refresh)}})
onUnmounted(()=>{disposed=true;if(timer)clearTimeout(timer);if(confirmTimer)clearTimeout(confirmTimer)})
</script>
<template>
 <section class="work-section">
  <div class="engine-actions"><span v-if="updatedAt" role="status">结果更新于 {{updatedAt}}</span><button :disabled="busy" @click="run(async()=>{await reloadResults();notice='已刷新金额与待办，请查看最新处理结果。'})">{{busy?'正在更新…':'刷新结果'}}</button></div>
  <nav v-if="flow" class="finance-stepper" aria-label="财务处理步骤"><button v-for="(item,i) in steps" :key="item.id" :aria-current="step===item.id?'step':undefined" @click="goStep(item.id)"><span>{{i+1}}</span>{{item.label}}<small v-if="item.id==='todo'&&attentionCount">{{attentionCount}} 条待处理</small></button></nav>
  <StepUpload v-if="admin&&!wallet" v-show="show('upload')" ref="uploadWidget" :context="context" @committed="imported"/>
  <section v-if="flow&&step==='records'" class="work-card"><h2>本期记录与导出</h2><p>查看已处理的报表与当前金额。导出不会改变账单或发放状态。</p><button :disabled="busy||!view?.groups.length" @click="exportBill">导出对账单</button></section>
  <Objections v-if="admin&&!wallet&&show('todo','review')" :context="context" @changed="run(refresh)"/>
  <div v-if="error" role="alert" class="engine-error"><strong>{{error}}</strong><span v-if="errorHelp">{{errorHelp}}</span></div><p v-if="notice" role="status">{{notice}}</p><p v-if="progress" role="status">{{progress}}</p>
  <details v-if="admin&&!wallet&&show('upload','todo','records')" class="work-card import-history" :open="historyOpen" @toggle="historyOpen=($event.target as HTMLDetailsElement).open">
   <summary>上传记录 · 查看或撤销</summary>
   <div class="engine-actions history-views"><button :aria-pressed="!historyArchived" :disabled="busy" @click="run(()=>historyView(false))">上传记录</button><button :aria-pressed="historyArchived" :disabled="busy" @click="run(()=>historyView(true))">已隐藏</button><span>共 {{historyTotal}} 份</span></div>
   <p v-if="historyArchived">这里的记录可恢复；业绩、账单及原报表来源仍保留。</p>
   <ul class="import-history-list"><li v-for="b in history" :key="b.id">
    <div><strong>{{b.fileName}}</strong><span>{{reportName(b)}} · {{b.createdAt?.slice(0,10)}} · {{batchStatus(b)}}</span></div>
    <div class="engine-actions"><button v-if="b.status==='preview'" :disabled="busy" @click="resumePreview(b)">继续预览</button><button v-else :disabled="busy" @click="run(()=>openImport(b.id))">查看分析</button>
     <button :disabled="busy" @click="run(()=>previewWithdrawal(b))">撤销导入</button>
     <template v-if="!historyArchived"><button v-if="b.status!=='preview'" :disabled="busy||!!progress" @click="run(()=>reanalyze(b))">重新分析</button><button :disabled="busy||!!progress" @click="replaceFile(b)">重新上传</button><button :disabled="busy||!!progress" @click="archiveTarget=b;archiveError=''">隐藏记录</button></template>
     <button v-else :disabled="busy" @click="run(()=>restore(b))">恢复记录</button>
    </div>
   </li></ul>
   <p v-if="!history.length">{{historyArchived?'还没有隐藏过的记录。':'还没有上传记录，请在上方选择报表并上传。'}}</p>
   <div v-if="historyTotal>10" class="engine-actions"><button :disabled="busy||historyPage===1" @click="run(async()=>{historyPage--;await loadHistory()})">上一页记录</button><span>第 {{historyPage}} / {{Math.ceil(historyTotal/10)}} 页</span><button :disabled="busy||historyPage*10>=historyTotal" @click="run(async()=>{historyPage++;await loadHistory()})">下一页记录</button></div>
  </details>
  <section ref="analysisPanel" v-if="admin&&!wallet&&analysis&&show('todo','upload','records')" class="current-analysis" aria-label="当前报表分析">
   <div class="engine-actions"><strong>{{importResult?.fileName||'当前报表'}}{{importResult?.archivedAt?' · 已隐藏':''}}</strong>
    <button v-if="importResult" :disabled="busy" @click="run(()=>previewWithdrawal(importResult!))">撤销导入</button>
    <template v-if="importResult&&!importResult.archivedAt"><button :disabled="busy||!!progress" @click="run(()=>reanalyze(importResult!))">重新分析</button><button :disabled="busy||!!progress" @click="replaceFile(importResult!)">重新上传</button><button :disabled="busy||!!progress" @click="archiveTarget=importResult;archiveError=''">隐藏记录</button></template>
    <button v-if="importResult?.archivedAt" :disabled="busy" @click="run(()=>restore(importResult!))">恢复记录</button><button :disabled="busy" @click="closeAnalysis">收起分析</button>
   </div>
   <ReportAnalysis :context="context" :run="analysis" :busy-ask-id="busyAskId" :errors="askErrors" :busy-action="busy?'working':''" @answer="answerAnalysis" @action="analysisAction" @refresh="run(reloadResults)" />
  </section>
  <ActionDialog :open="!!withdrawalTarget" title="撤销这份报表" :busy="busy" @close="withdrawalTarget=null">
   <p class="archive-file">{{withdrawalTarget?.fileName}}</p>
   <p>移除这次上传的 {{withdrawalTarget?.rows}} 行记录，并撤回它对业绩和金额的影响。之后可以重新上传。</p>
   <ul v-if="withdrawalTarget">
    <li v-if="withdrawalTarget.removed">移除 {{withdrawalTarget.removed}} 条未确认的计账数据。</li>
    <li v-if="withdrawalTarget.restored">{{withdrawalTarget.restored}} 条数据恢复采用其他有效报表。</li>
    <li v-if="withdrawalTarget.retained">{{withdrawalTarget.retained}} 条还有其他有效来源，保持不变。</li>
    <li v-if="withdrawalTarget.corrections">{{withdrawalTarget.corrections}} 条已确认过金额，生成更正后由财务核对；原账和付款记录保留。</li>
   </ul>
   <p v-if="withdrawalError" role="alert" class="engine-error">{{withdrawalError}}</p>
   <div class="engine-actions"><button :disabled="busy" @click="withdrawalTarget=null">取消</button><button :disabled="busy" @click="run(()=>withdrawCurrent(true))">撤销后重传</button><button class="primary" :disabled="busy" @click="run(()=>withdrawCurrent())">确认撤销</button></div>
  </ActionDialog>
  <ActionDialog :open="!!archiveTarget" title="隐藏这条分析记录" :busy="busy" @close="archiveTarget=null">
   <p class="archive-file">{{archiveTarget?.fileName}}</p><p>仅从上传记录列表移除，业绩、待处理问题和已确认账单都会保留。需要时可在“已隐藏”中恢复。</p>
   <p v-if="archiveError" role="alert">{{archiveError}}</p><div class="engine-actions"><button :disabled="busy" @click="archiveTarget=null">取消</button><button class="primary" :disabled="busy" @click="run(archiveCurrent)">{{busy?'正在清理…':'隐藏记录并保留账单'}}</button></div>
  </ActionDialog>
  <details v-if="admin&&!wallet&&importResult" class="work-card" aria-label="报表读取结果" :open="importResult.counts.some(c=>c.processingStatus==='invalid')">
   <summary>查看 {{importResult.fileName}} 的原表行与读取结果</summary>
   <p>共读取 {{importTotal}} 行，每行的处理结果都已保留。</p>
   <ul class="report-rows"><li v-for="row in importResult.rows" :key="row.id"><strong>第 {{row.lineNumber}} 行 · {{rowStatus(row.processingStatus)}}</strong><span>{{row.errorText||'这行已读取，金额和待处理事项见下方账单。'}}</span><span v-if="row.next">下一步：{{row.next}}</span><span v-if="row.processingStatus==='invalid'">下一步：财务：修正这行后补传报表 <button :disabled="busy||!!progress" @click="replaceFile(importResult!)">选择修正后的报表</button></span></li></ul>
   <div v-if="importTotal>25" class="engine-actions"><button :disabled="busy||importPage===1" @click="run(()=>inspectImport(importId,importPage-1))">上一页</button><span>第 {{importPage}} 页</span><button :disabled="busy||importPage*25>=importTotal" @click="run(()=>inspectImport(importId,importPage+1))">下一页</button></div>
  </details>
  <form v-if="show('review','todo','records')" class="period-filter" @submit.prevent="run(refresh)"><label>开始日期<input type="date" v-model="period.from" required /></label><label>结束日期<input type="date" v-model="period.to" required /></label><button :disabled="busy">查看账单</button><button v-if="admin&&!wallet" type="button" :disabled="busy" @click="openRates(typeFilter||'new_user')">查看与设置单价</button></form>
  <div v-if="view&&show('review','records')" class="metric-grid">
   <article><span>{{wallet?'已确认收入':unpricedCount?'已算出成员应付':'成员应付合计'}}</span><strong>{{!wallet&&unpricedCount&&!view?.groups.length?'待计算':'¥'+money(total(wallet?'confirmedReceivable':'payable'))}}</strong><span v-if="!wallet&&unpricedCount">另有 {{unpricedCount}} 条待计算，业绩已保留</span></article>
   <article><span>{{wallet?'待确认收入':'已确认应付'}}</span><strong>¥{{money(total(wallet?'pendingReceivable':'confirmedPayable'))}}</strong></article>
   <article><span>{{wallet&&!creator?'本人应得收入':'拉新订单'}}</span><strong>{{wallet&&!creator?'¥'+money(total('receivable')):view.summary.totalOrders+' 单'}}</strong><span v-if="!wallet||creator">拉活 {{view.summary.byType.activation.quantity}} 个</span></article>
  </div>
   <div v-if="view&&show('review','records')" class="analysis-result type-totals">
    <div v-for="type in types" :key="type">
     <strong>{{typeName(type)}} · {{view.summary.byType[typeKey(type)].quantity}} {{unit(type)}}</strong>
     <template v-if="!wallet">
      <span v-if="admin">报表结算：{{view.summary.byType[typeKey(type)].reportedSettlement==null?'原表未提供':'¥'+money(view.summary.byType[typeKey(type)].reportedSettlement)}}<template v-if="view.summary.byType[typeKey(type)].reportedSettlement!=null&&view.summary.byType[typeKey(type)].reportedSettlementMissing"> · {{view.summary.byType[typeKey(type)].reportedSettlementMissing}} 条未提供金额</template></span>
      <span>成员应付{{view.summary.byType[typeKey(type)].unpricedRecords?'已算出':''}} ¥{{money(view.summary.byType[typeKey(type)].payable)}}<template v-if="view.summary.byType[typeKey(type)].unpricedRecords"> · 另有 {{view.summary.byType[typeKey(type)].unpricedRecords}} 条待计算</template></span>
      <span>已确认 ¥{{money(view.summary.byType[typeKey(type)].confirmedPayable)}} · 尚未确认 ¥{{money(view.summary.byType[typeKey(type)].pendingPayable)}}</span>
     </template>
     <span v-else>本人收益 ¥{{money(view.summary.byType[typeKey(type)].receivable)}} · 已确认 ¥{{money(view.summary.byType[typeKey(type)].confirmedReceivable)}}</span>
     <span v-if="view.summary.byType[typeKey(type)].excludedQuantity!=='0'">{{view.summary.byType[typeKey(type)].excludedQuantity}} {{unit(type)}}已核实不计费</span>
    </div>
    <div v-if="admin&&!wallet"><button type="button" class="staff-total" @click="openDetails('');performanceOnly=true">内部业绩 ¥{{money(view.summary.staffAmount)}}（不计入成员应付）</button><span>拉新 ¥{{money(view.summary.byType.newUser.staffAmount)}} · 拉活 ¥{{money(view.summary.byType.activation.staffAmount)}}</span></div>
   </div>

   <div v-if="attentionCount && admin&&show('review','todo')" class="attention"><strong>{{attentionCount}} 条记录需要处理</strong><span>业绩已保留。处理后金额和待办自动更新。</span><button @click="flow?goStep('todo'):openDetails('')">处理这些记录</button></div>
  <div v-if="view && !wallet&&show('review','records')" class="work-card bill-groups">
   <div class="section-heading"><div><h2>{{admin?'本期财务账单':'团队应付账单'}}</h2><p>{{admin?'按团长（含团队达人）和独立达人汇总，便于核对和做账。':'只需核对你应付给团队达人的金额。'}}</p></div>
    <div class="engine-actions"><button :disabled="!view.groups.length||busy" @click="exportBill">导出对账单</button><button v-if="admin" class="primary" :disabled="busy||confirmation?.status==='pending'||!view.entries.some(e=>e.ready)" @click="confirming=true;checked=false">核对并确认账单</button></div>
   </div>
   <div class="engine-table"><table><thead><tr><th>收款人</th><th>合计（元）</th><th>已确认</th><th>待确认</th><th>下一步</th><th></th></tr></thead><tbody><tr v-for="g in view.groups" :key="g.payeeId"><td>{{g.name}}</td><td>{{money(g.total)}}</td><td>{{money(g.confirmed)}}</td><td>{{money(g.pending)}}</td><td>{{g.blockers.join('；')||(g.ready?'可以确认':'已核对完成')}}</td><td><button @click="openDetails(g.payeeId)">看明细</button></td></tr></tbody></table></div>
   <ul class="bill-cards"><li v-for="g in view.groups" :key="g.payeeId"><strong>{{g.name}} · ¥{{money(g.total)}}</strong><span>已确认 ¥{{money(g.confirmed)}} · 待确认 ¥{{money(g.pending)}}</span><span>{{g.blockers.join('；')||(g.ready?'可以确认':'已核对完成')}}</span><button @click="openDetails(g.payeeId)">看明细</button></li></ul>
   <p class="empty-state" v-if="!view.groups.length">{{view.entries.length?(view.entries.some(e=>e.reasonCode)?'报表已读取，当前记录还在等待处理，暂未生成应付账单。':'本期为管理员本人执行业绩，没有成员应付账单。'):admin?'当前日期范围没有账单，请上传报表或调整日期。':'财务上传报表后，这里会自动显示团队账单。'}}<button v-if="view.entries.length" @click="openDetails('')">查看关键词明细</button></p>
  </div>
  <section v-if="confirmation" class="work-card" aria-label="确认进度"><h3>账单确认进度</h3><p role="status">已确认 {{confirmation.confirmed}} 条 · 剩余 {{confirmation.remaining}} 条 · 数据变化跳过 {{confirmation.skipped}} 条</p><progress v-if="confirmation.total" :value="confirmation.confirmed+confirmation.skipped" :max="confirmation.total"/><p v-if="confirmation.error" role="alert">{{confirmation.error}}</p><p v-if="confirmError" role="alert">{{confirmError}}</p><button v-if="confirmError" :disabled="busy" @click="pollConfirmation">重新读取进度</button><button v-if="confirmation.status==='failed'" :disabled="busy" @click="run(retryConfirmation)">继续处理剩余账单</button></section>
  <div v-if="admin && confirming && view" class="confirm-box" role="region" aria-label="核对账单"><h2>确认本期账单</h2><p>{{period.from}} 至 {{period.to}}，本期应付合计 <strong>¥{{money(total('payable'))}}</strong>。</p><p>审核完成的账单会被确认；有待办的账单继续等待处理。此操作不会发起银行转账。</p><label class="check-label"><input type="checkbox" v-model="checked" />我已核对报表、人员和计算金额</label><div class="engine-actions"><button class="primary" :disabled="!checked||busy" @click="run(confirm)">确认核对结果</button><button :disabled="busy" @click="confirming=false">返回检查</button></div></div>
  <details v-if="show('todo','review','records')" ref="detailPanel" class="work-card bill-details" :open="wallet||detailsOpen||flow" @toggle="detailsOpen=($event.currentTarget as HTMLDetailsElement).open"><summary>{{wallet?'我的收入明细':'查看关键词与金额明细'}}</summary><div class="engine-actions"><button v-if="selected||performanceOnly" @click="selected='';performanceOnly=false;detailPage=1">查看全部人员</button><button v-if="wallet" :disabled="!visible.length" @click="exportBill">导出收入明细</button></div>
   <label class="type-filter">业绩类型<select v-model="typeFilter" @change="detailPage=1"><option value="">全部</option><option value="new_user">拉新</option><option value="activation">拉活</option></select></label>
   <BillDetails :context="context" :entries="details" :wallet="wallet" :admin-duty="context.adminDuty" :can-set-rates="admin&&!wallet" :busy="busy" @assign="assignment=$event" @risk="riskEntry" @changes="inspectConflict" @rates="openRates($event.metricType)" @agency="agencyOpen=true" @followup="execution=$event" @match="inspectKeyword" />
  </details>
  <div v-if="wallet&&context.role==='leader'&&view" class="work-card team-performance"><h2>团队业绩与分成</h2><div class="engine-table"><table><thead><tr><th>达人</th><th>订单量</th><th>拉新分成（元）</th><th>拉活量</th><th>拉活分成（元）</th></tr></thead><tbody><tr v-for="g in view.teamPerformance" :key="g.executorId"><td>{{g.name}}</td><td>{{g.orders}}单</td><td>{{money(g.commission)}}</td><td>{{g.activations}}个</td><td>{{money(g.activationCommission)}}</td></tr></tbody></table></div><ul class="team-cards"><li v-for="g in view.teamPerformance" :key="g.executorId"><strong>{{g.name}}</strong><span>拉新 {{g.orders}}单 · 给我的分成 ¥{{money(g.commission)}}</span><span>拉活 {{g.activations}}个 · 给我的分成 ¥{{money(g.activationCommission)}}</span></li></ul></div>
  <details ref="issuePanel" v-if="admin&&!wallet&&show('todo')" :open="flow" class="work-card"><summary>报表问题与更正</summary><Issues ref="issues" :context="context" @navigate="emit('navigate',$event)" @changed="run(async()=>{await refresh();if(importId)await inspectImport(importId)})" /></details>
  <RiskReview :context="context" :item="risk" @close="risk=null" @saved="risk=null;run(async()=>{await refresh();if(importId)await inspectImport(importId)})" />
  <RateSettings v-if="admin&&!wallet" :open="ratesOpen" :project-id="context.scope.projectId" module-id="zhihu" :http="context.coreHttp" :initial-metric-type="ratesType" @close="ratesOpen=false" @published="ratesPublished" />
  <AssignExecutor v-if="assignment" :context="context" :keyword-id="assignment.keywordId" :keyword="assignment.keyword" :from-date="assignment.retroFromDate" @close="assignment=null" @saved="assigned" />
  <AgencySettings :http="context.http" :scope="context.scope" :open="agencyOpen" @close="agencyOpen=false" @saved="agencyOpen=false;notice='代理名称已保存，相关报表已自动更新。';run(reloadResults)" />
  <ExecutionFollowUp v-if="execution" :key="execution.keywordId" :context="context" :item="execution" @close="execution=null" @changed="run(reloadResults)" @navigate="emit('navigate',$event)" />
  <CashWallet :key="walletVersion" v-if="(wallet||admin)&&show('payout')" :http="context.coreHttp" :scope="{...context.scope,moduleId:'zhihu'}" />
  <FinanceHistoryLinks v-if="show('records')" />
 </section>
</template>



<style scoped>
.work-section{min-width:0;color:var(--ink,#1b3035)}.work-section button{font:inherit;padding:10px 15px;border:1px solid var(--line,#dce3e5);border-radius:8px;background:var(--paper,#fff);color:inherit;min-height:44px;cursor:pointer}.work-section button.primary{background:var(--primary,#195e62);color:#fff}.work-section button:disabled{opacity:.45;cursor:not-allowed}.engine-actions,.section-heading{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.work-card{padding:22px;border:1px solid var(--line,#dce3e5);border-radius:12px;background:var(--paper,#fff);margin-top:18px;min-width:0}.work-card summary{cursor:pointer;font-weight:600;padding-bottom:12px}.period-filter{display:flex;gap:14px;flex-wrap:wrap;align-items:end;margin:20px 0}.period-filter label{display:grid;gap:7px;min-width:0}.period-filter input,.type-filter select{font:inherit;min-height:40px;padding:8px;max-width:100%;box-sizing:border-box;border:1px solid var(--line,#ddd);background:var(--paper,#fff);color:inherit;border-radius:7px}.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:20px}.metric-grid article{padding:18px;border:1px solid var(--line,#ddd);border-radius:12px;background:var(--paper,#fff);overflow-wrap:anywhere}.metric-grid span,.metric-grid strong{display:block}.metric-grid strong{font-size:26px;font-variant-numeric:tabular-nums;margin:8px 0}.engine-table{overflow:auto;margin-top:18px}.engine-table table{width:100%;border-collapse:collapse;text-align:left}.engine-table th,.engine-table td{padding:12px;border-bottom:1px solid var(--line,#ddd)}.confirm-box{padding:22px;border:2px solid #8eb8b9;border-radius:12px;margin:18px 0}.check-label{display:flex;gap:10px;align-items:center;margin:18px 0}.attention{display:flex;gap:12px;flex-wrap:wrap;padding:16px;margin-top:18px;background:#fff8e8;border-radius:10px}.engine-error{padding:12px;background:#fff1f1;color:#a02f39}.work-section h2{font-size:20px}.work-section button:focus-visible{outline:2px solid var(--primary,#195e62);outline-offset:3px}@media(max-width:600px){.metric-grid{grid-template-columns:1fr}.work-card,.confirm-box{padding:16px}.period-filter label{flex:1 1 130px}.period-filter input{width:100%}}
.finance-stepper{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:16px 0 24px}.finance-stepper button{display:grid;gap:6px;border:1px solid var(--line,#dce3e5);background:var(--paper,#fff);border-radius:10px;min-height:76px;padding:12px;color:inherit;font:inherit;cursor:pointer}.finance-stepper button[aria-current]{border-color:var(--primary,#195e62);background:#eef6f5}.finance-stepper small{font-size:12px;color:#8a560b}@media(max-width:600px){.finance-stepper{grid-template-columns:repeat(2,minmax(0,1fr))}}

.import-history-list{list-style:none;padding:0;display:grid;gap:12px}.import-history-list li{display:grid;gap:12px;padding:16px 0;border-bottom:1px solid var(--line,#ddd)}.import-history-list li>div:first-child{display:grid;gap:6px;overflow-wrap:anywhere}.import-history-list span{font-size:13px}.history-views{margin-top:18px}.history-views button[aria-pressed=true]{background:#e6f3f1;color:#194f54;border-color:#25656a}.current-analysis{min-width:0}.current-analysis>.engine-actions{margin-bottom:12px}.current-analysis strong,.archive-file{overflow-wrap:anywhere;min-width:0}
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
