import { isStaffRole } from '../../../auth/roles';
import type {PoolConnection} from 'mysql2/promise';
import {gate} from './routing';
import type {AuthUser} from '../../../types';
import {withTransaction} from '../../../db';
import {authorize,select,json,audit} from './store';
import {businessDay,day,digest,fail,money,moneyText,type Scope} from './domain';
import {assertDuty,dutyAllows} from '../../../core/duties';
import {ownershipHistorySql,unconfirmedFactSql} from './keyword-usability';
import {lockFinance,syncIncome} from '../../../core/finance';
import {parseReport,assertReportWriteEnabled,type MetricType,type ReportKind,type SourceRow} from './report';
import {reasonText} from './reasons';
import type {AllianceUploadFile} from '../zhihu/allianceXlsx';
import type {AttributionSnapshot} from './facts';
import * as facts from './facts';
import * as statements from './statements';
import * as cutover from './cutover';
export interface Period{from:string;to:string;metricType?:MetricType}
function valid(p:Period){day(p.from);day(p.to);if(p.from>p.to)fail('开始日期不能晚于结束日期')}
export function allocations(snapshot:AttributionSnapshot){
 const values=new Map<string,bigint>();let total=0n,staffAmount=0n;
 for(const o of snapshot.obligations){
  const amount=money(o.amount);
  if(o.relation==='activation:staff_self'){staffAmount+=amount;continue;}
  if(o.relation==='agency_leader'||o.relation==='agency_creator'||o.relation.startsWith('activation:')){values.set(o.payeeId,(values.get(o.payeeId)??0n)+amount);total+=amount;}
  else if(o.relation==='leader_creator'){values.set(o.payeeId,(values.get(o.payeeId)??0n)+amount);values.set(o.payerId,(values.get(o.payerId)??0n)-amount);}
 }
 if([...values.values()].some(v=>v<0n))fail('团队分配超过平台应付，请核对定价规则',409);
 return{total:moneyText(total),staffAmount:moneyText(staffAmount),list:[...values].map(([userId,amount])=>({userId,amount:moneyText(amount)}))};
}
export async function uploadReport(user:AuthUser,scope:Scope,file:AllianceUploadFile,reportType:MetricType='new_user'){
 assertDuty(user,'finance');await authorize(user,scope);
 scope={projectId:scope.projectId,accountId:scope.accountId};
 let kind:ReportKind=reportType==='activation'?'activation':'combined',parsed;
 try{parsed=await parseReport(file,kind)}catch(e){
  if(!(e instanceof Error)||e.message!=='报告类型与指标列不一致')throw e;
  try{kind='order';parsed=await parseReport(file,kind)}catch(e2){
   if(!(e2 instanceof Error)||e2.message!=='报告类型与指标列不一致')throw e2;
   kind='search';parsed=await parseReport(file,kind);
  }
 }
 assertReportWriteEnabled(kind);
 const dates=parsed.filter(r=>!r.error&&!r.skipped).map(r=>r.value.date).sort();
 if(dates.length)await withTransaction(c=>cutover.extendRouteIfClean(c,scope,dates[0],user));
 const b=await facts.previewImport(user,scope,file,kind),detail=await facts.importDetail(user,scope,b.id,1,1);
 await facts.commitImport(user,scope,b.id,'workbench-import-'+b.id,detail.preview_hash);
 await facts.processBatch(user,scope,b.id);
 return {...b,from:dates[0]??businessDay(),to:dates[dates.length-1]??businessDay()};
}
export async function overview(user:AuthUser,scope:Scope,period:Period,connection?:PoolConnection){
 if(isStaffRole(user.role))assertDuty(user,'finance');
 scope={projectId:scope.projectId,accountId:scope.accountId};period={from:period.from,to:period.to,...(period.metricType?{metricType:period.metricType}:{})};
 valid(period);if(!connection)await authorize(user,scope);
 const read=async(c:PoolConnection)=>{
  const rows=await select(c,`SELECT CAST(f.id AS CHAR) id,CAST(f.current_result_id AS CHAR) result_id,CAST(f.current_revision_id AS CHAR) revision_id,
    CAST(f.keyword_id AS CHAR) keyword_id,f.metric_type,r.snapshot_json,r.reason_code,b.verification_status,b.leader_id,b.executor_id,b.id binding_id,
    executor.display_name executor_name,executor.role executor_role,leader.display_name leader_name,
    ${ownershipHistorySql()} ownership_history,k.lifecycle_status,b.stop_new_use_at,b.release_status,
    (SELECT DATE_FORMAT(MIN(uf.business_date),'%Y-%m-%d') FROM zh_metric_facts uf WHERE uf.keyword_id=k.id AND ${unconfirmedFactSql('uf')}) retro_from_date,
    (EXISTS(SELECT 1 FROM zh_evidence ev WHERE ev.binding_id=b.id) OR EXISTS(SELECT 1 FROM compositions co WHERE co.plan_id=k.plan_id AND co.owner_id=b.executor_id)) evidence_count,
    src.id source_id,src.source_version,src.blocked_reason,
    EXISTS(SELECT 1 FROM zh_metric_revisions v WHERE v.fact_id=f.id AND v.status='pending') pending_revision
    FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id
    LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id LEFT JOIN zh_attribution_results r ON r.id=f.current_result_id
    LEFT JOIN users executor ON executor.id=b.executor_id LEFT JOIN users leader ON leader.id=b.leader_id
    LEFT JOIN opc_income_sources src ON src.module_id='zhihu' AND src.account_id=f.account_id AND src.source_key=CONCAT('fact:',f.id)
    WHERE f.account_id=? AND f.project_id=? AND f.business_date BETWEEN ? AND ? AND (? IS NULL OR f.metric_type=?) AND (? IN ('developer','admin','operator') OR b.leader_id=? OR b.executor_id=?) ORDER BY f.id`,
    [scope.accountId,scope.projectId,period.from,period.to,period.metricType??null,period.metricType??null,user.role,user.sub,user.sub]);
  const users=await select(c,`SELECT CAST(u.id AS CHAR) id,u.display_name,u.role,CAST(u.parent_id AS CHAR) parent_id FROM users u JOIN project_members pm ON pm.user_id=u.id WHERE pm.project_id=? AND pm.left_at IS NULL AND (? IN ('developer','admin','operator') OR u.id=? OR u.parent_id=?)`,[scope.projectId,user.role,user.sub,user.sub]);
  const prior=await select(c,`SELECT CAST(e.source_id AS CHAR) source_id,CAST(e.user_id AS CHAR) user_id,CAST(SUM(e.amount) AS CHAR) amount FROM opc_income_entries e JOIN opc_income_sources src ON src.id=e.source_id WHERE src.module_id='zhihu' AND src.account_id=? AND src.project_id=? AND src.business_date BETWEEN ? AND ? AND (? IN ('developer','admin','operator') OR e.user_id=?) GROUP BY e.source_id,e.user_id`,[scope.accountId,scope.projectId,period.from,period.to,user.role,user.sub]);
  const [route]=await select(c,'SELECT mode FROM zh_engine_routes WHERE account_id=? AND project_id=?',[scope.accountId,scope.projectId]);
  const entries:{id:string;factId:string;keywordId:string;resultId:string;revisionId:string;canAssignRetro?:boolean;retroFromDate?:string;metricType:MetricType;quantity:string|null;activations:string|null;settlementMismatch?:AttributionSnapshot['settlementMismatch'];internal?:boolean;keyword:string;date:string;orders:string|null;payeeId:string;payeeName:string;parentId:string|null;role:string;payerName:string;amount:string|null;confirmedAmount:string;pendingAmount:string;kind:string;status:string;ownPayable:boolean;ownReceivable:boolean;blocked:string;reasonCode:string;reason:string;next:string;ready:boolean}[]=[];
  const team=new Map<string,{executorId:string;name:string;orders:bigint;commission:bigint;activations:bigint;activationCommission:bigint}>();
  const stats={new_user:{records:0,quantity:0n,billableQuantity:0n,pendingQuantity:0n},activation:{records:0,quantity:0n,billableQuantity:0n,pendingQuantity:0n}};
  let staffTotal=0n;
  let orderTotal=0n,billableOrders=0n,pendingOrders=0n;const tokens:unknown[]=[];
  for(const r of rows){
   if(!r.snapshot_json)continue;
   const snap=json<AttributionSnapshot>(r.snapshot_json);
   const metricType:MetricType=r.metric_type==='activation'?'activation':'new_user';
   const quantity=metricType==='activation'?snap.activations??null:snap.orders;
   const typed={canAssignRetro:dutyAllows(user,'operations')&&!r.executor_id&&!Number(r.ownership_history)&&!r.stop_new_use_at&&r.release_status!=='requested'&&route?.mode!=='stopped'&&!['archived','retired'].includes(String(r.lifecycle_status)),retroFromDate:String(r.retro_from_date??snap.date),metricType,quantity,activations:snap.activations??null,...(isStaffRole(user.role)?{settlementMismatch:snap.settlementMismatch??null}:{})};
   const targets=allocations(snap);
   const internal=snap.obligations.some(o=>o.relation==='activation:staff_self');
   staffTotal+=money(targets.staffAmount);
   stats[metricType].records++;stats[metricType].quantity+=BigInt(quantity??'0');
   stats[metricType][targets.list.length||internal?'billableQuantity':'pendingQuantity']+=BigInt(quantity??'0');
   if(metricType==='new_user'){orderTotal+=BigInt(snap.orders??'0');if(targets.list.length)billableOrders+=BigInt(snap.orders??'0');else pendingOrders+=BigInt(snap.orders??'0');}
   const reasonCode=route?.mode==='stopped'?'BUSINESS_STOPPED':Number(r.pending_revision)>0?'SOURCE_REVISION_PENDING':String(r.reason_code??'')||(r.verification_status==='passed'?'':r.verification_status==='disputed'?'WORK_DISPUTED':Number(r.evidence_count)?'WORK_UNVERIFIED':'WORK_MISSING');
   const text=reasonCode?reasonText(reasonCode,{metricType,bindingId:r.binding_id,executorId:r.executor_id,executorName:r.executor_name,executorRole:r.executor_role,leaderName:r.leader_name}):{reason:'',next:'财务：核对并确认账单'};
   const blocked=text.reason;
   if(user.role==='leader'&&String(r.leader_id)===user.sub&&r.executor_id&&String(r.executor_id)!==user.sub){
    const executorId=String(r.executor_id),member=users.find(u=>String(u.id)===executorId);
    const item=team.get(executorId)??{executorId,name:String(member?.display_name??'团队成员'),orders:0n,commission:0n,activations:0n,activationCommission:0n};
    item[metricType==='activation'?'activations':'orders']+=BigInt(quantity??'0');
    item[metricType==='activation'?'activationCommission':'commission']+=money(targets.list.find(a=>a.userId===user.sub)?.amount??'0');team.set(executorId,item);
   }
   const confirmed=String(r.source_version??'')===String(r.result_id)&&!r.blocked_reason&&!blocked;
   if(confirmed)text.next='';
   tokens.push([r.id,r.result_id,r.revision_id,r.verification_status,r.pending_revision,r.source_version,r.blocked_reason,targets]);
   if(!targets.list.length){
    const payeeId=isStaffRole(user.role)?String(r.executor_id??''):user.sub;
    entries.push({id:r.id+'-pending',factId:String(r.id),keywordId:String(r.keyword_id),resultId:String(r.result_id),revisionId:String(r.revision_id),...typed,internal,keyword:snap.keyword,date:snap.date,orders:snap.orders,payeeId,payeeName:isStaffRole(user.role)?String(r.executor_name??'待确定'):'本人',parentId:null,role:'',payerName:'平台',amount:internal?targets.staffAmount:null,confirmedAmount:'0.0000',pendingAmount:'0.0000',kind:'initial',status:internal?'internal':'pending',ownPayable:isStaffRole(user.role),ownReceivable:!isStaffRole(user.role)&&!internal,blocked,reasonCode,...text,...(internal?{next:'',reason:'管理员业绩，不计入应付'}:{}),ready:false});
   }
   for(const a of targets.list){
    if(!isStaffRole(user.role)&&a.userId!==user.sub)continue;
    const payee=users.find(u=>String(u.id)===a.userId);
    const before=money(String(prior.find(p=>String(p.source_id)===String(r.source_id)&&String(p.user_id)===a.userId)?.amount??'0'),true);
    entries.push({id:r.id+'-'+a.userId,factId:String(r.id),keywordId:String(r.keyword_id),resultId:String(r.result_id),revisionId:String(r.revision_id),...typed,keyword:snap.keyword,date:snap.date,orders:snap.orders,payeeId:a.userId,payeeName:String(payee?.display_name??'本人'),parentId:payee?.parent_id?String(payee.parent_id):null,role:String(payee?.role??''),payerName:'平台',amount:a.amount,confirmedAmount:moneyText(before),pendingAmount:moneyText(money(a.amount)-before),kind:r.source_version&&!confirmed?'adjustment':'initial',status:confirmed?'confirmed':'draft',ownPayable:isStaffRole(user.role),ownReceivable:a.userId===user.sub,blocked,reasonCode,...text,ready:isStaffRole(user.role)&&!blocked&&!confirmed});
   }
  }
  // A source without a matching keyword has no fact yet. Include it for staff,
  // deduplicate repeat uploads by business dimensions, and never expose unowned
  // rows to members. Every original line remains in its import result.
  const unresolved=isStaffRole(user.role)?await select(c,`SELECT CAST(r.id AS CHAR) id,r.normalized_json,r.error_text,IF(b.report_kind='activation','activation','new_user') metric_type
    FROM zh_import_rows r JOIN zh_import_batches b ON b.id=r.batch_id
    WHERE b.account_id=? AND b.project_id=? AND r.fact_id IS NULL AND r.processing_status='exception'
      AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.date')) BETWEEN ? AND ?
      AND (? IS NULL OR IF(b.report_kind='activation','activation','new_user')=?)
      AND EXISTS(SELECT 1 FROM zh_exceptions x WHERE x.source_row_id=r.id AND x.status='open')
      AND NOT EXISTS(SELECT 1 FROM zh_import_rows matched JOIN zh_import_batches mb ON mb.id=matched.batch_id
        WHERE mb.account_id=b.account_id AND mb.project_id=b.project_id AND matched.fact_id IS NOT NULL
          AND (mb.report_kind='activation')=(b.report_kind='activation')
          AND JSON_EXTRACT(matched.normalized_json,'$.date')=JSON_EXTRACT(r.normalized_json,'$.date')
          AND JSON_EXTRACT(matched.normalized_json,'$.channel')=JSON_EXTRACT(r.normalized_json,'$.channel')
          AND JSON_EXTRACT(matched.normalized_json,'$.keyword')=JSON_EXTRACT(r.normalized_json,'$.keyword'))
    ORDER BY r.id`,[scope.accountId,scope.projectId,period.from,period.to,period.metricType??null,period.metricType??null]):[];
  const missing=new Map<string,{id:string;raw:SourceRow;code:string;metricType:MetricType}>();
  for(const r of unresolved){const raw=json<SourceRow>(r.normalized_json),metricType:MetricType=r.metric_type==='activation'?'activation':'new_user',key=JSON.stringify([raw.date,raw.channel,raw.keyword,metricType]);const previous=missing.get(key);missing.set(key,{id:String(r.id),raw:{...raw,orders:raw.orders??previous?.raw.orders??null},code:String(r.error_text),metricType});}
  let unmatchedOrders=0n;
  for(const {id,raw,code,metricType} of missing.values()){
   const text=reasonText(code,{metricType}),quantity=metricType==='activation'?raw.activations??null:raw.orders;
   if(metricType==='new_user')unmatchedOrders+=BigInt(raw.orders??'0');
   stats[metricType].records++;stats[metricType].quantity+=BigInt(quantity??'0');stats[metricType].pendingQuantity+=BigInt(quantity??'0');
   entries.push({id:'source-'+id,factId:'',keywordId:'',resultId:'',revisionId:'',metricType,quantity,activations:raw.activations??null,keyword:raw.keyword,date:raw.date,orders:raw.orders,payeeId:'',payeeName:'待确定',parentId:null,role:'',payerName:'平台',amount:null,confirmedAmount:'0.0000',pendingAmount:'0.0000',kind:'initial',status:'pending',ownPayable:true,ownReceivable:false,blocked:text.reason,reasonCode:code,...text,ready:false});
   tokens.push(['source',id,raw,code]);
  }
  pendingOrders+=unmatchedOrders;
  entries.sort((a,b)=>Number(b.status==='pending')-Number(a.status==='pending'));
  const sum=(predicate:(e:typeof entries[number])=>boolean,field:'amount'|'confirmedAmount'|'pendingAmount'='amount')=>moneyText(entries.filter(predicate).reduce((n,e)=>n+money(e[field]??'0',true),0n));
  const teamPerformance=[...team.values()].map(t=>({...t,orders:String(t.orders),commission:moneyText(t.commission),activations:String(t.activations),activationCommission:moneyText(t.activationCommission)}));
  // 管理员按实际结算对象汇总：团队达人的金额归入所属团长，点击明细仍保留达人原始收款人。
  const pricedEntries=entries.filter(e=>e.amount!==null&&!e.internal);
  const groupEntries=isStaffRole(user.role)?pricedEntries.map(e=>{
    if(e.role==='creator'&&e.parentId){const leader=users.find(u=>String(u.id)===e.parentId);if(leader?.role==='leader')return {...e,payeeId:e.parentId,payeeName:String(leader.display_name)};}
    return e;
  }):pricedEntries;
  const groupSum=(predicate:(e:typeof groupEntries[number])=>boolean,field:'amount'|'confirmedAmount'|'pendingAmount'='amount')=>moneyText(groupEntries.filter(predicate).reduce((n,e)=>n+money(e[field]??'0',true),0n));
  const groups=[...new Set(groupEntries.map(e=>e.payeeId))].map(payeeId=>{const list=groupEntries.filter(e=>e.payeeId===payeeId);return{payeeId,name:list[0].payeeName,confirmed:groupSum(e=>e.payeeId===payeeId,'confirmedAmount'),pending:groupSum(e=>e.payeeId===payeeId,'pendingAmount'),total:groupSum(e=>e.payeeId===payeeId),blockers:[...new Set(list.map(e=>e.blocked).filter(Boolean))],ready:list.filter(e=>e.ready).length};});
  const [issues]=await select(c,`SELECT COUNT(*) total FROM zh_exceptions x LEFT JOIN zh_import_rows r ON r.id=x.source_row_id LEFT JOIN zh_metric_facts f ON f.id=x.fact_id WHERE x.account_id=? AND x.project_id=? AND x.status='open' AND (? IN ('developer','admin','operator')) AND COALESCE(DATE_FORMAT(f.business_date,'%Y-%m-%d'),JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.date'))) BETWEEN ? AND ?`,[scope.accountId,scope.projectId,user.role,period.from,period.to]);
  const typedSummary=(type:MetricType)=>({records:stats[type].records,quantity:String(stats[type].quantity),orders:String(type==='new_user'?stats[type].quantity:0n),billableQuantity:String(stats[type].billableQuantity),pendingQuantity:String(stats[type].pendingQuantity),payable:sum(e=>e.metricType===type&&!e.internal),confirmedPayable:sum(e=>e.metricType===type&&!e.internal,'confirmedAmount'),pendingPayable:sum(e=>e.metricType===type&&!e.internal,'pendingAmount'),receivable:sum(e=>e.metricType===type&&e.ownReceivable),confirmedReceivable:sum(e=>e.metricType===type&&e.ownReceivable,'confirmedAmount'),pendingReceivable:sum(e=>e.metricType===type&&e.ownReceivable,'pendingAmount')});
  const byType={new_user:typedSummary('new_user'),activation:typedSummary('activation')};
  return{period,entries,groups,teamPerformance,reviewHash:digest([scope,period,tokens]),needsReview:route?.mode==='trial',summary:{records:stats.new_user.records,totalRecords:rows.length+missing.size,orders:String(orderTotal),totalOrders:String(orderTotal+unmatchedOrders),billableOrders:String(billableOrders),pendingOrders:String(pendingOrders),issues:Number(issues.total),receivable:byType.new_user.receivable,confirmedReceivable:byType.new_user.confirmedReceivable,pendingReceivable:byType.new_user.pendingReceivable,payable:byType.new_user.payable,confirmedPayable:byType.new_user.confirmedPayable,pendingPayable:byType.new_user.pendingPayable,retained:byType.new_user.receivable,byType,staffAmount:isStaffRole(user.role)?moneyText(staffTotal):'0.0000'},withdrawal:{enabled:true,message:'已确认且款项可用后，可在下方申请提现。'}};
 };
 return connection?read(connection):withTransaction(read);
}
export async function confirmBills(user:AuthUser,scope:Scope,period:Period,key:string,reviewHash:string){
 scope={projectId:scope.projectId,accountId:scope.accountId};period={from:period.from,to:period.to,...(period.metricType?{metricType:period.metricType}:{})};
 assertDuty(user,'finance');valid(period);await authorize(user,scope);
 return withTransaction(async c=>{
  await gate(c,false);
  const common={...scope,moduleId:'zhihu'};await lockFinance(c,common);
  const view=await overview(user,scope,period,c);if(view.reviewHash!==reviewHash)fail('数据或审核状态已更新，请刷新后重新核对',409);
  const [route]=await select(c,'SELECT * FROM zh_engine_routes WHERE account_id=? AND project_id=?',[scope.accountId,scope.projectId]);
  if(!route||route.mode==='stopped')fail('业务尚未准备好，请联系运营');
  if(route.mode==='trial'){await c.query("UPDATE zh_engine_routes SET mode='enabled',sample_verified=1,reason=?,updated_by=? WHERE id=?",['财务在做账页面已核对当前报表金额',user.sub,route.id]);await audit(c,user,'engine.finance-review',String(route.id),{period});}
  const ready=[...new Map(view.entries.filter(e=>e.ready).map(e=>[e.factId,e])).values()];
  for(const e of ready){
   const snapshot=await statements.confirmFinancialFact(c,user,scope,e.factId,e.resultId,e.revisionId);
   const target=allocations(snapshot);
   await syncIncome(c,user,common,{sourceKey:'fact:'+e.factId,version:e.resultId,date:e.date,description:e.keyword,allocations:target.list,total:target.total});
  }
  await audit(c,user,'workbench.confirm',scope.projectId,{key,period,count:ready.length});
  return{confirmed:ready.length,waiting:new Set(view.entries.filter(e=>e.status!=='confirmed'&&!e.ready).map(e=>e.factId||e.id)).size};
 });
}
