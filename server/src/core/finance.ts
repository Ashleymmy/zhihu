import {financeReceipt} from './finance-receipts';
import {calculateWithdrawal,shanghaiDay,withdrawalRules,withdrawalPolicyEnabled} from './withdrawal-policy';
import { isStaffRole } from '../auth/roles';
import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../types';
import { withTransaction } from '../db';
import { assertDataScope } from './accounts';
import { assertDuty } from './duties';
import { cash,cashText,checksum } from './money';
import { AppError } from '../middleware/errors';
import { writeAudit } from '../services/audit.service';
export interface FinanceScope { moduleId:string; projectId:string; accountId:string }
const q=async(c:PoolConnection,sql:string,args:unknown[]=[])=> (await c.query<import('mysql2/promise').RowDataPacket[]>(sql,args))[0];
const fail=(message:string,status=422):never=>{throw new AppError(status,status*100,message)};
const termsJoin=` LEFT JOIN opc_withdrawal_terms wt ON wt.withdrawal_id=w.id LEFT JOIN opc_withdrawal_invoices wi ON wi.id=(SELECT MAX(i.id) FROM opc_withdrawal_invoices i WHERE i.withdrawal_id=w.id) LEFT JOIN opc_withdrawal_invoice_instructions ii ON ii.withdrawal_id=w.id `;
const termsColumns=`wt.policy_version,CAST(COALESCE(wt.fee_amount,0) AS CHAR) fee_amount,CAST(COALESCE(wt.net_amount,w.amount) AS CHAR) net_amount,wt.tier,DATE_FORMAT(wt.review_deadline,'%Y-%m-%d') review_deadline,DATE_FORMAT(wt.settlement_deadline,'%Y-%m-%d') settlement_deadline,wt.settlement_month,COALESCE(wt.invoice_required,0) invoice_required,COALESCE(wi.version,0) invoice_version,wi.status invoice_status,wi.reason invoice_reason,wi.filename invoice_name,ii.instructions invoice_instructions`;
const normalizeWithdrawal=(row:import('mysql2/promise').RowDataPacket):import('mysql2/promise').RowDataPacket&{invoice_required:boolean;invoice_version:number}=>({...row,invoice_required:Number(row.invoice_required)===1,invoice_version:Number(row.invoice_version)});
export async function lockFinance(c:PoolConnection,s:FinanceScope){
 const rows=await q(c,"SELECT a.id FROM integration_accounts a JOIN project_integrations pi ON pi.account_id=a.id JOIN projects p ON p.id=pi.project_id WHERE a.id=? AND a.module_id=? AND pi.project_id=? AND a.status='active' AND p.is_enabled=1 FOR UPDATE",[s.accountId,s.moduleId,s.projectId]);
 if(!rows.length)fail('项目与接入账号不匹配',403);
}
async function authorize(u:AuthUser,s:FinanceScope){
 await assertDataScope(u,s.projectId,s.accountId,s.moduleId);
 if(isStaffRole(u.role))assertDuty(u,'finance');
}
export async function syncIncome(c:PoolConnection,u:AuthUser,s:FinanceScope,input:{sourceKey:string;version:string;date:string;description:string;allocations:{userId:string;amount:string}[];total:string}){
 assertDuty(u,'finance');await lockFinance(c,s);
 const allocations=[...input.allocations].sort((a,b)=>BigInt(a.userId)<BigInt(b.userId)?-1:1);
 if(new Set(allocations.map(a=>a.userId)).size!==allocations.length)fail('收款人重复');
 if(allocations.reduce((v,a)=>v+cash(a.amount),0n)!==cash(input.total))fail('分配金额与应付总额不一致');
 const hash=checksum([input.date,allocations,input.total]);
 let [source]=await q(c,'SELECT * FROM opc_income_sources WHERE module_id=? AND account_id=? AND source_key=? FOR UPDATE',[s.moduleId,s.accountId,input.sourceKey]);
 if(source&&String(source.project_id)!==s.projectId)fail('收入来源已属于其他项目',409);
 if(source&&source.source_version===input.version&&source.snapshot_hash===hash){await c.query('UPDATE opc_income_sources SET blocked_reason=NULL WHERE id=?',[source.id]);return;}
 if(source&&source.source_version===input.version)fail('同一账单版本不能对应不同金额',409);
 if(!source){
  const [r]=await c.query<import('mysql2/promise').ResultSetHeader>('INSERT INTO opc_income_sources(module_id,project_id,account_id,source_key,business_date,source_version,snapshot_hash,description) VALUES(?,?,?,?,?,?,?,?)',[s.moduleId,s.projectId,s.accountId,input.sourceKey,input.date,input.version,hash,input.description]);source={id:String(r.insertId)} as import('mysql2/promise').RowDataPacket;
 }
 const prior=await q(c,"SELECT CAST(user_id AS CHAR) user_id,CAST(SUM(amount) AS CHAR) target,CAST(SUM(CASE WHEN availability='held' THEN amount ELSE 0 END) AS CHAR) held FROM opc_income_entries WHERE source_id=? GROUP BY user_id",[source.id]);
 const targets=new Map(allocations.map(a=>[a.userId,cash(a.amount)]));
 for(const old of prior)if(!targets.has(String(old.user_id)))targets.set(String(old.user_id),0n);
 for(const [userId,target] of targets){
  const before=prior.find(p=>String(p.user_id)===userId),delta=target-cash(String(before?.target??'0'),true);
  if(delta===0n)continue;
  const held=cash(String(before?.held??'0'),true);
  const heldReduction=delta<0n&&held>0n?(-delta<held?-delta:held):0n;
  const portions=delta>=0n?[{amount:delta,state:'held'}]:[{amount:-heldReduction,state:'held'},{amount:delta+heldReduction,state:'available'}];
  for(const part of portions)if(part.amount!==0n)await c.query('INSERT INTO opc_income_entries(source_id,source_version,user_id,amount,target_amount,availability,entry_part,confirmed_by) VALUES(?,?,?,?,?,?,?,?)',[source.id,input.version,userId,cashText(part.amount),cashText(target),part.state,part.state,u.sub]);
 }
 await c.query('UPDATE opc_income_sources SET source_version=?,snapshot_hash=?,blocked_reason=NULL WHERE id=?',[input.version,hash,source.id]);
 await writeAudit({userId:u.sub,action:'finance.income_confirm',resourceType:'income_source',resourceId:String(source.id),detail:{moduleId:s.moduleId,sourceKey:input.sourceKey,version:input.version,total:input.total}},c);
}
export async function blockIncome(c:PoolConnection,s:FinanceScope,sourceKey:string,reason:string,next='财务：核对来源记录'){
 await lockFinance(c,s);await c.query('UPDATE opc_income_sources SET blocked_reason=? WHERE module_id=? AND account_id=? AND source_key=?',[reason,s.moduleId,s.accountId,sourceKey]);
 await c.query('UPDATE opc_earning_sources SET blocked_reason=?,next_action=? WHERE module_id=? AND project_id=? AND account_id=? AND source_key=?',[reason,next,s.moduleId,s.projectId,s.accountId,sourceKey]);
}
async function balance(c:PoolConnection,u:AuthUser,s:FinanceScope){
 const [income]=await q(c,`SELECT CAST(COALESCE(SUM(e.amount),0) AS CHAR) confirmed,
 CAST(COALESCE(SUM(CASE WHEN e.availability='available' AND (src.blocked_reason IS NULL OR e.amount<0) THEN e.amount ELSE 0 END),0) AS CHAR) released,
 CAST(COALESCE(SUM(CASE WHEN e.availability='held' THEN e.amount ELSE 0 END),0) AS CHAR) held
 FROM opc_income_entries e JOIN opc_income_sources src ON src.id=e.source_id WHERE src.module_id=? AND src.project_id=? AND src.account_id=? AND e.user_id=?`,[s.moduleId,s.projectId,s.accountId,u.sub]);
 const [reserved]=await q(c,`SELECT CAST(COALESCE(SUM(CASE WHEN status IN ('pending','approved','paid') THEN amount ELSE 0 END),0) AS CHAR) reserved,
 CAST(COALESCE(SUM(CASE WHEN status='paid' THEN COALESCE((SELECT t.net_amount FROM opc_withdrawal_terms t WHERE t.withdrawal_id=opc_withdrawals.id),amount) ELSE 0 END),0) AS CHAR) paid,
 CAST(COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN amount ELSE 0 END),0) AS CHAR) processing FROM opc_withdrawals WHERE module_id=? AND project_id=? AND account_id=? AND user_id=?`,[s.moduleId,s.projectId,s.accountId,u.sub]);
 const available=cash(String(income.released),true)-cash(String(reserved.reserved),true);
 return {confirmed:cashText(cash(String(income.confirmed),true)),held:cashText(cash(String(income.held),true)),available:cashText(available>0n?available:0n),offset:cashText(available<0n?-available:0n),paid:cashText(cash(String(reserved.paid))),processing:cashText(cash(String(reserved.processing)))};
}
async function fundingRows(c:PoolConnection,s:FinanceScope){
 return q(c,`SELECT CAST(e.id AS CHAR) id,CAST(e.amount AS CHAR) amount FROM opc_income_entries e JOIN opc_income_sources src ON src.id=e.source_id
 WHERE src.module_id=? AND src.project_id=? AND src.account_id=? AND src.blocked_reason IS NULL AND e.availability='held' ORDER BY e.id`,[s.moduleId,s.projectId,s.accountId]);
}
export async function financeOverview(u:AuthUser,s:FinanceScope,page=1,attention:'all'|'due'|'overdue'='all'){
 await authorize(u,s);
 return withTransaction(async c=>{
  const now=new Date(),localNow=shanghaiDay(now)+' '+new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now);
  const settlement="TIMESTAMP(wt.settlement_deadline,IF(wt.tier='small','18:00:00','23:59:59'))";
  const deadline=`IF(w.status='pending',LEAST(TIMESTAMP(wt.review_deadline,'18:00:00'),${settlement}),${settlement})`;
  const followup=`CASE WHEN w.status NOT IN ('pending','approved') OR wt.policy_version IS NULL THEN 'none' WHEN ${deadline}<? THEN 'overdue' WHEN ${deadline}<=DATE_ADD(?,INTERVAL 3 DAY) THEN 'due' ELSE 'none' END`;
  const own=isStaffRole(u.role)?'':' AND w.user_id=?',args:unknown[]=[s.moduleId,s.projectId,s.accountId,...(isStaffRole(u.role)?[]:[u.sub])];
  const filter=attention==='all'?'':` AND (${followup})=?`;if(attention!=='all')args.push(localNow,localNow,attention);
  const where=' WHERE w.module_id=? AND w.project_id=? AND w.account_id=?'+own+filter;
  const [count]=await q(c,'SELECT COUNT(*) total FROM opc_withdrawals w'+termsJoin+where,args);
  const withdrawals=await q(c,`SELECT CAST(w.id AS CHAR) id,CAST(w.user_id AS CHAR) user_id,u.display_name,CAST(w.amount AS CHAR) amount,w.status,w.receiver_name,w.bank_name,w.bank_account,w.pay_method,w.pay_account,w.payment_version,w.paid_by,w.paid_at,w.remark,w.created_at,w.payment_reference,DATE_FORMAT(w.paid_on,'%Y-%m-%d') paid_on,w.proof_name,${termsColumns},(${followup}) attention FROM opc_withdrawals w JOIN users u ON u.id=w.user_id ${termsJoin}`+where+' ORDER BY w.id DESC LIMIT 25 OFFSET ?',[localNow,localNow,...args,(page-1)*25]);
  const rows=isStaffRole(u.role)?await fundingRows(c,s):[];
  const todayUsed=!isStaffRole(u.role)&&(await q(c,'SELECT withdrawal_id FROM opc_withdrawal_terms WHERE user_id=? AND applied_day=?',[u.sub,shanghaiDay()])).length>0;
  return {balance:isStaffRole(u.role)?null:await balance(c,u,s),withdrawals:withdrawals.map(normalizeWithdrawal),total:Number(count.total),page,funding:{amount:cashText(rows.reduce((n,r)=>n+cash(String(r.amount),true),0n)),hash:checksum(rows)},canManage:isStaffRole(u.role),withdrawalPolicy:{...withdrawalRules(),todayUsed}};
 });
}
export async function releaseFunding(u:AuthUser,s:FinanceScope,hash:string,reference:string,requestKey?:string){
 assertDuty(u,'finance');await authorize(u,s);
 reference=reference.trim();
 return withTransaction(async c=>{
  await lockFinance(c,s);return financeReceipt(c,u,s,'funding',requestKey??'funding.'+hash,{hash,reference},async()=>{
  const rows=await fundingRows(c,s);
  if(checksum(rows)!==hash)fail('待开放金额已更新，请刷新核对',409);
  if(!rows.length)fail('没有待开放的款项');
  await c.query("UPDATE opc_income_entries SET availability='available',released_by=?,released_at=NOW(3),release_reference=? WHERE id IN (?) AND availability='held'",[u.sub,reference||null,rows.map(r=>r.id)]);
  await writeAudit({userId:u.sub,action:'finance.funding_release',resourceType:'account',resourceId:s.accountId,detail:{reference,entryIds:rows.map(r=>r.id)}},c);
  return {amount:cashText(rows.reduce((n,r)=>n+cash(String(r.amount),true),0n))};
  });
 });
}
export async function withdrawalQuote(u:AuthUser,s:FinanceScope,amount:string){
 if(!['leader','creator'].includes(u.role))fail('请使用团长或达人账号申请提现',403);
 await authorize(u,s);if(!withdrawalPolicyEnabled())fail('新提现规则尚未启用，请刷新后查看当前规则',409);
 return withTransaction(async c=>{
  const quote=calculateWithdrawal(amount,u.role);
  if((await q(c,'SELECT withdrawal_id FROM opc_withdrawal_terms WHERE user_id=? AND applied_day=?',[u.sub,quote.appliedDay])).length)fail('今天已申请过提现，请查看申请记录，明天可再次申请');
  if(cash(amount)>cash((await balance(c,u,s)).available))fail('可提现余额不足');
  return {...quote,quoteToken:checksum([s.moduleId,s.projectId,s.accountId,u.sub,quote])};
 });
}
export async function applyWithdrawal(u:AuthUser,s:FinanceScope,key:string,input:{amount:string;receiverName?:string;bankName?:string;bankAccount?:string;payMethod?:PayMethod;payAccount?:string;policyVersion?:string;quoteToken?:string}){
 if(!['leader','creator'].includes(u.role))fail('请使用团长或达人账号申请提现',403);
 await authorize(u,s);
 if(!/^\d+(\.\d{1,2})?$/.test(input.amount)||cash(input.amount)<=0n)fail('提现金额须大于零，最多两位小数');
 const legacyHash=checksum([s,input]);
 const fields={amount:input.amount,receiverName:optionalText(input.receiverName),bankName:optionalText(input.bankName),bankAccount:optionalText(input.bankAccount),payMethod:payMethod(input.payMethod??'bank'),payAccount:optionalText(input.payAccount)};
 const hash=checksum([{moduleId:s.moduleId,projectId:s.projectId,accountId:s.accountId},fields]);
 return withTransaction(async c=>{
  // Serialize all projects and devices of one applicant before acquiring the scope lock.
  await q(c,'SELECT id FROM users WHERE id=? FOR UPDATE',[u.sub]);
  await lockFinance(c,s);
  const [old]=await q(c,'SELECT id,request_hash FROM opc_withdrawals WHERE user_id=? AND request_key=? FOR UPDATE',[u.sub,key]);
  if(old){if(old.request_hash!==hash&&old.request_hash!==legacyHash)fail('请刷新页面后重新申请',409);return{id:String(old.id)}}
  const quote=withdrawalPolicyEnabled()?calculateWithdrawal(input.amount,u.role):null;
  if(quote){
   if(input.policyVersion!==quote.policyVersion||input.quoteToken!==checksum([s.moduleId,s.projectId,s.accountId,u.sub,quote]))throw new AppError(409,40910,'提现规则或日期已更新，请刷新页面，核对手续费和到账金额后重新确认');
   if((await q(c,'SELECT withdrawal_id FROM opc_withdrawal_terms WHERE user_id=? AND applied_day=? FOR UPDATE',[u.sub,quote.appliedDay])).length)fail('今天已申请过提现，请查看申请记录，明天可再次申请');
  }else if(input.policyVersion||input.quoteToken)throw new AppError(409,40910,'提现规则已调整，请刷新后重新确认');
  const funds=await balance(c,u,s);if(cash(input.amount)>cash(funds.available))fail('可提现余额不足');
  const [r]=await c.query<import('mysql2/promise').ResultSetHeader>('INSERT INTO opc_withdrawals(module_id,project_id,account_id,user_id,amount,request_key,request_hash,receiver_name,bank_name,bank_account,pay_method,pay_account) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[s.moduleId,s.projectId,s.accountId,u.sub,input.amount,key,hash,fields.receiverName,fields.bankName,fields.bankAccount,fields.payMethod,fields.payAccount]);
  if(quote)await c.query('INSERT INTO opc_withdrawal_terms(withdrawal_id,user_id,applied_day,policy_version,applicant_role,fee_amount,net_amount,tier,review_deadline,settlement_deadline,settlement_month,invoice_required,terms_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[r.insertId,u.sub,quote.appliedDay,quote.policyVersion,u.role,quote.feeAmount,quote.netAmount,quote.tier,quote.reviewDeadline,quote.settlementDeadline,quote.settlementMonth,quote.invoiceRequired,JSON.stringify(quote)]);
  await writeAudit({userId:u.sub,action:'finance.withdraw_apply',resourceType:'withdrawal',resourceId:String(r.insertId),detail:{amount:input.amount}},c);
  return {id:String(r.insertId)};
 });
}
async function withdrawal(c:PoolConnection,s:FinanceScope,id:string){
 const [w]=await q(c,"SELECT *,DATE_FORMAT(paid_on,'%Y-%m-%d') paid_day FROM opc_withdrawals WHERE id=? AND module_id=? AND project_id=? AND account_id=? FOR UPDATE",[id,s.moduleId,s.projectId,s.accountId]);
 if(!w)fail('提现申请不存在',404);return w;
}
export async function reviewWithdrawal(u:AuthUser,s:FinanceScope,id:string,action:'approve'|'reject'|'cancel',reason:string){
 await authorize(u,s);if(action!=='cancel')assertDuty(u,'finance');
 return withTransaction(async c=>{
  await lockFinance(c,s);const w=await withdrawal(c,s,id),status=action==='approve'?'approved':action==='reject'?'rejected':'cancelled';
  if(action==='cancel'&&String(w.user_id)!==u.sub)fail('只能撤回自己的申请',403);
  if(w.status===status)return{id};
  if(w.status!=='pending')fail('申请状态已变化，请刷新',409);
  if(action==='reject'&&!reason.trim())fail('请填写退回原因');
  // Corrections and disputes may have reduced the balance after application.
  if(action==='approve'){const funds=await balance(c,{...u,sub:String(w.user_id)},s);if(cash(funds.offset)>0n)fail('来源金额或状态发生变化，请先核对账单',409)}
  await c.query('UPDATE opc_withdrawals SET status=?,reviewed_by=?,reviewed_at=NOW(3),remark=? WHERE id=?',[status,u.sub,reason||null,id]);
  await writeAudit({userId:u.sub,action:'finance.withdraw_'+action,resourceType:'withdrawal',resourceId:id,detail:{reason}},c);return{id};
 });
}
export function validateProof(file:{buffer:Buffer;originalname:string;size:number},label='付款凭证'){
 if(file.size>5*1024*1024||file.size!==file.buffer.length)fail(label+'最大 5 MB');
 const b=file.buffer;let type='';
 if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))type='image/png';
 else if(b[0]===255&&b[1]===216&&b[2]===255)type='image/jpeg';
 else if(b.subarray(0,5).toString()==='%PDF-')type='application/pdf';
 if(!type)fail(label+'请使用 PNG、JPG 或 PDF 文件');
 return type;
}
export type PayMethod='alipay'|'wechat'|'bank';
function payMethod(value:string):PayMethod{if(!['alipay','wechat','bank'].includes(value))fail('请选择微信、支付宝或银行卡');return value as PayMethod;}
function optionalText(value:string|undefined|null,max=128){const v=value?.trim()??'';if(v.length>max)fail('填写内容过长');return v||null;}
function validPaidOn(value:string){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value>today)fail('请填写不晚于今天的有效付款日期');}
type PaymentInput={reference?:string;paidOn:string;requestKey?:string;payMethod?:PayMethod;payAccount?:string;remark?:string;netAmount?:string;policyVersion?:string};
export async function recordPayment(u:AuthUser,s:FinanceScope,id:string,input:PaymentInput,file?:{buffer:Buffer;originalname:string;size:number}){
 assertDuty(u,'finance');await authorize(u,s);validPaidOn(input.paidOn);
 const type=file?validateProof(file):null,proofHash=file?checksum(file.buffer.toString('base64')):null;
 const reference=optionalText(input.reference),remark=optionalText(input.remark,500);
 if(input.payMethod)payMethod(input.payMethod);
 return withTransaction(async c=>{
  await lockFinance(c,s);
  return financeReceipt(c,u,s,'payment.record',input.requestKey,{id,paidOn:input.paidOn,reference,remark,payMethod:input.payMethod??null,payAccount:optionalText(input.payAccount),proofHash,...(input.policyVersion||input.netAmount?{policyVersion:input.policyVersion??null,netAmount:input.netAmount===undefined?null:cashText(cash(input.netAmount))}:{})},async()=>{
   const w=await withdrawal(c,s,id),method=input.payMethod??String(w.pay_method),account=input.payAccount===undefined?w.pay_account:optionalText(input.payAccount);
   if(w.status==='paid'){
    if(w.payment_reference!==reference||w.proof_hash!==proofHash||String(w.paid_day)!==input.paidOn||w.pay_method!==method||w.pay_account!==account||w.remark!==remark)fail('已经登记发放，不能重复修改；请使用更正登记',409);
    return{id};
   }
   if(!['pending','approved'].includes(String(w.status)))fail('申请状态已变化，请刷新后核对',409);
   const [terms]=await q(c,'SELECT *,CAST(net_amount AS CHAR) net_amount,CAST(fee_amount AS CHAR) fee_amount FROM opc_withdrawal_terms WHERE withdrawal_id=?',[id]);
   if(terms){
    if(input.policyVersion!==terms.policy_version||input.netAmount===undefined||cash(input.netAmount)!==cash(String(terms.net_amount)))fail('请更新页面，核对扣除手续费后的实付金额再登记付款',409);
    if(w.status!=='approved')fail('请先完成提现审核，再登记实际付款',409);
    if(terms.invoice_required){const [invoice]=await q(c,'SELECT status FROM opc_withdrawal_invoices WHERE withdrawal_id=? ORDER BY version DESC LIMIT 1',[id]);if(invoice?.status!=='accepted')fail('团长发票尚未核验通过，请先核验发票',409);}
   }
   const funds=await balance(c,{...u,sub:String(w.user_id)},s);if(cash(funds.offset)>0n)fail('来源金额或状态发生变化，请先核对账单',409);
   if(reference&&(await q(c,'SELECT id FROM opc_withdrawals WHERE payment_reference=? AND id<>?',[reference,id])).length)fail('该付款流水已经登记，不能重复使用',409);
   await c.query("UPDATE opc_withdrawals SET status='paid',payment_reference=?,paid_on=?,paid_by=?,paid_at=NOW(3),proof_name=?,proof_type=?,proof_bytes=?,proof_hash=?,pay_method=?,pay_account=?,remark=?,payment_version=payment_version+1 WHERE id=?",[reference,input.paidOn,u.sub,file?file.originalname.replace(/[\r\n/\\]/g,'_').slice(0,255):null,type,file?.buffer??null,proofHash,method,account,remark,id]);
   await writeAudit({userId:u.sub,action:'finance.payment_record',resourceType:'withdrawal',resourceId:id,detail:{reference,paidOn:input.paidOn,amount:String(w.amount),netAmount:terms?cashText(cash(String(terms.net_amount))):String(w.amount),feeAmount:terms?cashText(cash(String(terms.fee_amount))):'0',proofHash,payMethod:method,previousStatus:w.status}},c);return{id};
  });
 });
}
export async function correctPayment(u:AuthUser,s:FinanceScope,id:string,input:{requestKey:string;expectedVersion:number;action:'amend'|'void';reason:string;paidOn?:string;reference?:string;remark?:string;payMethod?:PayMethod;payAccount?:string}){
 assertDuty(u,'finance');await authorize(u,s);
 if(input.paidOn)validPaidOn(input.paidOn);if(input.payMethod)payMethod(input.payMethod);
 if(!input.reason.trim()||input.reason.length>500)fail('请简要填写更正原因');
 return withTransaction(async c=>{
  await lockFinance(c,s);return financeReceipt(c,u,s,'payment.correct',input.requestKey,{id,...input},async()=>{
   const w=await withdrawal(c,s,id);
   if(w.status!=='paid'||Number(w.payment_version)!==input.expectedVersion)fail('发放记录已变化，请刷新后核对',409);
   const before={status:w.status,reference:w.payment_reference,paidOn:w.paid_day,payMethod:w.pay_method,payAccount:w.pay_account,remark:w.remark,paymentVersion:Number(w.payment_version)};
   const after={status:input.action==='void'?'approved':'paid',reference:input.reference===undefined?w.payment_reference:optionalText(input.reference),paidOn:input.paidOn??w.paid_day,payMethod:input.payMethod??w.pay_method,payAccount:input.payAccount===undefined?w.pay_account:optionalText(input.payAccount),remark:input.remark===undefined?w.remark:optionalText(input.remark,500),paymentVersion:Number(w.payment_version)+1};
   if(input.action==='void'){after.reference=null;after.paidOn=null;}
   if(after.reference&&(await q(c,'SELECT id FROM opc_withdrawals WHERE payment_reference=? AND id<>?',[after.reference,id])).length)fail('该付款流水已经登记，不能重复使用',409);
   await c.query('INSERT INTO opc_payment_changes(withdrawal_id,actor_id,action,reason,before_json,after_json,proof_name,proof_type,proof_bytes) VALUES(?,?,?,?,?,?,?,?,?)',[id,u.sub,input.action,input.reason,JSON.stringify(before),JSON.stringify(after),w.proof_name,w.proof_type,w.proof_bytes]);
   await c.query('UPDATE opc_withdrawals SET status=?,payment_reference=?,paid_on=?,pay_method=?,pay_account=?,remark=?,payment_version=payment_version+1,paid_by=IF(?=1,NULL,paid_by),paid_at=IF(?=1,NULL,paid_at) WHERE id=?',[after.status,after.reference,after.paidOn,after.payMethod,after.payAccount,after.remark,input.action==='void',input.action==='void',id]);
   await writeAudit({userId:u.sub,action:'finance.payment_correct',resourceType:'withdrawal',resourceId:id,detail:{reason:input.reason,before,after}},c);
   return {id,paymentVersion:after.paymentVersion};
  });
 });
}
export async function paymentHistory(u:AuthUser,s:FinanceScope,id:string){
 await authorize(u,s);return withTransaction(async c=>{const w=await withdrawal(c,s,id);if(!isStaffRole(u.role)&&String(w.user_id)!==u.sub)fail('无权查看此发放记录',403);return {list:await q(c,'SELECT CAST(id AS CHAR) id,action,reason,before_json,after_json,created_at,CAST(actor_id AS CHAR) actor_id,proof_name FROM opc_payment_changes WHERE withdrawal_id=? ORDER BY id DESC LIMIT 100',[id])};});
}
export async function paymentProof(u:AuthUser,s:FinanceScope,id:string){
 await authorize(u,s);return withTransaction(async c=>{const w=await withdrawal(c,s,id);if(!isStaffRole(u.role)&&String(w.user_id)!==u.sub)fail('无权查看此付款凭证',403);if(!w.proof_bytes)fail('尚未登记付款凭证',404);return{name:String(w.proof_name),type:String(w.proof_type),buffer:w.proof_bytes as Buffer};});
}


