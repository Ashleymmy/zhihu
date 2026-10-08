import type {AuthUser} from '../../../types';
import {isStaffRole} from '../../../auth/roles';
import {assertDuty} from '../../../core/duties';
import {withTransaction} from '../../../db';
import type {Scope} from './domain';
import {authorize,select} from './store';

export async function historicalWorks(user:AuthUser,scope:Scope,filters:{batchId?:string;search?:string;page:number;pageSize:number}){
 if(isStaffRole(user.role))assertDuty(user,'operations');
 await authorize(user,scope);
 return withTransaction(async c=>{
   const values:unknown[]=[scope.accountId,scope.projectId,Number(isStaffRole(user.role)),user.sub,user.sub];
   let where=`k.account_id=? AND k.project_id=? AND p.project_id=k.project_id AND k.legacy_mode='historical_registered'
     AND b.used_at IS NOT NULL AND b.released_at IS NULL AND b.verification_status<>'passed'
     AND (?=1 OR b.leader_id=? OR b.executor_id=?)`;
   if(filters.batchId){where+=` AND EXISTS(SELECT 1 FROM zh_metric_facts f JOIN zh_import_rows r ON r.fact_id=f.id
     WHERE f.keyword_id=k.id AND r.batch_id=?)`;values.push(filters.batchId);}
   if(filters.search){where+=' AND k.keyword LIKE ?';values.push('%'+filters.search+'%');}
   const from=`FROM zh_keywords k JOIN plans p ON p.id=k.plan_id JOIN zh_keyword_bindings b ON b.id=k.current_binding_id
     JOIN users u ON u.id=b.executor_id LEFT JOIN zh_evidence e ON e.id=(SELECT MAX(ev.id) FROM zh_evidence ev WHERE ev.binding_id=b.id) WHERE ${where}`;
   const [count]=await select(c,`SELECT COUNT(*) total ${from}`,values);
   const list=await select(c,`SELECT CAST(b.id AS CHAR) binding_id,k.keyword,u.display_name executor_name,CAST(b.executor_id AS CHAR) executor_id,
     CAST(b.leader_id AS CHAR) leader_id,b.verification_status,CAST(e.id AS CHAR) evidence_id,e.work_url,e.description,e.status,e.reason,
     (p.status='active' AND b.stop_new_use_at IS NULL AND b.release_status<>'requested') can_submit ${from}
     ORDER BY k.id DESC LIMIT ? OFFSET ?`,[...values,filters.pageSize,(filters.page-1)*filters.pageSize]);
   return {list:list.map(row=>({...row,can_submit:!!Number(row.can_submit),can_resolve:isStaffRole(user.role)&&row.verification_status==='disputed',can_review:row.status==='pending'&&(isStaffRole(user.role)||user.role==='leader'&&String(row.leader_id)===user.sub&&String(row.executor_id)!==user.sub)})),total:Number(count.total),page:filters.page,pageSize:filters.pageSize};
 });
}
