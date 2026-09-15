import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../../../types';
import { audit, insert, scopeLock, select } from './store';
import { fail } from './domain';
import { assertEngineWritable } from './routing';

export function keywordVisibility(user: AuthUser) {
  if (user.role === 'admin') return { clause: '1=1', bindings: [] as string[] };
  if (user.role === 'leader') return {
    clause: "(b.leader_id=? OR b.executor_id=? OR (k.current_binding_id IS NULL AND k.lifecycle_status<>'retired'))",
    bindings: [user.sub, user.sub],
  };
  return {
    clause: "(b.executor_id=? OR (k.current_binding_id IS NULL AND k.lifecycle_status<>'retired' AND k.priority_until<=NOW(3) AND EXISTS(SELECT 1 FROM users viewer WHERE viewer.id=? AND viewer.parent_id IS NULL)))",
    bindings: [user.sub, user.sub],
  };
}

// Legacy forms send upstream IDs. Resolve the real scope, never the global default.
export async function resolvePlanPool(c: PoolConnection, taskId: string, channelId: string) {
  const catalog = await select(c,
    'SELECT t.id task_id,ch.id channel_id,ch.project_id FROM channels ch JOIN tasks t ON t.project_id=ch.project_id JOIN projects pr ON pr.id=ch.project_id WHERE ch.zhihu_channel_id=? AND t.zhihu_task_id=? AND ch.is_enabled=1 AND pr.is_enabled=1',
    [channelId, taskId]);
  if (catalog.length !== 1) fail('任务和渠道必须属于同一个明确的业务项目，请在关键词库中选择项目后创建');
  const item = catalog[0];
  const accounts = await select(c,
    "SELECT a.id,EXISTS(SELECT 1 FROM zh_channel_mappings m WHERE m.account_id=a.id AND m.project_id=? AND m.channel_id=? AND m.canonical_id IS NULL) mapped FROM integration_accounts a JOIN project_integrations pi ON pi.account_id=a.id WHERE pi.project_id=? AND a.module_id='zhihu' AND a.status='active'",
    [item.project_id, item.channel_id, item.project_id]);
  const mapped = accounts.filter(a => Number(a.mapped) === 1);
  const candidates = mapped.length ? mapped : accounts;
  if (candidates.length !== 1) fail('这个项目的接入账号尚未明确，请在关键词库中选择接入账号和渠道后创建');
  return { projectId: String(item.project_id), accountId: String(candidates[0].id), taskId: String(item.task_id), channelId: String(item.channel_id) };
}

export async function ensurePoolMapping(c: PoolConnection, user: AuthUser, scope: {projectId:string;accountId:string}, channelId: string) {
  const mappings = await select(c,
    'SELECT id FROM zh_channel_mappings WHERE account_id=? AND project_id=? AND channel_id=? AND canonical_id IS NULL AND effective_from<=CURDATE() AND (effective_to IS NULL OR effective_to>CURDATE())',
    [scope.accountId, scope.projectId, channelId]);
  if (mappings.length > 1) fail('这个渠道有多个报表名称，请在关键词库中选择具体名称');
  if (mappings.length) return String(mappings[0].id);
  const [channel] = await select(c, 'SELECT name FROM channels WHERE id=? AND project_id=? AND is_enabled=1', [channelId, scope.projectId]);
  if (!channel) fail('渠道不属于当前项目');
  const overlaps = await select(c, "SELECT id FROM zh_channel_mappings WHERE account_id=? AND channel_name=? AND (effective_to IS NULL OR effective_to>CURDATE())", [scope.accountId, channel.name]);
  if (overlaps.length) fail('报表渠道名称已有对应关系，请在渠道与任务中核对');
  const id = await insert(c, 'INSERT INTO zh_channel_mappings(account_id,project_id,channel_id,channel_name,effective_from,created_by) VALUES(?,?,?,?,CURDATE(),?)',
    [scope.accountId,scope.projectId,channelId,channel.name,user.sub]);
  await audit(c,user,'channel.create',id,{source:'plan.create',channelId});
  return id;
}

// Explicit repair only: never turn used historical plans into unclaimed resources.
export async function registerUnusedAdminPlan(c: PoolConnection, user: AuthUser, planId: string) {
  if(user.role!=='admin') fail('仅管理员可以修复关键词库',403);
  const [plan] = await select(c,"SELECT p.* FROM plans p JOIN users u ON u.id=p.created_by WHERE p.id=? AND u.role='admin' AND p.owner_id=p.created_by AND p.status<>'ended' FOR UPDATE",[planId]);
  if(!plan) fail('只能接入管理员创建且尚未分配的计划');
  const existing=await select(c,'SELECT id FROM zh_keywords WHERE plan_id=?',[planId]);
  if(existing.length)return {id:String(existing[0].id)};
  for(const table of ['daily_metrics','earnings','compositions']){
    const history=await select(c,'SELECT id FROM '+table+' WHERE plan_id=? LIMIT 1',[planId]);
    if(history.length)fail('此计划已有历史业务数据，需要保留原归属');
  }
  const scope=await resolvePlanPool(c,String(plan.zhihu_task_id),String(plan.channel_id));
  await scopeLock(c,scope,user);
  await assertEngineWritable(c,scope);
  await select(c,'SELECT id FROM zh_agency_spaces WHERE id=1 FOR UPDATE');
  const conflicts=await select(c,'SELECT id FROM plans WHERE BINARY keyword=? AND id<>?',[plan.keyword,planId]);
  if(conflicts.length)fail('历史关键词存在重名，需要人工核对');
  const mappingId=await ensurePoolMapping(c,user,scope,scope.channelId);
  await c.query('UPDATE plans SET project_id=? WHERE id=?',[scope.projectId,planId]);
  const id=await insert(c,'INSERT INTO zh_keywords(account_id,project_id,task_id,channel_mapping_id,plan_id,keyword,created_by,created_at,priority_until) SELECT ?,?,?,?,?,keyword,created_by,created_at,TIMESTAMPADD(MINUTE,30,created_at) FROM plans WHERE id=?',
    [scope.accountId,scope.projectId,scope.taskId,mappingId,planId,planId]);
  await audit(c,user,'keyword.register-plan',id,{planId,previousProjectId:String(plan.project_id),...scope});
  return {id,...scope};
}
