import type {PoolConnection} from 'mysql2/promise';
import {gate} from './routing';
import type {AuthUser} from '../../../types';
import {withTransaction} from '../../../db';
import {authorize,select,json,audit} from './store';
import {day,digest,fail,money,moneyText,type Scope} from './domain';
import {assertDuty} from '../../../core/duties';
import {lockFinance,syncIncome} from '../../../core/finance';
import {parseReport,type ReportKind} from './report';
import type {AllianceUploadFile} from '../zhihu/allianceXlsx';
import type {AttributionSnapshot} from './facts';
import * as facts from './facts';
import * as statements from './statements';
import * as cutover from './cutover';
export interface Period{from:string;to:string}
function valid(p:Period){day(p.from);day(p.to);if(p.from>p.to)fail('开始日期不能晚于结束日期')}
export function allocations(snapshot:AttributionSnapshot){
 const values=new Map<string,bigint>();let total=0n;
 for(const o of snapshot.obligations){
  const amount=money(o.amount);
  if(o.relation==='agency_leader'||o.relation==='agency_creator'){values.set(o.payeeId,(values.get(o.payeeId)??0n)+amount);total+=amount;}
  else if(o.relation==='leader_creator'){values.set(o.payeeId,(values.get(o.payeeId)??0n)+amount);values.set(o.payerId,(values.get(o.payerId)??0n)-amount);}
 }
 if([...values.values()].some(v=>v<0n))fail('团队分配超过平台应付，请核对定价规则',409);
 return{total:moneyText(total),list:[...values].map(([userId,amount])=>({userId,amount:moneyText(amount)}))};
}
export async function uploadReport(user:AuthUser,scope:Scope,file:AllianceUploadFile){
 assertDuty(user,'finance');await authorize(user,scope);
 let kind:ReportKind='combined',parsed;
 try{parsed=await parseReport(file,kind)}catch(e){
  if(!(e instanceof Error)||e.message!=='报告类型与指标列不一致')throw e;
  try{kind='order';parsed=await parseReport(file,kind)}catch(e2){
   if(!(e2 instanceof Error)||e2.message!=='报告类型与指标列不一致')throw e2;
   kind='search';parsed=await parseReport(file,kind);
  }
 }
 const bad=parsed.filter(r=>r.error);
 if(bad.length){
  const examples=bad.slice(0,3).map(r=>r.rowNumber+'行：'+r.error).join('；');
  const more=bad.length>3?'；另有 '+(bad.length-3)+' 行需要检查':'';
  fail('有 '+bad.length+' 行无法识别：'+examples+more+'。请按提示修正后重新上传');
 }
 const dates=parsed.map(r=>r.value.date).sort();if(!dates.length)fail('报表中没有可读取的数据');
 const route=await cutover.getRoute(user,scope);
 if(route&&dates.some(date=>date<String(route.exclusive_from)))fail('这份报表包含 '+dates[0]+' 至 '+dates[dates.length-1]+' 的历史数据，早于新归因规则 '+String(route.exclusive_from)+' 的生效日期。请到“历史邮件 / Excel 导入”页面处理，当前财务做账只接收新规则生效后的报表');
 if(!route)await cutover.configureRoute(user,scope,{from:dates[0],mode:'trial',sampleVerified:false,reason:'首次上传后自动计算，等待财务核对金额'});
 const b=await facts.previewImport(user,scope,file,kind),detail=await facts.importDetail(user,scope,b.id,1,1);
 await facts.commitImport(user,scope,b.id,'workbench-import-'+b.id,detail.preview_hash);
 await facts.processBatch(user,scope,b.id);
 return {...b,from:dates[0],to:dates[dates.length-1]};
}
export async function overview(user:AuthUser,scope:Scope,period:Period,connection?:PoolConnection){
 scope={projectId:scope.projectId,accountId:scope.accountId};period={from:period.from,to:period.to};
 valid(period);if(!connection)await authorize(user,scope);
 const read=async(c:PoolConnection)=>{
  const rows=await select(c,`SELECT CAST(f.id AS CHAR) id,CAST(f.current_result_id AS CHAR) result_id,CAST(f.current_revision_id AS CHAR) revision_id,
    r.snapshot_json,r.reason_code,b.verification_status,b.leader_id,b.executor_id,
    src.id source_id,src.source_version,src.blocked_reason,
    EXISTS(SELECT 1 FROM zh_metric_revisions v WHERE v.fact_id=f.id AND v.status='pending') pending_revision
    FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id
    LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id LEFT JOIN zh_attribution_results r ON r.id=f.current_result_id
    LEFT JOIN opc_income_sources src ON src.module_id='zhihu' AND src.account_id=f.account_id AND src.source_key=CONCAT('fact:',f.id)
    WHERE f.account_id=? AND f.project_id=? AND f.business_date BETWEEN ? AND ? AND (?='admin' OR b.leader_id=? OR b.executor_id=?) ORDER BY f.id`,
    [scope.accountId,scope.projectId,period.from,period.to,user.role,user.sub,user.sub]);
  const users=await select(c,`SELECT CAST(u.id AS CHAR) id,u.display_name,u.role,CAST(u.parent_id AS CHAR) parent_id FROM users u JOIN project_members pm ON pm.user_id=u.id WHERE pm.project_id=? AND pm.left_at IS NULL AND (?='admin' OR u.id=? OR u.parent_id=?)`,[scope.projectId,user.role,user.sub,user.sub]);
  const prior=await select(c,`SELECT CAST(e.source_id AS CHAR) source_id,CAST(e.user_id AS CHAR) user_id,CAST(SUM(e.amount) AS CHAR) amount FROM opc_income_entries e JOIN opc_income_sources src ON src.id=e.source_id WHERE src.module_id='zhihu' AND src.account_id=? AND src.project_id=? AND src.business_date BETWEEN ? AND ? AND (?='admin' OR e.user_id=? OR EXISTS(SELECT 1 FROM users u WHERE u.id=e.user_id AND u.parent_id=?)) GROUP BY e.source_id,e.user_id`,[scope.accountId,scope.projectId,period.from,period.to,user.role,user.sub,user.sub]);
  const [route]=await select(c,'SELECT mode FROM zh_engine_routes WHERE account_id=? AND project_id=?',[scope.accountId,scope.projectId]);
  const entries:{id:string;factId:string;resultId:string;revisionId:string;keyword:string;date:string;orders:string|null;payeeId:string;payeeName:string;parentId:string|null;role:string;payerName:string;amount:string;confirmedAmount:string;pendingAmount:string;kind:string;status:string;ownPayable:boolean;ownReceivable:boolean;blocked:string;ready:boolean}[]=[];
  let orderTotal=0n;const tokens:unknown[]=[];
  for(const r of rows){
   if(!r.snapshot_json)continue;
   const snap=json<AttributionSnapshot>(r.snapshot_json);orderTotal+=BigInt(snap.orders??'0');
   const targets=allocations(snap);let blocked='';
   if(route?.mode==='stopped')blocked='业务已暂停，请联系运营';
   else if(Number(r.pending_revision)>0)blocked='待财务核对报表更正';
   else if(r.reason_code)blocked='待运营补齐归属或定价资料';
   else if(r.verification_status!=='passed')blocked=r.verification_status==='disputed'?'作品有争议，待运营处理':'待审核作品';
   const confirmed=String(r.source_version??'')===String(r.result_id)&&!r.blocked_reason&&!blocked;
   tokens.push([r.id,r.result_id,r.revision_id,r.verification_status,r.pending_revision,r.source_version,r.blocked_reason,targets]);
   for(const a of targets.list){
    if(user.role==='creator'&&a.userId!==user.sub)continue;
    const payee=users.find(u=>String(u.id)===a.userId);
    const before=money(String(prior.find(p=>String(p.source_id)===String(r.source_id)&&String(p.user_id)===a.userId)?.amount??'0'),true);
    entries.push({id:r.id+'-'+a.userId,factId:String(r.id),resultId:String(r.result_id),revisionId:String(r.revision_id),keyword:snap.keyword,date:snap.date,orders:snap.orders,payeeId:a.userId,payeeName:String(payee?.display_name??'本人'),parentId:payee?.parent_id?String(payee.parent_id):null,role:String(payee?.role??''),payerName:'平台',amount:a.amount,confirmedAmount:moneyText(before),pendingAmount:moneyText(money(a.amount)-before),kind:r.source_version&&!confirmed?'adjustment':'initial',status:confirmed?'confirmed':'draft',ownPayable:user.role==='admin',ownReceivable:a.userId===user.sub,blocked,ready:user.role==='admin'&&!blocked&&!confirmed});
   }
  }
  const sum=(predicate:(e:typeof entries[number])=>boolean,field:'amount'|'confirmedAmount'|'pendingAmount'='amount')=>moneyText(entries.filter(predicate).reduce((n,e)=>n+money(e[field],true),0n));
  // 管理员按实际结算对象汇总：团队达人的金额归入所属团长，点击明细仍保留达人原始收款人。
  const groupEntries=user.role==='admin'?entries.map(e=>{
    if(e.role==='creator'&&e.parentId){const leader=users.find(u=>String(u.id)===e.parentId);return {...e,payeeId:e.parentId,payeeName:String(leader?.display_name??'团长')};}
    return e;
  }):entries;
  const groupSum=(predicate:(e:typeof groupEntries[number])=>boolean,field:'amount'|'confirmedAmount'|'pendingAmount'='amount')=>moneyText(groupEntries.filter(predicate).reduce((n,e)=>n+money(e[field],true),0n));
  const groups=[...new Set(groupEntries.map(e=>e.payeeId))].map(payeeId=>{const list=groupEntries.filter(e=>e.payeeId===payeeId);return{payeeId,name:list[0].payeeName,confirmed:groupSum(e=>e.payeeId===payeeId,'confirmedAmount'),pending:groupSum(e=>e.payeeId===payeeId,'pendingAmount'),total:groupSum(e=>e.payeeId===payeeId),blockers:[...new Set(list.map(e=>e.blocked).filter(Boolean))],ready:list.filter(e=>e.ready).length};});
  const [issues]=await select(c,`SELECT COUNT(*) total FROM zh_exceptions x LEFT JOIN zh_import_rows r ON r.id=x.source_row_id LEFT JOIN zh_metric_facts f ON f.id=x.fact_id WHERE x.account_id=? AND x.project_id=? AND x.status='open' AND (?='admin') AND COALESCE(DATE_FORMAT(f.business_date,'%Y-%m-%d'),JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.date'))) BETWEEN ? AND ?`,[scope.accountId,scope.projectId,user.role,period.from,period.to]);
  return{period,entries,groups,reviewHash:digest([scope,period,tokens]),needsReview:route?.mode==='trial',summary:{records:rows.length,orders:String(orderTotal),issues:Number(issues.total),receivable:sum(e=>e.ownReceivable),confirmedReceivable:sum(e=>e.ownReceivable,'confirmedAmount'),pendingReceivable:sum(e=>e.ownReceivable,'pendingAmount'),payable:sum(()=>true),confirmedPayable:sum(()=>true,'confirmedAmount'),pendingPayable:sum(()=>true,'pendingAmount'),retained:sum(e=>e.ownReceivable)},withdrawal:{enabled:true,message:'已确认且款项可用后，可在下方申请提现。'}};
 };
 return connection?read(connection):withTransaction(read);
}
export async function confirmBills(user:AuthUser,scope:Scope,period:Period,key:string,reviewHash:string){
 scope={projectId:scope.projectId,accountId:scope.accountId};period={from:period.from,to:period.to};
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
  return{confirmed:ready.length,waiting:new Set(view.entries.filter(e=>e.status==='draft'&&!e.ready).map(e=>e.factId)).size};
 });
}
