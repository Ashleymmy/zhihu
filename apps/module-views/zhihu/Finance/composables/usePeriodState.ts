import {computed,onScopeDispose,ref,reactive} from 'vue'
import {errorText,requestKey,type EngineContext} from '../../context'
import {useFinanceApi,moneyValue,type WorkbenchView,type ExceptionItem,type ObjectionItem,type RevisionItem,type WithdrawalRow,type ConfirmProgress} from './useFinanceApi'
export type PeriodStep=1|2|3|4|5
export const STEPS=[{n:1 as PeriodStep,name:'上传与识别',sub:'预览后导入'},{n:2 as PeriodStep,name:'待处理',sub:'补齐本期资料'},{n:3 as PeriodStep,name:'核对与确认',sub:'核对后计入收入'},{n:4 as PeriodStep,name:'线下发放',sub:'实际转账后登记'},{n:5 as PeriodStep,name:'记录与导出',sub:'账单与发放留痕'}]
export function periodRange(id:string){const [y,m]=id.split('-').map(Number),mm=String(m).padStart(2,'0');return {from:`${y}-${mm}-01`,to:`${y}-${mm}-${new Date(y!,m!,0).getDate()}`}}
export function periodTitle(id:string){const[y,m]=id.split('-');return `${y} 年 ${Number(m)} 月`}
export function currentPeriodId(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7)}
// Internal performance has no member payable, but still requires valid works and attribution.
export function pendingEntries(wb:WorkbenchView|null){return (wb?.entries??[]).filter(e=>e.ownPayable&&!['confirmed','excluded'].includes(e.status)&&!e.ready&&!!e.reasonCode)}
export function usePeriodState(context:EngineContext){
 const api=useFinanceApi(context),storage='zhihu.flow.'+context.userId+'.'+context.scope.projectId+'.'+context.scope.accountId
 const view=ref<'periods'|'period'>('periods'),periodId=ref(currentPeriodId()),step=ref<PeriodStep>(1),loading=ref(false),error=ref('')
 const workbench=ref<WorkbenchView|null>(null),exceptions=ref<ExceptionItem[]>([]),revisions=ref<RevisionItem[]>([]),objections=ref<ObjectionItem[]>([]),withdrawals=ref<WithdrawalRow[]>([])
 const funding=reactive({amount:'0',hash:'',funded:false,reference:''}),timeline=ref<{t:string;actor:string;text:string}[]>([])
 const confirmation=ref<ConfirmProgress|null>(null),confirmError=ref(''),confirmBusy=ref(false),importing=ref(false)
 const activeImport=ref<{id:string;from:string;to:string}|null>(null)
 const processingImports=computed(()=>workbench.value?.processingImports??[])
 let generation=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined,importTimer:ReturnType<typeof setTimeout>|undefined
 let attempt:{from:string;to:string;reviewHash:string;key:string}|null=null
 function log(actor:string,text:string){timeline.value.unshift({t:new Date().toLocaleString('zh-CN'),actor,text})}
 const blockedEntries=computed(()=>pendingEntries(workbench.value))
 const internalOnly=computed(()=>!!workbench.value?.entries.length&&workbench.value.entries.every(e=>e.internal))
 const todoCount=computed(()=>{const keys=new Set(blockedEntries.value.map(e=>e.factId?'fact:'+e.factId:'keyword:'+e.keyword+':'+e.date));for(const e of exceptions.value)keys.add(e.factId?'fact:'+e.factId:'keyword:'+(e.keyword||e.normalizedJson?.keyword)+':'+e.normalizedJson?.date);for(const o of objections.value)keys.add('fact:'+o.factId);return keys.size})
 const totalRecords=computed(()=>workbench.value?.summary.totalRecords??0)
 const written=computed(()=>totalRecords.value>0||!!workbench.value?.entries.length||exceptions.value.length>0)
 const totalPayable=computed(()=>{const s=workbench.value?.summary;const n=s?moneyValue(s.byType.newUser.payable)+moneyValue(s.byType.activation.payable):0n,a=n<0n?-n:n;return(n<0n?'-':'')+a/10000n+'.'+String(a%10000n).padStart(4,'0')})
 const hasReady=computed(()=>workbench.value?.entries.some(e=>e.ready)??false)
 const hasConfirmed=computed(()=>workbench.value?.entries.some(e=>e.status==='confirmed')??false)
 const statusKey=computed(()=>processingImports.value.some(r=>r.status==='failed')?'failed':importing.value||processingImports.value.length?'processing':!written.value||!workbench.value?.entries.length&&!exceptions.value.length?'upload':todoCount.value?'todo':hasReady.value||confirmation.value?.status==='pending'?'review':moneyValue(funding.amount)>0n||withdrawals.value.some(w=>w.status==='pending'||w.status==='approved')?'payout':'closed')
 const stepOfStatus=computed<PeriodStep>(()=>({upload:1,processing:1,failed:1,todo:2,review:3,payout:4,closed:5})[statusKey.value] as PeriodStep)
 const skippedSteps=computed<PeriodStep[]>(()=>!internalOnly.value||stepOfStatus.value<=2?[]:[3,...(stepOfStatus.value>4?[4 as PeriodStep]:[])])
 const statusLabel=computed(()=>({upload:'待上传',processing:'报表处理中',failed:'报表处理待恢复',todo:'待处理',review:'待核对确认',payout:'待线下发放',closed:'本轮已处理'})[statusKey.value])
 const statusBadgeClass=computed(()=>({upload:'badge warn',processing:'badge info',failed:'badge danger',todo:'badge danger',review:'badge info',payout:'badge info',closed:'badge ok'})[statusKey.value])
 const closed=computed(()=>statusKey.value==='closed')
 async function allPages<T>(get:(page:number)=>Promise<{list:T[];total:number}>){const list:T[]=[];for(let page=1;;page++){const r=await get(page);list.push(...r.list);if(list.length>=r.total||!r.list.length)return list}}
 async function loadPeriod(id?:string){
  if(importTimer)clearTimeout(importTimer)
  const current=++generation;const changed=!!id&&id!==periodId.value;if(id)periodId.value=id
  if(changed){if(timer)clearTimeout(timer);attempt=null;confirmation.value=null;confirmError.value='';importing.value=false;timeline.value=[];workbench.value=null;exceptions.value=[];objections.value=[];withdrawals.value=[]}
  const {from,to}=periodRange(periodId.value);loading.value=true;error.value=''
  try{
   const [wb,ex,obj,fin]=await Promise.all([api.getWorkbench(from,to),allPages(p=>api.getExceptions(p,100)),allPages(p=>api.listObjections({status:'open',page:p,pageSize:100})),api.getCoreFinance()])
   const ws=[...fin.withdrawals];for(let p=2;ws.length<fin.total;p++){const r=await api.getCoreFinance(p);if(!r.withdrawals.length)break;ws.push(...r.withdrawals)}
   if(current!==generation||disposed)return
   const factIds=new Set(wb.entries.map(e=>e.factId));workbench.value=wb
   exceptions.value=ex.filter(e=>{const d=e.normalizedJson?.date;return e.status==='open'&&(factIds.has(e.factId)||(!!d&&d>=from&&d<=to))})
   objections.value=obj.filter(o=>o.businessDate>=from&&o.businessDate<=to)
   withdrawals.value=ws;funding.amount=fin.funding.amount;funding.hash=fin.funding.hash;funding.funded=moneyValue(fin.funding.amount)===0n
   try{sessionStorage.setItem(storage+'.period',periodId.value)}catch{}
   if(step.value>stepOfStatus.value)step.value=stepOfStatus.value
  }catch(e){if(current===generation)error.value=errorText(e)}finally{if(current===generation){loading.value=false;if(!disposed&&view.value==='period'&&processingImports.value.length)importTimer=setTimeout(()=>void loadPeriod(),3000)}}
 }
 async function openPeriod(id:string){view.value='period';step.value=1;await loadPeriod(id);if(!error.value)step.value=stepOfStatus.value;await resumeConfirmation()}
 function backToPeriods(){view.value='periods';generation++;if(importTimer)clearTimeout(importTimer)}
 function gotoStep(n:PeriodStep){if(error.value||loading.value||confirmBusy.value||n>stepOfStatus.value)return false;step.value=n;return true}
 function save(){try{sessionStorage.setItem(storage+'.confirm',JSON.stringify({attempt,progress:confirmation.value}))}catch{}}
 async function pollConfirmation(){
  const job=confirmation.value?.jobId,expectedPeriod=periodId.value;if(!job||disposed)return;confirmError.value=''
  try{const result=await api.getConfirmStatus(job);if(disposed||periodId.value!==expectedPeriod)return;confirmation.value=result;save();if(confirmation.value.status==='pending')timer=setTimeout(()=>void pollConfirmation(),2000);else{await loadPeriod();if(confirmation.value.status==='done'){log('财务','确认账单完成：'+confirmation.value.confirmed+' 条');attempt=null;save();if(!error.value)step.value=stepOfStatus.value}}}catch(e){confirmError.value=errorText(e)}
 }
 async function confirm(){
  if(confirmBusy.value||error.value||!workbench.value)return;confirmBusy.value=true;confirmError.value=''
  attempt??={...periodRange(periodId.value),reviewHash:workbench.value.reviewHash,key:requestKey()};save()
  try{confirmation.value=await api.confirmBills(attempt.from,attempt.to,attempt.reviewHash,attempt.key);save();if(confirmation.value.status==='pending')await pollConfirmation();else if(confirmation.value.status==='done'){log('财务','确认账单完成：'+confirmation.value.confirmed+' 条');attempt=null;save();await loadPeriod();if(!error.value)step.value=stepOfStatus.value}}
  catch(e){if(typeof e==='object'&&e&&'status'in e&&e.status===409){attempt=null;save();await loadPeriod();confirmError.value='数据已变化，请重新核对后确认。'}else confirmError.value=errorText(e);throw e}finally{confirmBusy.value=false}
 }
 async function retryConfirmation(){if(!confirmation.value?.jobId)return;confirmation.value=await api.retryConfirm(confirmation.value.jobId);save();await pollConfirmation()}
 async function resumeConfirmation(){try{const saved=JSON.parse(sessionStorage.getItem(storage+'.confirm')||'null');if(saved?.attempt?.from!==periodRange(periodId.value).from)return;attempt=saved.attempt;confirmation.value=saved.progress;if(confirmation.value?.status==='pending'||confirmation.value?.status==='failed')await pollConfirmation()}catch(e){confirmError.value=errorText(e)}}
 onScopeDispose(()=>{disposed=true;generation++;if(timer)clearTimeout(timer);if(importTimer)clearTimeout(importTimer)})
 return {api,context,storage,view,periodId,step,loading,error,workbench,exceptions,revisions,objections,withdrawals,funding,timeline,closed,todoCount,totalRecords,totalPayable,written,statusKey,statusLabel,statusBadgeClass,stepOfStatus,blockedEntries,internalOnly,skippedSteps,hasReady,importing,activeImport,processingImports,confirmation,confirmError,confirmBusy,log,loadPeriod,openPeriod,backToPeriods,gotoStep,confirm,pollConfirmation,retryConfirmation}
}
export type PeriodState=ReturnType<typeof usePeriodState>
