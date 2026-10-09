import type { AuthUser } from '../../../types';
import { assertDuty } from '../../../core/duties';
import { isStaffRole } from '../../../auth/roles';
import { businessDay, day, fail, type Scope } from './domain';
import { audit, insert, keywordLock, mutate, select } from './store';
import { teamLeader } from './relationships';
import { attribute } from './facts';
import { unconfirmedFactSql } from './keyword-usability';
import type {PoolConnection} from 'mysql2/promise';
import {resolveExecutor} from './executor';

export async function assignRetro(user:AuthUser,scope:Scope,id:string,key:string,input:{executorId:string;fromDate?:string}) {
  if(!isStaffRole(user.role))fail('指定执行人需要运营权限',403);
  assertDuty(user,'operations');
  scope={projectId:scope.projectId,accountId:scope.accountId};
  return mutate(user,scope,'binding.assign-retro',key,{id,...input},c=>assignRetroInTransaction(c,user,scope,id,input));
}
// Callers hold the account/project lock and keep registration, assignment and
// report repair in the same transaction.
export async function assignRetroInTransaction(c:PoolConnection,user:AuthUser,scope:Scope,id:string,input:{executorId:string;fromDate?:string}){
    assertDuty(user,'operations');
    if(input.fromDate){day(input.fromDate);if(input.fromDate>businessDay())fail('开始日期不能晚于今天');}
    const word=await keywordLock(c,scope,id);
    if(['archived','retired'].includes(String(word.lifecycle_status)))fail('关键词已停用，不能指定新的执行人',409);
    const bindings=await select(c,'SELECT b.*,u.display_name executor_name FROM zh_keyword_bindings b LEFT JOIN users u ON u.id=b.executor_id WHERE b.keyword_id=? FOR UPDATE',[id]);
    const live=bindings.filter(b=>!b.released_at);
    const conflict=bindings.find(b=>b.executor_id&&(String(b.executor_id)!==input.executorId||!b.released_at));
    if(conflict)fail(`这个关键词已有执行人 ${conflict.executor_name??'项目成员'}，不能改给别人`,409);
    if(live.length>1||live.some(b=>b.path_type!=='reserved'||b.used_at||b.stop_new_use_at||b.release_status==='requested'))fail('这个关键词的使用记录需要先核对，暂时不能指定执行人',409);
    const owners=await select(c,`SELECT co.owner_id,u.display_name FROM compositions co LEFT JOIN users u ON u.id=co.owner_id WHERE co.plan_id=? AND co.owner_id<>? FOR SHARE`,[word.plan_id,input.executorId]);
    if(owners.length)fail(`这个关键词已有执行人 ${owners[0].display_name??'项目成员'}，不能改给别人`,409);
    const oldOwners=await select(c,`SELECT u.display_name FROM users u WHERE u.id IN (
      SELECT dm.owner_id FROM daily_metrics dm WHERE dm.plan_id=? AND dm.owner_id<>?
      UNION SELECT e.user_id FROM earnings e WHERE e.plan_id=? AND e.user_id<>?
      UNION SELECT ev.submitted_by FROM zh_evidence ev JOIN zh_keyword_bindings eb ON eb.id=ev.binding_id WHERE eb.keyword_id=? AND ev.submitted_by<>?) FOR SHARE`,[word.plan_id,input.executorId,word.plan_id,input.executorId,id,input.executorId]);
    if(oldOwners.length)fail(`这个关键词已有执行人 ${oldOwners[0].display_name??'项目成员'}，不能改给别人`,409);
    const target=await resolveExecutor(c,user,scope,input.executorId),staff=isStaffRole(String(target.role));
    const leaderId=staff?null:target.role==='leader'?input.executorId:await teamLeader(c,scope,target);
    if(leaderId){const members=await select(c,"SELECT u.id FROM users u JOIN project_members pm ON pm.user_id=u.id WHERE u.id=? AND u.role='leader' AND u.is_active=1 AND pm.project_id=? AND pm.left_at IS NULL FOR SHARE",[leaderId,scope.projectId]);if(!members.length)fail('请先将该达人的团长加入项目');}
    const [earliest]=await select(c,`SELECT DATE_FORMAT(MIN(f.business_date),'%Y-%m-%d') earliest FROM zh_metric_facts f WHERE f.keyword_id=? AND ${unconfirmedFactSql()}`,[id]);
    const fromDate=input.fromDate??String(earliest?.earliest??businessDay());
    const path=staff?'staff_self':target.role==='leader'?'leader_self':leaderId?'team_creator':'direct_creator';
    const relation=JSON.stringify({scope,target,assignedBy:user.sub,reason:'报表补录'});
    let bindingId:string;
    if(live.length){
      bindingId=String(live[0].id);
      await c.query("UPDATE zh_keyword_bindings SET path_type=?,leader_id=?,executor_id=?,assigned_at=NOW(3),used_at=NOW(3),activated_on=?,relation_snapshot=?,version=version+1 WHERE id=?",[path,leaderId,input.executorId,fromDate,relation,bindingId]);
    }else bindingId=await insert(c,'INSERT INTO zh_keyword_bindings(keyword_id,path_type,leader_id,executor_id,assigned_at,used_at,activated_on,relation_snapshot) VALUES(?,?,?,?,NOW(3),NOW(3),?,?)',[id,path,leaderId,input.executorId,fromDate,relation]);
    await c.query("UPDATE zh_keywords SET current_binding_id=?,lifecycle_status='active',used_ever_at=COALESCE(used_ever_at,NOW(3)),version=version+1 WHERE id=?",[bindingId,id]);
    await audit(c,user,'binding.assign-retro',bindingId,{keywordId:id,executorId:input.executorId,fromDate,reason:'报表补录'});
    const facts=await select(c,`SELECT f.*,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day FROM zh_metric_facts f WHERE f.keyword_id=? AND ${unconfirmedFactSql()} ORDER BY f.id FOR UPDATE`,[id]);
    for(const fact of facts)await attribute(c,scope,fact);
    return {id:bindingId,executorId:input.executorId,executorName:String(target.display_name),fromDate,recalculated:facts.length};
}
