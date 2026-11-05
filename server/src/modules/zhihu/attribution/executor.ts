import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../../../types';
import { isStaffRole } from '../../../auth/roles';
import { assertDuty } from '../../../core/duties';
import { fail, type Scope } from './domain';
import { select } from './store';
import { resolveMemberHistory } from '../../../core/member-history';
import { AppError } from '../../../middleware/errors';

// Staff act only for themselves. Regular executors still need active membership.
export async function resolveExecutor(c: PoolConnection, user: AuthUser, scope: Scope, id: string) {
  const [target] = await select(c, `SELECT u.id,u.role,u.parent_id,u.display_name,u.admin_duty,u.is_active,
    EXISTS(SELECT 1 FROM project_members pm WHERE pm.user_id=u.id AND pm.project_id=? AND pm.left_at IS NULL) project_member
    FROM users u WHERE u.id=? FOR SHARE`, [scope.projectId,id]);
  if (!target?.is_active) fail('请选择当前项目的有效执行人',403);
  if (isStaffRole(String(target.role))) {
    if (id!==user.sub || target.role!==user.role) fail('管理员只能选择本人执行',403);
    assertDuty({...user,adminDuty:target.admin_duty as AuthUser['adminDuty']},'operations');
  } else if (!Number(target.project_member) || !['leader','creator'].includes(String(target.role))) {
    fail('请选择本项目有效的团长或达人',403);
  }
  return target;
}

export const internalPerformance = (relation: string) => relation==='activation:staff_self' || relation==='new_user:staff_self';

/** Current identity authorizes the action; only recorded history determines payees. */
export async function resolveHistoricalExecutor(c:PoolConnection,user:AuthUser,scope:Scope,id:string,at:string) {
  assertDuty(user,'operations');
  const [target]=await select(c,'SELECT id,role current_role,display_name FROM users WHERE id=? FOR SHARE',[id]);
  if(!target)fail('原执行人记录不存在，请重新核对',409);
  // This is a current-account authorization check, not a historical payee rule.
  // Deny selecting someone else's staff account before offering evidence repair.
  if(id!==user.sub&&isStaffRole(String(target.current_role)))fail('管理员只能选择本人执行',403);
  const owner=await historicalExecutorAt(c,scope,{id:String(target.id),display_name:String(target.display_name)},at);
  if(isStaffRole(owner.role)&&id!==user.sub)fail('管理员历史执行记录只能由本人核实',403);
  return owner;
}

/** Original work proves who executed it; callers cannot supply another owner or date. */
export async function resolveOriginalPlanExecutor(c:PoolConnection,user:AuthUser,scope:Scope,planId:string) {
  assertDuty(user,'operations');
  const works=await select(c,`SELECT co.owner_id id,u.display_name,
    DATE_FORMAT(co.release_time,'%Y-%m-%d %H:%i:%s') original_at
    FROM plans p JOIN compositions co ON co.plan_id=p.id JOIN users u ON u.id=co.owner_id
    WHERE p.id=? AND p.project_id=? AND p.sync_status='synced'
      AND TRIM(COALESCE(p.zhihu_plan_id,''))<>'' AND p.status<>'ended'
      AND EXISTS(SELECT 1 FROM channels ch JOIN zh_channel_mappings m ON m.channel_id=ch.id
        JOIN integration_accounts a ON a.id=m.account_id
        JOIN project_integrations pi ON pi.account_id=a.id AND pi.project_id=p.project_id
        WHERE ch.project_id=p.project_id AND ch.zhihu_channel_id=p.channel_id
          AND m.project_id=p.project_id AND m.account_id=? AND m.canonical_id IS NULL
          AND a.module_id='zhihu' AND a.status='active')
    ORDER BY co.release_time,co.id FOR SHARE`,[planId,scope.projectId,scope.accountId]);
  if(!works.length)fail('原作品不在当前项目或来源中，请重新核对原记录',409);
  if(new Set(works.map(work=>String(work.id))).size!==1)fail('旧作品由多个人执行，不能合并给一个人，请核对原作品',409);
  const original=works[0];
  if(!original.original_at)fail('旧作品未登记实际发布日期，请先核对原作品日期',409);
  return historicalExecutorAt(c,scope,{id:String(original.id),display_name:String(original.display_name)},String(original.original_at));
}

async function historicalExecutorAt(c:PoolConnection,scope:Scope,target:{id:string;display_name:string},at:string) {
  const id=target.id;
  const history=await resolveMemberHistory(c,id,scope.projectId,{at});
  const staff=history.role.status==='matched'&&isStaffRole(history.role.value);
  const needed=[history.role,...(staff?[]:[history.projectParticipation,history.team])];
  if(needed.some(f=>f.status!=='matched')||!staff&&history.projectParticipation.value!==true)
    throw new AppError(409,40900,'历史项目、角色或团长资料尚未核实。下一步：运营：补齐历史依据',
      {history,nextAction:{actor:'运营',label:'补齐历史依据',method:'POST',path:`/api/v1/core/relations/members/${id}/history-evidence`,projectId:scope.projectId,memberId:id,at}});
  const role=history.role.value!,leaderId=staff?null:role==='leader'?id:history.team.value;
  if(leaderId&&leaderId!==id){
    const leader=await resolveMemberHistory(c,leaderId,scope.projectId,{at});
    if(leader.role.status!=='matched'||leader.role.value!=='leader'||leader.projectParticipation.status!=='matched'||leader.projectParticipation.value!==true)
      throw new AppError(409,40900,'当时的团长角色或项目参与资料尚未核实。下一步：运营：补齐团长的历史依据',
        {history:leader,nextAction:{actor:'运营',label:'补齐团长历史依据',method:'POST',path:`/api/v1/core/relations/members/${leaderId}/history-evidence`,projectId:scope.projectId,memberId:leaderId,at}});
  }
  return {id:String(target.id),display_name:String(target.display_name),role,leaderId,path:staff?'staff_self':role==='leader'?'leader_self':leaderId?'team_creator':'direct_creator',history};
}
