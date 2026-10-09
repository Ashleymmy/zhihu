import type {AuthUser} from '../../../types';
import {assertDuty} from '../../../core/duties';
import {fail,type Scope} from './domain';
import {audit,mutate,select} from './store';
import {assertReportWriteEnabled,type ReportKind} from './report';
import {attribute} from './facts';
import {unconfirmedFactSql} from './keyword-usability';
import {scheduleImport} from './outbox';

export async function archiveImport(user:AuthUser,scope:Scope,id:string,key:string,archived:boolean){
 assertDuty(user,'finance');
 return mutate(user,scope,'report.archive',key,{id,archived},async c=>{
  const [batch]=await select(c,'SELECT id FROM zh_import_batches WHERE id=? AND account_id=? AND project_id=? FOR UPDATE',[id,scope.accountId,scope.projectId]);
  if(!batch)fail('报表不存在',404);
  if(archived){
   const pending=await select(c,"SELECT id FROM zh_import_rows WHERE batch_id=? AND processing_status='pending' LIMIT 1",[id]);
   if(pending.length)fail('报表仍在读取，请等分析结束后再清理；暂时中断的报表可先继续分析',409);
   await c.query('INSERT INTO zh_import_history_archive(batch_id,archived_by) VALUES(?,?) ON DUPLICATE KEY UPDATE batch_id=batch_id',[id,user.sub]);
  }else await c.query('DELETE FROM zh_import_history_archive WHERE batch_id=?',[id]);
  await audit(c,user,archived?'report.archive':'report.restore',id);
  return {id,archived};
 });
}

export async function reanalyzeImport(user:AuthUser,scope:Scope,id:string,key:string){
 assertDuty(user,'finance');
 return mutate(user,scope,'report.reanalyze',key,{id},async c=>{
  const [batch]=await select(c,"SELECT id,report_kind FROM zh_import_batches WHERE id=? AND account_id=? AND project_id=? AND status<>'preview' FOR UPDATE",[id,scope.accountId,scope.projectId]);
  if(!batch)fail('报表不存在或尚未上传完成',404);
  assertReportWriteEnabled(batch.report_kind as ReportKind);
  // Do not replay accepted/rejected source changes: an older report must never
  // overwrite a newer decision. Retry unmatched rows and refresh unsettled facts.
  await c.query("UPDATE zh_import_rows SET processing_status='pending',error_text=NULL WHERE batch_id=? AND processing_status='exception' AND fact_id IS NULL",[id]);
  const records=await select(c,`SELECT f.*,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day FROM zh_metric_facts f
   JOIN zh_engine_routes route ON route.account_id=f.account_id AND route.project_id=f.project_id
   WHERE f.account_id=? AND f.project_id=? AND route.mode<>'stopped' AND f.business_date>=route.exclusive_from
   AND EXISTS(SELECT 1 FROM zh_import_rows r WHERE r.batch_id=? AND r.fact_id=f.id)
   AND ${unconfirmedFactSql()} ORDER BY f.id FOR UPDATE`,[scope.accountId,scope.projectId,id]);
  let changed=0;
  for(const fact of records){
   const result=await attribute(c,scope,fact);
   if(result&&String(fact.current_result_id)!==result.id)changed++;
  }
  await c.query("UPDATE zh_import_batches SET status='committed' WHERE id=?",[id]);
  await c.query('DELETE FROM zh_import_history_archive WHERE batch_id=?',[id]);
  await scheduleImport(c,scope,id,user.sub);
  await audit(c,user,'report.reanalyze',id,{refreshed:records.length,changed});
  return {id,refreshed:records.length,changed};
 });
}
