import type {PoolConnection} from 'mysql2/promise';
import type {AuthUser} from '../../../types';
import {isStaffRole} from '../../../auth/roles';
import {assertDuty} from '../../../core/duties';
import {fail,type Scope} from './domain';
import {audit,insert,select} from './store';
import {normalizedName} from './matching';
import {lockKeywordSpace} from './resources';
import {teamLeader} from './relationships';

// Discover the original record before suggesting a different spelling. No money
// or other project's records are exposed in the operations analysis.
export async function legacyReportRecords(c:PoolConnection,scope:Scope,mappingId:string,keyword:string){
 const rows=await select(c,`SELECT p.id,p.keyword,t.id task_id,
   COALESCE((SELECT GROUP_CONCAT(DISTINCT executor.display_name ORDER BY executor.id SEPARATOR '、') FROM compositions co JOIN users executor ON executor.id=co.owner_id WHERE co.plan_id=p.id),u.display_name) owner_name,
   (SELECT GROUP_CONCAT(DISTINCT co.owner_id ORDER BY co.owner_id) FROM compositions co WHERE co.plan_id=p.id) owner_ids,
   (SELECT COUNT(*) FROM compositions co WHERE co.plan_id=p.id) work_count
   FROM plans p JOIN users u ON u.id=p.owner_id JOIN tasks t ON t.project_id=p.project_id AND t.zhihu_task_id=p.zhihu_task_id
   JOIN channels ch ON ch.project_id=p.project_id AND ch.zhihu_channel_id=p.channel_id
   JOIN zh_channel_mappings m ON m.channel_id=ch.id AND m.canonical_id IS NULL
   WHERE p.project_id=? AND m.project_id=? AND m.account_id=? AND m.id=?
   AND NOT EXISTS(SELECT 1 FROM zh_keywords k WHERE k.plan_id=p.id)`,[scope.projectId,scope.projectId,scope.accountId,mappingId]);
 return rows.filter(row=>normalizedName(String(row.keyword))===normalizedName(keyword));
}

export async function adoptLegacyReportRecord(c:PoolConnection,user:AuthUser,scope:Scope,mappingId:string,keyword:string,planId:string){
 assertDuty(user,'operations');await lockKeywordSpace(c);
 const candidates=await legacyReportRecords(c,scope,mappingId,keyword);
 if(candidates.length!==1||String(candidates[0].id)!==planId)fail('同名旧记录已变化或有多条，请重新核对',409);
 const [plan]=await select(c,'SELECT * FROM plans WHERE id=? FOR UPDATE',[planId]);
 if(plan.sync_status!=='synced'||!String(plan.zhihu_plan_id??'').trim()||plan.status==='ended')fail('原关键词尚未提交成功或已停用，请先核对原记录',409);
 const accounts=await select(c,`SELECT DISTINCT m.account_id FROM zh_channel_mappings m JOIN integration_accounts a ON a.id=m.account_id AND a.status='active'
   WHERE m.project_id=? AND m.channel_id=(SELECT channel_id FROM zh_channel_mappings WHERE id=?) AND m.canonical_id IS NULL`,[scope.projectId,mappingId]);
 if(accounts.length!==1)fail('旧记录对应多个接入来源，需先明确原渠道归属',409);
 const works=await select(c,"SELECT *,DATE_FORMAT(DATE(release_time),'%Y-%m-%d') release_day FROM compositions WHERE plan_id=? ORDER BY release_time,id FOR UPDATE",[planId]);
 if(!works.length)fail('原记录还没有作品，请核对实际执行人后登记',409);
 const owners=[...new Set(works.map(work=>String(work.owner_id)))];
 if(owners.length!==1)fail('旧作品由多个人执行，不能合并给一个人，请核对原作品',409);
 const [owner]=await select(c,'SELECT * FROM users WHERE id=? FOR SHARE',[owners[0]]);
 if(!owner||!['developer','admin','operator','leader','creator'].includes(String(owner.role)))fail('原执行人记录无效，请先核对',409);
 const staff=isStaffRole(String(owner.role)),leaderId=staff?null:owner.role==='leader'?owners[0]:await teamLeader(c,scope,owner);
 const path=staff?'staff_self':owner.role==='leader'?'leader_self':leaderId?'team_creator':'direct_creator';
 const passed=works.some(w=>w.sync_status==='synced'&&String(w.zhihu_composition_id??'').trim()&&w.status!=='ended');
 if(!works[0].release_day)fail('旧作品未登记实际发布日期，请先核对原作品日期',409);
 const id=await insert(c,`INSERT INTO zh_keywords(account_id,project_id,task_id,channel_mapping_id,plan_id,keyword,created_by,upstream_status,legacy_mode,lifecycle_status,used_ever_at)
   VALUES(?,?,?,?,?,?,?,'created','historical_registered','active',NOW(3))`,[scope.accountId,scope.projectId,candidates[0].task_id,mappingId,planId,plan.keyword,plan.created_by]);
 const bindingId=await insert(c,`INSERT INTO zh_keyword_bindings(keyword_id,path_type,leader_id,executor_id,assigned_at,used_at,activated_on,verification_status,relation_snapshot)
   VALUES(?,?,?,?,?,NOW(3),?,?,?)`,[id,path,leaderId,owners[0],works[0].release_time,works[0].release_day,passed?'passed':'pending',JSON.stringify({source:'original-record',planId,ownerId:owners[0],confirmedBy:user.sub})]);
 await c.query('UPDATE zh_keywords SET current_binding_id=? WHERE id=?',[bindingId,id]);
 // Repair the old pending flag only when a successful create receipt exists.
 await c.query("UPDATE plans SET status='active' WHERE id=? AND status='pending'",[planId]);
 if(!passed)await insert(c,'INSERT INTO zh_evidence(binding_id,work_url,description,submitted_by) VALUES(?,?,?,?)',[bindingId,works[0].promo_url,'沿用原记录中的历史作品，待核验',user.sub]);
 await audit(c,user,'keyword.adopt-original',id,{planId,bindingId,executorId:owners[0],workIds:works.map(w=>String(w.id)),verification:passed?'passed':'pending'});
 return id;
}
