import type {AuthUser} from '../../../types';
import {assertDuty} from '../../../core/duties';
import {businessDay,day,fail,type Scope} from './domain';
import {audit,bindingLock,mutate,select} from './store';
import {insertEvidence} from './statements';
import {refreshUnconfirmedKeyword} from './automatic-repair';
import {isStaffRole} from '../../../auth/roles';
import {unconfirmedFactSql} from './keyword-usability';

// This repairs the existing executor's start evidence, never assigns a new owner.
export async function recordExecutionHistory(user:AuthUser,scope:Scope,id:string,key:string,input:{bindingId:string;fromDate:string;url:string;description:string}){
 if(!isStaffRole(user.role))fail('核对历史执行需要运营权限',403);
 assertDuty(user,'operations');day(input.fromDate);
 if(input.fromDate>businessDay())fail('开始日期不能晚于今天');
 return mutate(user,scope,'binding.record-history',key,{id,...input},async c=>{
   const {word,binding}=await bindingLock(c,scope,input.bindingId);
   if(String(word.id)!==id||String(word.current_binding_id)!==input.bindingId||!binding.executor_id||binding.released_at||binding.stop_new_use_at||binding.release_status==='requested'||['archived','retired'].includes(String(word.lifecycle_status)))fail('执行记录已变化，请刷新后核对',409);
   if(binding.verification_status==='disputed'||word.legacy_mode==='shared_unresolved')fail('存在作品归属争议，需先核实原执行人',409);
   const conflicts=await select(c,'SELECT id FROM compositions WHERE plan_id=? AND owner_id<>? LIMIT 1 FOR SHARE',[word.plan_id,binding.executor_id]);
   if(conflicts.length)fail('原作品属于其他执行人，不能直接补登记',409);
   const pending=await select(c,`SELECT f.id FROM zh_metric_facts f JOIN zh_attribution_results r ON r.id=f.current_result_id
     WHERE f.keyword_id=? AND r.reason_code IN ('BINDING_MISSING','PERIOD_AMBIGUOUS') AND ${unconfirmedFactSql()} LIMIT 1 FOR UPDATE`,[id]);
   if(!pending.length)fail('这条执行记录已更新，请查看最新结果',409);
   if(binding.activated_day&&input.fromDate>String(binding.activated_day))fail('不能把已有的开始日期改晚',409);
   await c.query('UPDATE zh_keyword_bindings SET used_at=COALESCE(used_at,NOW(3)),activated_on=?,version=version+1 WHERE id=?',[input.fromDate,input.bindingId]);
   await c.query("UPDATE zh_keywords SET used_ever_at=COALESCE(used_ever_at,NOW(3)),lifecycle_status='active',legacy_mode='historical_registered',version=version+1 WHERE id=?",[id]);
   const evidence=await insertEvidence(c,user,scope,input);
   await refreshUnconfirmedKeyword(c,scope,id);
   await audit(c,user,'binding.record-history',input.bindingId,{keywordId:id,executorId:String(binding.executor_id),before:binding.activated_day,fromDate:input.fromDate,evidenceId:evidence.id});
   return {id:input.bindingId,evidenceId:evidence.id};
 });
}