export async function paymentSheet(u:AuthUser,s:FinanceScope){
 assertDuty(u,'finance');await authorize(u,s);
 return withTransaction(async c=>(await q(c,`SELECT CAST(w.id AS CHAR) id,p.name project_name,u.display_name,w.receiver_name,w.bank_name,w.bank_account,w.status,w.pay_method,w.pay_account,CAST(w.amount AS CHAR) amount,${termsColumns} FROM opc_withdrawals w JOIN users u ON u.id=w.user_id JOIN projects p ON p.id=w.project_id ${termsJoin} WHERE w.module_id=? AND w.project_id=? AND w.account_id=? AND w.status IN ('pending','approved') ORDER BY w.id`,[s.moduleId,s.projectId,s.accountId])).map(normalizeWithdrawal));
}

async function invoiceAccess(c:PoolConnection,u:AuthUser,s:FinanceScope,id:string,ownOnly=false){
 const w=await withdrawal(c,s,id);
 if((ownOnly||!isStaffRole(u.role))&&String(w.user_id)!==u.sub)fail('只能查看或补充本人的发票',403);
 const [terms]=await q(c,'SELECT invoice_required FROM opc_withdrawal_terms WHERE withdrawal_id=?',[id]);
 if(!terms?.invoice_required)fail('本笔提现无需提供发票',409);
 return w;
}
export async function invoiceUploadAllowed(u:AuthUser,s:FinanceScope,id:string){
 await authorize(u,s);return withTransaction(async c=>{const w=await invoiceAccess(c,u,s,id,true);if(!['pending','approved'].includes(w.status))fail('申请已结束，不可修改发票',409);return {id};});
}
export async function setInvoiceInstructions(u:AuthUser,s:FinanceScope,id:string,instructions:string){
 assertDuty(u,'finance');await authorize(u,s);if(!instructions.trim()||instructions.length>2000)fail('请填写开票信息、票面要求和提交期限，最多 2000 字');
 return withTransaction(async c=>{await lockFinance(c,s);const w=await invoiceAccess(c,u,s,id);if(!['pending','approved'].includes(w.status))fail('申请已结束',409);
  await c.query('INSERT INTO opc_withdrawal_invoice_instructions(withdrawal_id,instructions,updated_by) VALUES(?,?,?) ON DUPLICATE KEY UPDATE instructions=VALUES(instructions),updated_by=VALUES(updated_by),updated_at=NOW(3)',[id,instructions.trim(),u.sub]);
  await writeAudit({userId:u.sub,action:'finance.invoice_instructions',resourceType:'withdrawal',resourceId:id,detail:{instructions:instructions.trim()}},c);return {id};});
}
export async function uploadInvoice(u:AuthUser,s:FinanceScope,id:string,expectedVersion:number,file?:{buffer:Buffer;originalname:string;size:number}){
 await authorize(u,s);if(!file)fail('请选择发票文件');
 const type=validateProof(file!,'发票'),hash=checksum(file!.buffer.toString('base64'));
 return withTransaction(async c=>{await lockFinance(c,s);const w=await invoiceAccess(c,u,s,id,true);
  const [prior]=await q(c,'SELECT * FROM opc_withdrawal_invoices WHERE withdrawal_id=? ORDER BY version DESC LIMIT 1',[id]);
  if(prior?.content_hash===hash&&Number(prior.version)===expectedVersion+1)return {id,version:Number(prior.version)};
  if(!['pending','approved'].includes(w.status))fail('申请已结束，不可修改发票',409);
  if(Number(prior?.version??0)!==expectedVersion)fail('发票已更新，请刷新后核对',409);
  if(prior?.status==='accepted')fail('发票已通过核验，如需调整请由财务先退回',409);
  await c.query('INSERT INTO opc_withdrawal_invoices(withdrawal_id,version,uploaded_by,filename,mime_type,content,content_hash) VALUES(?,?,?,?,?,?,?)',[id,expectedVersion+1,u.sub,file!.originalname.replace(/[\r\n/\\]/g,'_').slice(0,255),type,file!.buffer,hash]);
  await writeAudit({userId:u.sub,action:'finance.invoice_upload',resourceType:'withdrawal',resourceId:id,detail:{version:expectedVersion+1,hash}},c);return {id,version:expectedVersion+1};});
}
export async function reviewInvoice(u:AuthUser,s:FinanceScope,id:string,expectedVersion:number,action:'accept'|'reject',reason:string){
 assertDuty(u,'finance');await authorize(u,s);if(action==='reject'&&!reason.trim())fail('请填写发票退回原因');
 return withTransaction(async c=>{await lockFinance(c,s);const w=await invoiceAccess(c,u,s,id);if(!['pending','approved'].includes(w.status))fail('申请已结束',409);
  const [invoice]=await q(c,'SELECT * FROM opc_withdrawal_invoices WHERE withdrawal_id=? ORDER BY version DESC LIMIT 1',[id]);
  if(!invoice||Number(invoice.version)!==expectedVersion)fail('发票已更新，请刷新后核对',409);
  const status=action==='accept'?'accepted':'rejected';if(invoice.status===status&&String(invoice.reason??'')===reason.trim())return {id};
  await c.query('UPDATE opc_withdrawal_invoices SET status=?,reason=?,reviewed_by=?,reviewed_at=NOW(3) WHERE id=?',[status,reason.trim()||null,u.sub,invoice.id]);
  await writeAudit({userId:u.sub,action:'finance.invoice_'+action,resourceType:'withdrawal',resourceId:id,detail:{version:expectedVersion,reason,previousStatus:invoice.status}},c);return {id};});
}
export async function invoiceFile(u:AuthUser,s:FinanceScope,id:string){
 await authorize(u,s);return withTransaction(async c=>{await invoiceAccess(c,u,s,id);const [file]=await q(c,'SELECT filename,mime_type,content FROM opc_withdrawal_invoices WHERE withdrawal_id=? ORDER BY version DESC LIMIT 1',[id]);if(!file)fail('尚未上传发票',404);return {name:String(file.filename),type:String(file.mime_type),buffer:file.content as Buffer};});
}
