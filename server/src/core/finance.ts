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
export async function lockFinance(c:PoolConnection,s:FinanceScope){
 const rows=await q(c,"SELECT a.id FROM integration_accounts a JOIN project_integrations pi ON pi.account_id=a.id JOIN projects p ON p.id=pi.project_id WHERE a.id=? AND a.module_id=? AND pi.project_id=? AND a.status='active' AND p.is_enabled=1 FOR UPDATE",[s.accountId,s.moduleId,s.projectId]);
 if(!rows.length)fail('项目与接入账号不匹配',403);
}
async function authorize(u:AuthUser,s:FinanceScope){
 await assertDataScope(u,s.projectId,s.accountId,s.moduleId);
 if(u.role==='admin')assertDuty(u,'finance');
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
export async function blockIncome(c:PoolConnection,s:FinanceScope,sourceKey:string,reason:string){
 await lockFinance(c,s);await c.query('UPDATE opc_income_sources SET blocked_reason=? WHERE module_id=? AND account_id=? AND source_key=?',[reason,s.moduleId,s.accountId,sourceKey]);
}
async function balance(c:PoolConnection,u:AuthUser,s:FinanceScope){
 const [income]=await q(c,`SELECT CAST(COALESCE(SUM(e.amount),0) AS CHAR) confirmed,
 CAST(COALESCE(SUM(CASE WHEN e.availability='available' AND (src.blocked_reason IS NULL OR e.amount<0) THEN e.amount ELSE 0 END),0) AS CHAR) released,
 CAST(COALESCE(SUM(CASE WHEN e.availability='held' THEN e.amount ELSE 0 END),0) AS CHAR) held
 FROM opc_income_entries e JOIN opc_income_sources src ON src.id=e.source_id WHERE src.module_id=? AND src.project_id=? AND src.account_id=? AND e.user_id=?`,[s.moduleId,s.projectId,s.accountId,u.sub]);
 const [reserved]=await q(c,`SELECT CAST(COALESCE(SUM(CASE WHEN status IN ('pending','approved','paid') THEN amount ELSE 0 END),0) AS CHAR) reserved,
 CAST(COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) AS CHAR) paid,
 CAST(COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN amount ELSE 0 END),0) AS CHAR) processing FROM opc_withdrawals WHERE module_id=? AND project_id=? AND account_id=? AND user_id=?`,[s.moduleId,s.projectId,s.accountId,u.sub]);
 const available=cash(String(income.released),true)-cash(String(reserved.reserved),true);
 return {confirmed:cashText(cash(String(income.confirmed),true)),held:cashText(cash(String(income.held),true)),available:cashText(available>0n?available:0n),offset:cashText(available<0n?-available:0n),paid:cashText(cash(String(reserved.paid))),processing:cashText(cash(String(reserved.processing)))};
}
async function fundingRows(c:PoolConnection,s:FinanceScope){
 return q(c,`SELECT CAST(e.id AS CHAR) id,CAST(e.amount AS CHAR) amount FROM opc_income_entries e JOIN opc_income_sources src ON src.id=e.source_id
 WHERE src.module_id=? AND src.project_id=? AND src.account_id=? AND src.blocked_reason IS NULL AND e.availability='held' ORDER BY e.id`,[s.moduleId,s.projectId,s.accountId]);
}
export async function financeOverview(u:AuthUser,s:FinanceScope,page=1){
 await authorize(u,s);
 return withTransaction(async c=>{
  const own=u.role==='admin'?'':' AND w.user_id=?',args=[s.moduleId,s.projectId,s.accountId,...(u.role==='admin'?[]:[u.sub])];
  const [count]=await q(c,'SELECT COUNT(*) total FROM opc_withdrawals w WHERE w.module_id=? AND w.project_id=? AND w.account_id=?'+own,args);
  const withdrawals=await q(c,`SELECT CAST(w.id AS CHAR) id,CAST(w.user_id AS CHAR) user_id,u.display_name,CAST(w.amount AS CHAR) amount,w.status,w.receiver_name,w.bank_name,w.bank_account,w.remark,w.created_at,w.payment_reference,DATE_FORMAT(w.paid_on,'%Y-%m-%d') paid_on,w.proof_name FROM opc_withdrawals w JOIN users u ON u.id=w.user_id WHERE w.module_id=? AND w.project_id=? AND w.account_id=?`+own+' ORDER BY w.id DESC LIMIT 25 OFFSET ?',[...args,(page-1)*25]);
  const rows=u.role==='admin'?await fundingRows(c,s):[];
  return {balance:u.role==='admin'?null:await balance(c,u,s),withdrawals,total:Number(count.total),page,funding:{amount:cashText(rows.reduce((n,r)=>n+cash(String(r.amount),true),0n)),hash:checksum(rows)},canManage:u.role==='admin'};
 });
}
export async function releaseFunding(u:AuthUser,s:FinanceScope,hash:string,reference:string){
 assertDuty(u,'finance');await authorize(u,s);
 if(!reference.trim())fail('请填写到账凭据或核对说明');
 return withTransaction(async c=>{
  await lockFinance(c,s);const rows=await fundingRows(c,s);
  if(checksum(rows)!==hash)fail('待开放金额已更新，请刷新核对',409);
  if(!rows.length)fail('没有待开放的款项');
  await c.query("UPDATE opc_income_entries SET availability='available',released_by=?,released_at=NOW(3),release_reference=? WHERE id IN (?) AND availability='held'",[u.sub,reference,rows.map(r=>r.id)]);
  await writeAudit({userId:u.sub,action:'finance.funding_release',resourceType:'account',resourceId:s.accountId,detail:{reference,entryIds:rows.map(r=>r.id)}},c);
  return {amount:cashText(rows.reduce((n,r)=>n+cash(String(r.amount),true),0n))};
 });
}
export async function applyWithdrawal(u:AuthUser,s:FinanceScope,key:string,input:{amount:string;receiverName:string;bankName:string;bankAccount:string}){
 if(!['leader','creator'].includes(u.role))fail('请使用团长或达人账号申请提现',403);
 await authorize(u,s);
 if(!/^\d+(\.\d{1,2})?$/.test(input.amount)||cash(input.amount)<=0n)fail('提现金额须大于零，最多两位小数');
 const hash=checksum([s,input]);
 return withTransaction(async c=>{
  await lockFinance(c,s);
  const [old]=await q(c,'SELECT id,request_hash FROM opc_withdrawals WHERE user_id=? AND request_key=?',[u.sub,key]);
  if(old){if(old.request_hash!==hash)fail('请刷新页面后重新申请',409);return{id:String(old.id)}}
  const funds=await balance(c,u,s);if(cash(input.amount)>cash(funds.available))fail('可提现余额不足');
  const [r]=await c.query<import('mysql2/promise').ResultSetHeader>('INSERT INTO opc_withdrawals(module_id,project_id,account_id,user_id,amount,request_key,request_hash,receiver_name,bank_name,bank_account) VALUES(?,?,?,?,?,?,?,?,?,?)',[s.moduleId,s.projectId,s.accountId,u.sub,input.amount,key,hash,input.receiverName,input.bankName,input.bankAccount]);
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
export function validateProof(file:{buffer:Buffer;originalname:string;size:number}){
 if(file.size>5*1024*1024||file.size!==file.buffer.length)fail('付款凭证最大 5 MB');
 const b=file.buffer;let type='';
 if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))type='image/png';
 else if(b[0]===255&&b[1]===216&&b[2]===255)type='image/jpeg';
 else if(b.subarray(0,5).toString()==='%PDF-')type='application/pdf';
 if(!type)fail('付款凭证请使用 PNG、JPG 或 PDF 文件');
 return type;
}
export async function recordPayment(u:AuthUser,s:FinanceScope,id:string,input:{reference:string;paidOn:string},file:{buffer:Buffer;originalname:string;size:number}){
 assertDuty(u,'finance');await authorize(u,s);
 const type=validateProof(file),proofHash=checksum(file.buffer.toString('base64'));
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
 if(input.paidOn>today)fail('付款日期不能晚于今天');
 return withTransaction(async c=>{
  await lockFinance(c,s);const w=await withdrawal(c,s,id);
  if(w.status==='paid'){if(w.payment_reference!==input.reference||w.proof_hash!==proofHash||String(w.paid_day)!==input.paidOn)fail('已登记付款，不能重复修改',409);return{id};}
  if(w.status!=='approved')fail('请先审核通过这笔提现申请',409);
  const funds=await balance(c,{...u,sub:String(w.user_id)},s);if(cash(funds.offset)>0n)fail('来源金额或状态发生变化，请先核对账单',409);
  if((await q(c,'SELECT id FROM opc_withdrawals WHERE payment_reference=?',[input.reference])).length)fail('该付款流水已经登记，不能重复使用',409);
  await c.query("UPDATE opc_withdrawals SET status='paid',payment_reference=?,paid_on=?,paid_by=?,paid_at=NOW(3),proof_name=?,proof_type=?,proof_bytes=?,proof_hash=? WHERE id=?",[input.reference,input.paidOn,u.sub,file.originalname.replace(/[\r\n/\\]/g,'_').slice(0,255),type,file.buffer,proofHash,id]);
  await writeAudit({userId:u.sub,action:'finance.payment_record',resourceType:'withdrawal',resourceId:id,detail:{reference:input.reference,paidOn:input.paidOn,amount:String(w.amount),proofHash}},c);return{id};
 });
}
export async function paymentProof(u:AuthUser,s:FinanceScope,id:string){
 await authorize(u,s);return withTransaction(async c=>{const w=await withdrawal(c,s,id);if(u.role!=='admin'&&String(w.user_id)!==u.sub)fail('无权查看此付款凭证',403);if(!w.proof_bytes)fail('尚未登记付款凭证',404);return{name:String(w.proof_name),type:String(w.proof_type),buffer:w.proof_bytes as Buffer};});
}


export async function paymentSheet(u:AuthUser,s:FinanceScope){
 assertDuty(u,'finance');await authorize(u,s);
 return withTransaction(c=>q(c,"SELECT CAST(w.id AS CHAR) id,p.name project_name,u.display_name,w.receiver_name,w.bank_name,w.bank_account,CAST(w.amount AS CHAR) amount FROM opc_withdrawals w JOIN users u ON u.id=w.user_id JOIN projects p ON p.id=w.project_id WHERE w.module_id=? AND w.project_id=? AND w.account_id=? AND w.status='approved' ORDER BY w.id",[s.moduleId,s.projectId,s.accountId]));
}
