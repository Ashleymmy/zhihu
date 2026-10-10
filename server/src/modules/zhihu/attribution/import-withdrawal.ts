import type {PoolConnection} from 'mysql2/promise';
import type {AuthUser} from '../../../types';
import {withTransaction} from '../../../db';
import {assertDuty} from '../../../core/duties';
import {removeUnconfirmedEarningSource} from '../../../core/earnings';
import {audit,authorize,insert,json,mutate,scopeLock,select,type RecordRow} from './store';
import {digest,fail,type Scope} from './domain';
import {attribute,empty,mergeSource,type FactSnapshot} from './facts';
import type {SourceRow,ReportKind} from './report';

const fields=['search','orders','revenue','activations','settlement','agency','riskAssessment'] as const;
const valueHash=(s:FactSnapshot)=>digest(fields.map(field=>s[field]??null));

/** Replay accepted contributions only. Rejected/pending uploads never become authoritative
 * simply because another report was removed. Identical duplicate rows can support a value. */
export function remainingSource(currentId:unknown,revisions:RecordRow[],rows:RecordRow[],withdrawId:string,metricType:'new_user'|'activation'){
 const chain:RecordRow[]=[];let cursor=currentId;
 const seen=new Set<string>();
 while(cursor&&!seen.has(String(cursor))){
  seen.add(String(cursor));const revision=revisions.find(v=>String(v.id)===String(cursor));
  if(!revision)break;chain.unshift(revision);cursor=revision.parent_revision_id;
 }
 const next=empty(metricType);
 for(const revision of chain){
  const snapshot=json<FactSnapshot>(revision.snapshot_json);
  if(snapshot.withdrawalOf)continue;
  const original=rows.find(row=>String(row.id)===String(revision.source_row_id));
  if(!original)continue;
  const owned=fields.filter(field=>snapshot.sources[field]?.rowId===String(original.id));
  let supporting=original;
  if(String(original.batch_id)===withdrawId||original.batch_status==='withdrawn'){
   const duplicate=rows.find(row=>String(row.batch_id)!==withdrawId&&row.batch_status!=='withdrawn'&&row.processing_status==='duplicate'&&row.report_kind===original.report_kind&&owned.every(field=>(json<SourceRow>(row.normalized_json)[field]??null)===(snapshot[field]??null)));
   if(!duplicate)continue;
   supporting=duplicate;
  }
  for(const field of owned){next[field]=snapshot[field]??null;next.sources[field]={kind:supporting.report_kind as ReportKind,rowId:String(supporting.id)};}
 }
 return next;
}

export async function planImportWithdrawal(c:PoolConnection,scope:Scope,id:string){
 const [batch]=await select(c,'SELECT * FROM zh_import_batches WHERE id=? AND account_id=? AND project_id=? FOR UPDATE',[id,scope.accountId,scope.projectId]);
 if(!batch)fail('这份报表不存在',404);
 if(batch.status==='withdrawn')fail('这份报表已经撤销，可以重新上传',409);
 const sourceRows=await select(c,'SELECT id,processing_status,fact_id,normalized_json FROM zh_import_rows WHERE batch_id=? ORDER BY id',[id]);
 const facts=await select(c,`SELECT f.*,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day,
  (SELECT s.source_version FROM opc_income_sources s WHERE s.module_id='zhihu' AND s.project_id=f.project_id AND s.account_id=f.account_id AND s.source_key=CONCAT('fact:',f.id)) confirmed_version,
  (SELECT MAX(e.id) FROM zh_statement_entries e WHERE e.fact_id=f.id AND e.status='confirmed') confirmed_entry_id,
  (EXISTS(SELECT 1 FROM zh_statement_entries e WHERE e.fact_id=f.id AND e.status='confirmed') OR
   EXISTS(SELECT 1 FROM opc_income_sources s WHERE s.module_id='zhihu' AND s.project_id=f.project_id AND s.account_id=f.account_id AND s.source_key=CONCAT('fact:',f.id))) confirmed
  FROM zh_metric_facts f WHERE f.account_id=? AND f.project_id=? AND EXISTS(SELECT 1 FROM zh_import_rows r WHERE r.batch_id=? AND r.fact_id=f.id) ORDER BY f.id FOR UPDATE`,[scope.accountId,scope.projectId,id]);
 const changes=[];
 for(const fact of facts){
  const rows=await select(c,`SELECT r.*,b.status batch_status,b.report_kind FROM zh_import_rows r JOIN zh_import_batches b ON b.id=r.batch_id WHERE r.fact_id=? ORDER BY r.id`,[fact.id]);
  const revisions=await select(c,'SELECT * FROM zh_metric_revisions WHERE fact_id=? ORDER BY id',[fact.id]);
  const current=revisions.find(v=>String(v.id)===String(fact.current_revision_id));
  const before=current?json<FactSnapshot>(current.snapshot_json):empty(fact.metric_type==='activation'?'activation':'new_user');
  const next=remainingSource(fact.current_revision_id,revisions,rows,id,fact.metric_type==='activation'?'activation':'new_user');
  const changed=valueHash(before)!==valueHash(next);
  changes.push({fact,rows,revisions,next,changed,empty:!Object.keys(next.sources).length});
 }
 const reviewHash=digest({id,sourceRows,changes:changes.map(change=>[change.fact.id,change.fact.current_revision_id,change.fact.current_result_id,change.fact.confirmed,change.fact.confirmed_version,change.fact.confirmed_entry_id,change.next,change.rows.map(row=>[row.id,row.processing_status,row.batch_status]),change.revisions.map(r=>[r.id,r.status])])});
 const dates=sourceRows.map(r=>String(json<SourceRow>(r.normalized_json).date??'')).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
 const summary={period:dates.length?{from:dates[0],to:dates[dates.length-1]}:null,id,fileName:String(batch.file_name),reviewHash,rows:sourceRows.length,
  removed:changes.filter(x=>x.changed&&x.empty&&!Number(x.fact.confirmed)).length,
  restored:changes.filter(x=>x.changed&&!x.empty&&!Number(x.fact.confirmed)).length,
  retained:changes.filter(x=>!x.changed&&!x.empty).length,
  corrections:changes.filter(x=>x.changed&&Number(x.fact.confirmed)).length};
 return {summary,changes};
}

