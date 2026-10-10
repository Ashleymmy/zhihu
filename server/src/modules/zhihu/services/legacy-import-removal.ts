import type {PoolConnection} from 'mysql2/promise';
import type {AuthUser} from '../../../types';
import {withTransaction} from '../../../db';
import {assertDuty} from '../../../core/duties';
import {gate} from '../attribution/routing';
import {digest,fail} from '../attribution/domain';
import {audit,authorize,scopeLock,select} from '../attribution/store';
import {planImportWithdrawal,withdrawImportTransaction} from '../attribution/import-withdrawal';

async function preview(c:PoolConnection,user:AuthUser,id:string){
 await gate(c);
 const [original]=await select(c,'SELECT * FROM data_import_batches WHERE id=?',[id]);
 if(!original)fail('这份历史报表不存在',404);
 const linked=await select(c,"SELECT id,account_id,project_id FROM zh_import_batches WHERE file_sha256=? AND status<>'withdrawn' ORDER BY account_id,project_id,id",[original.file_sha256]);
 for(const row of linked){const scope={accountId:String(row.account_id),projectId:String(row.project_id)};await authorize(user,scope);await scopeLock(c,scope,user);}
 const [batch]=await select(c,'SELECT * FROM data_import_batches WHERE id=? FOR UPDATE',[id]);
 if(!batch)fail('这份历史报表已删除',404);
 const rows=await select(c,'SELECT * FROM data_import_rows WHERE batch_id=? ORDER BY id',[id]);
 // These old tables have no reliable per-upload provenance. Never erase a real
 // historical settlement merely because it shares a date or keyword.
 const legacyMoney=batch.status==='confirmed'?await select(c,`SELECT e.id FROM earnings e LEFT JOIN plans p ON p.id=e.plan_id WHERE EXISTS
  (SELECT 1 FROM data_import_rows r WHERE r.batch_id=? AND (r.occurred_at IS NULL OR e.settle_date=DATE(r.occurred_at)) AND (p.keyword=r.keyword OR p.id IS NULL)) LIMIT 1`,[id]):[];
 const oldTasks=batch.status==='confirmed'?await select(c,`SELECT t.id FROM attribution_tasks t WHERE EXISTS(SELECT 1 FROM data_import_rows r WHERE r.batch_id=? AND t.keyword=r.keyword AND t.data_date=DATE(r.occurred_at)) LIMIT 1`,[id]):[];
 const plans=[];
 for(const row of linked){const scope={accountId:String(row.account_id),projectId:String(row.project_id)};plans.push({scope,...(await planImportWithdrawal(c,scope,String(row.id))).summary});}
 return {id,fileName:String(batch.file_name),rows:rows.length,linked:plans,canRemove:!legacyMoney.length&&!oldTasks.length,
  blocked:legacyMoney.length||oldTasks.length?'这份报表有关联的旧结算记录，不能直接删除原始凭据。':'',
  reviewHash:digest({batch,rows,plans,legacyMoney,oldTasks})};
}
export async function previewLegacyImportRemoval(user:AuthUser,id:string){
 assertDuty(user,'finance');return withTransaction(c=>preview(c,user,id));
}
export async function removeLegacyImport(user:AuthUser,id:string,reviewHash:string){
 assertDuty(user,'finance');return withTransaction(async c=>{
  const current=await preview(c,user,id);
  if(current.reviewHash!==reviewHash)fail('报表状态已变化，请重新查看删除影响',409);
  if(!current.canRemove)fail(current.blocked,409);
  for(const linked of current.linked){
   // Earlier removals may change a later report's effective contribution.
   const plan=await planImportWithdrawal(c,linked.scope,linked.id);
   await withdrawImportTransaction(c,user,linked.scope,linked.id,plan.summary.reviewHash);
  }
  await audit(c,user,'legacy-report.remove',id,{fileName:current.fileName,rows:current.rows,linked:current.linked.map(row=>row.id)});
  await c.query('DELETE FROM data_import_rows WHERE batch_id=?',[id]);
  await c.query('DELETE FROM data_import_batches WHERE id=?',[id]);
  return {id,removed:true,withdrawn:current.linked.length,corrections:current.linked.reduce((n,row)=>n+row.corrections,0)};
 });
}