export async function previewImportWithdrawal(user:AuthUser,scope:Scope,id:string){
 assertDuty(user,'finance');await authorize(user,scope);
 return withTransaction(async c=>{await scopeLock(c,scope,user);return(await planImportWithdrawal(c,scope,id)).summary;});
}

export async function withdrawImport(user:AuthUser,scope:Scope,id:string,key:string,reviewHash:string){
 assertDuty(user,'finance');
 return mutate(user,scope,'report.withdraw',key,{id,reviewHash},c=>withdrawImportTransaction(c,user,scope,id,reviewHash));
}

export async function withdrawImportTransaction(c:PoolConnection,user:AuthUser,scope:Scope,id:string,reviewHash:string){
  const {summary,changes}=await planImportWithdrawal(c,scope,id);
  if(summary.reviewHash!==reviewHash)fail('报表数据或确认状态已变化，请重新查看撤销影响',409);
  await c.query("UPDATE zh_import_batches SET status='withdrawn' WHERE id=?",[id]);
  await c.query("UPDATE zh_processing_jobs SET status='done',lease_token=NULL,lease_until=NULL,last_error=NULL WHERE batch_id=?",[id]);
  await c.query("UPDATE zh_metric_revisions v JOIN zh_import_rows r ON r.id=v.source_row_id SET v.status='withdrawn' WHERE r.batch_id=? AND v.status='pending'",[id]);
  await c.query("UPDATE zh_exceptions SET status='resolved',resolution='来源报表已撤销',resolved_at=NOW(3) WHERE source_row_id IN (SELECT id FROM zh_import_rows WHERE batch_id=?) AND status='open'",[id]);
  for(const change of changes){
   const {fact,rows,revisions}=change;
   if(change.changed){
    if(change.empty&&!Number(fact.confirmed)){
     await c.query('UPDATE zh_metric_facts SET current_revision_id=NULL,current_result_id=NULL,version=version+1 WHERE id=?',[fact.id]);
     await c.query("DELETE FROM zh_statement_entries WHERE fact_id=? AND status<>'confirmed'",[fact.id]);
     await removeUnconfirmedEarningSource(c,{...scope,moduleId:'zhihu'},'fact:'+fact.id);
     await c.query("UPDATE zh_exceptions SET status='resolved',resolution='来源报表已撤销',resolved_at=NOW(3) WHERE fact_id=? AND source_row_id IS NULL AND status='open'",[fact.id]);
     fact.current_revision_id=null;fact.current_result_id=null;
    }else{
     const next={...change.next,withdrawalOf:id};
     // No remaining billable source: create a zero target against the existing
     // confirmed recipients. Confirmation still uses the ordinary correction ledger.
     if(Number(fact.confirmed)&&(fact.metric_type==='activation'?next.activations==null:next.orders==null))next.withdrawn=true;
     const row=rows.find(r=>String(r.batch_id)===id)!;
     const generation=Math.max(-1,...revisions.filter(v=>String(v.source_row_id)===String(row.id)).map(v=>Number(v.candidate_generation)))+1;
     const revisionId=await insert(c,"INSERT INTO zh_metric_revisions(fact_id,source_row_id,parent_revision_id,snapshot_json,status,accepted_by,reason,candidate_generation) VALUES(?,?,?,?,'accepted',?,'撤销报表后重新计算',?)",[fact.id,row.id,fact.current_revision_id,JSON.stringify(next),user.sub,generation]);
     await c.query('UPDATE zh_metric_facts SET current_revision_id=?,version=version+1 WHERE id=?',[revisionId,fact.id]);
     fact.current_revision_id=revisionId;
    }
   }
   // Refresh still-pending choices against the new source; users can decide in
   // place instead of meeting a permanently disabled “use this report” button.
   for(const candidate of revisions.filter(v=>v.status==='pending')){
    const row=rows.find(r=>String(r.id)===String(candidate.source_row_id));
    if(!row||String(row.batch_id)===id||row.batch_status==='withdrawn')continue;
    if(!change.changed)continue;
    const {next}=mergeSource(change.next,json<SourceRow>(row.normalized_json),row.report_kind as ReportKind,String(row.id));
    await c.query("UPDATE zh_metric_revisions SET status='superseded' WHERE id=?",[candidate.id]);
    const generation=Math.max(...revisions.filter(v=>String(v.source_row_id)===String(row.id)).map(v=>Number(v.candidate_generation)))+1;
    await insert(c,"INSERT INTO zh_metric_revisions(fact_id,source_row_id,parent_revision_id,snapshot_json,status,reason,candidate_generation,supersedes_candidate_id) VALUES(?,?,?,?,'pending','原报表撤销后重新核对',?,?)",[fact.id,row.id,fact.current_revision_id,JSON.stringify(next),generation,candidate.id]);
   }
   if(fact.current_revision_id)await attribute(c,scope,fact);
  }
  await c.query("UPDATE zh_import_rows SET processing_status='withdrawn',error_text=NULL WHERE batch_id=?",[id]);
  await audit(c,user,'report.withdraw',id,summary);
  return summary;
}
