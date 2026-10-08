import { isStaffRole } from '../../../auth/roles';
import type { PoolConnection } from 'mysql2/promise';
import { withTransaction } from '../../../db';
import type { AuthUser } from '../../../types';
import { enqueue } from '../queue';
import { audit, authorize, bindingLock, insert, keywordLock, mutate, ownBinding, scopeLock, select } from './store';
import { businessDay, day, fail, keywordText, type Scope } from './domain';
import { logger } from '../../../utils/logger';
import { ensurePoolMapping, keywordVisibility } from './plan-pool';
import { officialPlanReadCapability } from '../zhihu/planReadCapability';
import { planAccountSql } from '../services/plan-account';
import { scopeFilter } from '../../../utils/scopeFilter';
import { synchronizeKeywords } from './keyword-readiness';
import { assertKeywordReady, assertKeywordUnused, assertNoLiveBinding, readyPlanSql, unusedKeywordSql, keywordFailureMessage, ownershipConflictSql, ownershipHistorySql } from './keyword-usability';
import { dutyAllows } from '../../../core/duties';
import { unconfirmedFactSql } from './keyword-usability';
import { teamLeader } from './relationships';
import { canEditNovel, novelSchema, type NovelInput } from './novel';
import { bindingStartDay, recomputeStartDateFacts } from './activation-date';
export { synchronizeKeywords } from './keyword-readiness';

async function simulationScope(c: PoolConnection, scope: Scope) {
  const [setting] = await select(c, "SELECT JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.mode')) mode FROM zhihu_account_settings WHERE project_id=? AND account_id=?", [scope.projectId, scope.accountId]);
  return setting?.mode === 'simulation';
}
export async function lockKeywordSpace(c: PoolConnection) {
  const tables = await select(
    c,
    "SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='zh_agency_spaces'",
  );
  if (tables.length) await select(c, 'SELECT id FROM zh_agency_spaces WHERE id=1 FOR UPDATE');
  return tables.length > 0;
}
export async function assertKeywordFree(c: PoolConnection, keyword: string, exceptPlan?: string) {
  const installed = await lockKeywordSpace(c);
  const value = keywordText(keyword);
  const plans = await select(
    c,
    'SELECT id FROM plans WHERE BINARY keyword=? AND (? IS NULL OR id<>?) LIMIT 1 FOR UPDATE',
    [value, exceptPlan ?? null, exceptPlan ?? null],
  );
  if (plans.length) fail('代理词库内此关键词已存在', 409);
  if (installed) {
    const words = await select(c, 'SELECT id FROM zh_keywords WHERE agency_space_id=1 AND keyword=? LIMIT 1', [value]);
    if (words.length) fail('该词由独占词库管理，请使用词库入口', 409);
  }
}
export async function assertLegacyPlan(c: PoolConnection, id: string) {
  if (!(await lockKeywordSpace(c))) return;
  const managed = await select(c, 'SELECT id FROM zh_keywords WHERE plan_id=?', [id]);
  if (managed.length) fail('此计划由独占词库管理，请使用归因与对账入口', 409);
}
export async function confirmUpstream(user: AuthUser, scope: Scope, id: string, key: string, reason: string) {
  if (!isStaffRole(user.role)) fail('仅管理员可核实上游状态', 403);
  return mutate(user, scope, 'keyword.confirm-upstream', key, { id, reason }, async (c) => {
    const word = await keywordLock(c, scope, id);
    const [plan] = await select(c, 'SELECT sync_status,zhihu_plan_id,status FROM plans WHERE id=? FOR UPDATE', [
      word.plan_id,
    ]);
    if (
      plan.sync_status !== 'synced' ||
      !String(plan.zhihu_plan_id ?? '').trim() ||
      ['ended', 'rejected', 'paused'].includes(String(plan.status))
    )
      fail('上游尚未创建成功或计划不可用');
    if (!reason.trim()) fail('请记录上游可用的核实依据');
    if (!word.upstream_confirmed_at) {
      const [history] = await select(c, `SELECT
        EXISTS(SELECT 1 FROM zh_keyword_bindings WHERE keyword_id=?) OR
        EXISTS(SELECT 1 FROM compositions WHERE plan_id=?) OR
        EXISTS(SELECT 1 FROM zh_metric_facts WHERE keyword_id=?) OR
        EXISTS(SELECT 1 FROM daily_metrics WHERE plan_id=?) OR
        EXISTS(SELECT 1 FROM earnings WHERE plan_id=?) AS used`, [id, word.plan_id, id, word.plan_id, word.plan_id]);
      if (word.lifecycle_status !== 'pending' || word.legacy_mode !== 'new' || word.current_binding_id || word.used_ever_at || Number(history.used))
        fail('关键词已有归属或历史记录，不能重新开放领取', 409);
      await c.query("UPDATE plans SET status='active' WHERE id=?", [word.plan_id]);
      await c.query(
        "UPDATE zh_keywords SET upstream_status='available',lifecycle_status='available',upstream_confirmed_at=NOW(3),priority_until=COALESCE(priority_until,TIMESTAMPADD(MINUTE,30,created_at)),version=version+1 WHERE id=?",
        [id],
      );
      await audit(c, user, 'keyword.confirm-upstream', id, { reason });
    }
    return { id };
  });
}
export async function retryKeyword(user: AuthUser, scope: Scope, id: string, key: string) {
  if (!isStaffRole(user.role)) fail('仅管理员可重试上游创建', 403);
  const result = await mutate(user, scope, 'keyword.retry-upstream', key, { id }, async (c) => {
    const word = await keywordLock(c, scope, id);
    if (word.lifecycle_status === 'archived') fail('错误记录已删除', 409);
    const [plan] = await select(c, 'SELECT sync_status,zhihu_plan_id,sync_error FROM plans WHERE id=? FOR UPDATE', [
      word.plan_id,
    ]);
    if (word.used_ever_at || plan.zhihu_plan_id || plan.sync_status !== 'failed')
      fail('仅可重试尚未成功创建的失败计划', 409);
    if (String(plan.sync_error ?? '').includes('请更换关键词'))
      fail('请根据上游提示创建新关键词，不能重复提交此词', 409);
    await c.query("UPDATE plans SET sync_status='local',sync_error=NULL WHERE id=?", [word.plan_id]);
    await audit(c, user, 'keyword.retry-upstream', id);
    return { id, planId: String(word.plan_id) };
  });
  try {
    await enqueue(
      'push-plan',
      { ...scope, planId: result.planId },
      { jobId: `exclusive-plan-${result.planId}`, removeOnComplete: true, removeOnFail: true },
    );
  } catch (error) {
    logger.warn({ planId: result.planId, error: String(error) }, 'exclusive_plan_delivery_pending');
  }
  return result;
}

async function failedKeyword(c: PoolConnection, user: AuthUser, scope: Scope, id: string) {
  const word = await keywordLock(c, scope, id);
  const [plan] = await select(c, 'SELECT * FROM plans WHERE id=? FOR UPDATE', [word.plan_id]);
  if (!isStaffRole(user.role) && String(word.created_by) !== user.sub) {
    const [binding] = await select(c, 'SELECT * FROM zh_keyword_bindings WHERE id=? AND released_at IS NULL FOR UPDATE', [word.current_binding_id]);
    if (!binding) fail('无权处理此错误记录', 403);
    ownBinding(user, binding);
  }
  if (word.lifecycle_status === 'archived' || plan.status === 'ended' || plan.sync_status !== 'failed' || String(plan.zhihu_plan_id ?? '').trim())
    fail('仅可处理尚未在知乎创建成功的失败记录，请刷新后重试',409);
  return {word,plan};
}

export interface KeywordEditFields { taskId?: string; mappingId?: string; channelId?: string; landingUrl?: string; popularizeType?: number; novel?: NovelInput; }
async function keywordFields(c: PoolConnection, user: AuthUser, scope: Scope, word: Record<string,unknown>, plan: Record<string,unknown>, patch: KeywordEditFields) {
  const taskId=patch.taskId ?? String(word.task_id);
  const mappingId=patch.mappingId ?? (patch.channelId ? await ensurePoolMapping(c,user,scope,patch.channelId) : String(word.channel_mapping_id));
  const [task]=await select(c,'SELECT zhihu_task_id FROM tasks WHERE id=? AND project_id=?',[taskId,scope.projectId]);
  const [mapping]=await select(c,`SELECT ch.zhihu_channel_id FROM zh_channel_mappings m JOIN channels ch ON ch.id=m.channel_id
    WHERE m.id=? AND m.project_id=? AND m.account_id=? AND m.canonical_id IS NULL AND ch.is_enabled=1`,[mappingId,scope.projectId,scope.accountId]);
  if(!task||!mapping) fail('请选择当前项目中可用的任务和渠道');
  const landingUrl=patch.landingUrl ?? String(plan.landing_url);
  try { const url=new URL(landingUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error(); } catch { fail('请填写有效的推广内容链接'); }
  return {taskId,mappingId,zhihuTaskId:String(task.zhihu_task_id),channelId:String(mapping.zhihu_channel_id),landingUrl,popularizeType:patch.popularizeType??Number(plan.popularize_type)};
}
export async function editFailedKeyword(user: AuthUser, scope: Scope, id: string, key: string, value: string, patch: KeywordEditFields = {}) {
  const keyword = keywordText(value);
  const result = await mutate(user,scope,'keyword.edit-retry',key,{id,keyword,...patch},async c=>{
    await lockKeywordSpace(c);
    const {word,plan}=await failedKeyword(c,user,scope,id);
    if (word.lifecycle_status === 'retired') fail('该词已停止使用，请沿用信息新建',409);
    if (word.current_binding_id) {
      const [binding]=await select(c,'SELECT release_status FROM zh_keyword_bindings WHERE id=? FOR UPDATE',[word.current_binding_id]);
      if (binding?.release_status === 'requested') fail('释放申请中不可修改关键词',409);
    }
    await assertKeywordUnused(c,id);
    if (keyword !== word.keyword) await assertKeywordFree(c,keyword,String(word.plan_id));
    const fields=await keywordFields(c,user,scope,word,plan,patch);
    const novel = novelSchema.parse(patch.novel ?? {title:plan.novel_title ?? '',url:plan.novel_url ?? ''});
    await c.query("UPDATE plans SET keyword=?,zhihu_task_id=?,channel_id=?,landing_url=?,popularize_type=?,novel_title=?,novel_url=?,sync_status='local',sync_error=NULL WHERE id=?",[keyword,fields.zhihuTaskId,fields.channelId,fields.landingUrl,fields.popularizeType,novel.title||null,novel.url||null,word.plan_id]);
    await c.query("UPDATE zh_keywords SET keyword=?,task_id=?,channel_mapping_id=?,upstream_status='pending',version=version+1 WHERE id=?",[keyword,fields.taskId,fields.mappingId,id]);
    await audit(c,user,'keyword.edit-retry',id,{previousKeyword:word.keyword,keyword,planId:String(word.plan_id)});
    return {id,planId:String(word.plan_id)};
  });
  try { await enqueue('push-plan',{...scope,planId:result.planId},{jobId:`exclusive-plan-${result.planId}`,removeOnComplete:true,removeOnFail:true}); }
  catch(error) { logger.warn({planId:result.planId,error:String(error)},'exclusive_plan_delivery_pending'); }
  return result;
}

export async function deleteFailedKeyword(user: AuthUser, scope: Scope, id: string, key: string) {
  return mutate(user,scope,'keyword.delete-failed',key,{id},async c=>{
    const {word}=await failedKeyword(c,user,scope,id);
    // Hide the error, while retaining immutable ownership, works and financial history.
    await c.query("UPDATE plans SET status='ended' WHERE id=?",[word.plan_id]);
    await c.query("UPDATE zh_keywords SET lifecycle_status='archived',version=version+1 WHERE id=?",[id]);
    if(word.current_binding_id) await c.query('UPDATE zh_keyword_bindings SET stop_new_use_at=COALESCE(stop_new_use_at,NOW(3)),version=version+1 WHERE id=?',[word.current_binding_id]);
    await audit(c,user,'keyword.delete-failed',id,{keyword:word.keyword,planId:String(word.plan_id),preserveHistory:true});
    return {id};
  });
}

export async function copyFailedKeyword(user: AuthUser, scope: Scope, id: string, key: string, keyword: string, patch: KeywordEditFields = {}) {
  await authorize(user,scope);
  const input=await withTransaction(async c=>{
    await scopeLock(c,scope,user);
    const {word,plan}=await failedKeyword(c,user,scope,id);
    const fields=await keywordFields(c,user,scope,word,plan,patch);
    return {keyword,sourceKeywordId:id,taskId:fields.taskId,mappingId:fields.mappingId,landingUrl:fields.landingUrl,popularizeType:fields.popularizeType,novel:patch.novel??{title:String(plan.novel_title??''),url:String(plan.novel_url??'')},secondChannelId:plan.second_channel_id as string|null,name:plan.name as string|null,dailyBudget:plan.daily_budget as number|null,startDate:plan.start_date as string|null,endDate:plan.end_date as string|null};
  });
  return createKeyword(user,scope,key,input);
}
export async function options(user: AuthUser, scope: Scope) {
  await authorize(user, scope);
  return withTransaction(async (c) => {
    await scopeLock(c, scope, user);
    const tasks = await select(c, 'SELECT CAST(id AS CHAR) id,name,zhihu_task_id,unit_price,settle_type,status,start_time,end_time,synced_at FROM tasks WHERE project_id=? ORDER BY id', [
      scope.projectId,
    ]);
    const channels = await select(c, 'SELECT CAST(id AS CHAR) id,name,zhihu_channel_id,generation,synced_at FROM channels WHERE project_id=? AND is_enabled=1', [
            scope.projectId,
          ]);
    const mappings = await select(
      c,
      'SELECT CAST(id AS CHAR) id,channel_name,CAST(channel_id AS CHAR) channel_id FROM zh_channel_mappings WHERE account_id=? AND project_id=? AND canonical_id IS NULL',
      [scope.accountId, scope.projectId],
    );
    const users =
      user.role === 'creator'
        ? []
        : await select(
            c,
            `SELECT CAST(u.id AS CHAR) id,u.display_name,u.role,CAST(u.parent_id AS CHAR) parent_id FROM users u
      JOIN project_members pm ON pm.user_id=u.id WHERE pm.project_id=? AND pm.left_at IS NULL AND u.is_active=1
      AND (?=1 OR u.parent_id=? OR u.id=?) ORDER BY u.id`,
            [scope.projectId, Number(isStaffRole(user.role)), user.sub, user.sub],
          );
    const [actor] = await select(c, 'SELECT parent_id FROM users WHERE id=?', [user.sub]);
    const [parent] = actor?.parent_id ? await select(c, 'SELECT role FROM users WHERE id=?', [actor.parent_id]) : [];
    return { tasks, channels, mappings, users, hasTeamLeader: parent?.role === 'leader', integrationMode: await simulationScope(c,scope) ? 'simulation' : 'upstream' };
  });
}
export async function createMapping(
  user: AuthUser,
  scope: Scope,
  key: string,
  input: { channelId: string; name: string; from: string; to?: string; canonicalId?: string },
) {
  if (!isStaffRole(user.role)) fail('仅管理员可以维护渠道映射', 403);
  day(input.from);
  if (input.to) day(input.to);
  if (!input.name.trim() || (input.to && input.to <= input.from)) fail('渠道名称或有效区间不合法');
  return mutate(user, scope, 'channel.create', key, input, async (c) => {
    await select(c, 'SELECT id FROM integration_accounts WHERE id=? FOR UPDATE', [scope.accountId]);
    const [channel] = await select(c, 'SELECT id FROM channels WHERE id=? AND project_id=? AND is_enabled=1', [
      input.channelId,
      scope.projectId,
    ]);
    if (!channel) fail('渠道不属于当前项目');
    if (input.canonicalId) {
      const [canonical] = await select(
        c,
        'SELECT id FROM zh_channel_mappings WHERE id=? AND account_id=? AND project_id=? AND channel_id=? AND canonical_id IS NULL',
        [input.canonicalId, scope.accountId, scope.projectId, input.channelId],
      );
      if (!canonical) fail('别名必须指向同一账号、项目、渠道的主映射');
    }
    const overlap = await select(
      c,
      `SELECT id FROM zh_channel_mappings WHERE account_id=? AND channel_name=?
      AND effective_from<COALESCE(?,'9999-12-31') AND COALESCE(effective_to,'9999-12-31')>?`,
      [scope.accountId, input.name.trim(), input.to ?? null, input.from],
    );
    if (overlap.length) fail('同名渠道有效区间冲突', 409);
    const id = await insert(
      c,
      'INSERT INTO zh_channel_mappings(account_id,project_id,channel_id,canonical_id,channel_name,effective_from,effective_to,created_by) VALUES(?,?,?,?,?,?,?,?)',
      [
        scope.accountId,
        scope.projectId,
        input.channelId,
        input.canonicalId ?? null,
        input.name.trim(),
        input.from,
        input.to ?? null,
        user.sub,
      ],
    );
    await audit(c, user, 'channel.create', id, input);
    return { id };
  });
}
export async function createKeyword(
  user: AuthUser,
  scope: Scope,
  key: string,
  input: { keyword: string; taskId: string; mappingId?: string; channelId?: string; landingUrl: string; popularizeType: number; novel?: NovelInput; secondChannelId?: string | null; name?: string | null; dailyBudget?: number | null; startDate?: string | null; endDate?: string | null; sourceKeywordId?: string },
) {
  if (!isStaffRole(user.role) && !['leader', 'creator'].includes(user.role)) fail('无权创建关键词', 403);
  const keyword = keywordText(input.keyword);
  const novel = novelSchema.parse(input.novel ?? {});
  const result = await mutate(user, scope, 'keyword.create', key, input, async (c) => {
    await assertKeywordFree(c, keyword);
    const mappingId = input.mappingId ?? await ensurePoolMapping(c,user,scope,input.channelId ?? '');
    const [task] = await select(c, 'SELECT * FROM tasks WHERE id=? AND project_id=?', [input.taskId, scope.projectId]);
    const [mapping] = await select(
      c,
      `SELECT m.*,ch.zhihu_channel_id FROM zh_channel_mappings m JOIN channels ch ON ch.id=m.channel_id
      WHERE m.id=? AND m.account_id=? AND m.project_id=? AND m.canonical_id IS NULL AND ch.is_enabled=1`,
      [mappingId, scope.accountId, scope.projectId],
    );
    if (!task || !mapping) fail('任务或渠道映射不属于当前范围');
    const planId = await insert(
      c,
      `INSERT INTO plans(project_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by,second_channel_id,name,daily_budget,start_date,end_date,novel_title,novel_url)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        scope.projectId,
        task.zhihu_task_id,
        mapping.zhihu_channel_id,
        keyword,
        input.landingUrl,
        input.popularizeType,
        user.sub,
        user.sub,
        input.secondChannelId ?? null, input.name ?? null, input.dailyBudget ?? null, input.startDate ?? null, input.endDate ?? null,
        novel.title || null, novel.url || null,
      ],
    );
    const id = await insert(
      c,
      'INSERT INTO zh_keywords(account_id,project_id,task_id,channel_mapping_id,plan_id,keyword,created_by,priority_until) VALUES(?,?,?,?,?,?,?,TIMESTAMPADD(MINUTE,30,NOW(3)))',
      [scope.accountId, scope.projectId, input.taskId, mappingId, planId, keyword, user.sub],
    );
    let bindingId: string | null = null;
    if (!isStaffRole(user.role)) {
      const [actor] = await select(c, 'SELECT id,role,parent_id FROM users WHERE id=? FOR SHARE', [user.sub]);
      const reserved = user.role === 'leader';
      const leaderId = reserved ? user.sub : await teamLeader(c, scope, actor);
      bindingId = await insert(c,
        'INSERT INTO zh_keyword_bindings(keyword_id,path_type,leader_id,executor_id,relation_snapshot,assigned_at) VALUES(?,?,?,?,?,?)',
        [id, reserved ? 'reserved' : leaderId ? 'team_creator' : 'direct_creator', leaderId, reserved ? null : user.sub,
          JSON.stringify({ ...scope, actor, leaderId, source: 'self_create' }), reserved ? null : new Date()]);
      await c.query('UPDATE zh_keywords SET current_binding_id=?,lifecycle_status=?,version=version+1 WHERE id=?',
        [bindingId, reserved ? 'reserved' : 'assigned', id]);
    }
    await audit(c, user, 'keyword.create', id, { ...scope, planId, bindingId, sourceKeywordId: input.sourceKeywordId });
    return { id, planId };
  });
  // 计划已经持久化；投递失败仍可按 planId 重试，不重复创建资源。
  try {
    await enqueue(
      'push-plan',
      { ...scope, planId: result.planId },
      { jobId: `exclusive-plan-${result.planId}`, removeOnComplete: true, removeOnFail: true },
    );
  } catch (error) {
    logger.warn({ planId: result.planId, error: String(error) }, 'exclusive_plan_delivery_pending');
  }
  return result;
}
export async function updateKeywordNovel(user: AuthUser, scope: Scope, id: string, key: string, input: NovelInput) {
  const novel = novelSchema.parse(input);
  return mutate(user, scope, 'keyword.novel', key, {id,novel}, async c => {
    const historical = id.startsWith('plan:');
    const [record] = await select(c, `SELECT p.id,p.owner_id,COALESCE(k.created_by,p.created_by) created_by,
      k.id keyword_id,k.lifecycle_status,b.id binding_id,b.leader_id,b.executor_id,b.released_at
      FROM plans p LEFT JOIN zh_keywords k ON k.plan_id=p.id LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id
      WHERE p.project_id=? AND ${planAccountSql()}=? AND ${historical?'p.id=? AND k.id IS NULL':'k.id=?'} FOR UPDATE`,
      [scope.projectId,scope.accountId,historical?id.slice(5):id]);
    if (!record) fail('关键词不存在',404);
    if (!canEditNovel(user,record)) fail('只能编辑本人或所管理团队的小说资料',403);
    await c.query('UPDATE plans SET novel_title=?,novel_url=? WHERE id=?',[novel.title||null,novel.url||null,record.id]);
    await audit(c,user,'keyword.novel',id,{planId:String(record.id),...novel});
    return {id};
  });
}
export async function listKeywords(user: AuthUser, scope: Scope, page: number, pageSize: number, search = '', view: 'all' | 'available' | 'ongoing' | 'registered' | 'retired' = 'all') {
  await authorize(user, scope);
  await synchronizeKeywords(scope);
  return withTransaction(async (c) => {
    await scopeLock(c, scope, user);
    const visibility = keywordVisibility(user);
    const workScope = scopeFilter(user, 'cw.owner_id');
    const planScope = scopeFilter(user, 'p.owner_id');
    const compositionCount = `(SELECT COUNT(*) FROM compositions cw WHERE cw.plan_id=p.id AND ${workScope.clause})`;
    const readiness = readyPlanSql();
    const unused = unusedKeywordSql();
    const noLiveBinding = 'NOT EXISTS(SELECT 1 FROM zh_keyword_bindings lb WHERE lb.keyword_id=k.id AND lb.released_at IS NULL)';
    const running = `NOT EXISTS(SELECT 1 FROM zh_engine_routes er WHERE er.account_id=k.account_id AND er.project_id=k.project_id AND er.mode='stopped')`;
    const allocation = `(k.id IS NOT NULL AND k.current_binding_id IS NULL AND k.lifecycle_status='available' AND ${readiness} AND ${unused} AND ${noLiveBinding} AND ${running})`;
    const claimAccess = user.role === 'creator' ? `AND k.priority_until<=NOW(3) AND NOT EXISTS(SELECT 1 FROM users cu JOIN users parent ON parent.id=cu.parent_id AND parent.role='leader' WHERE cu.id=? )` : '';
    const filter = view === 'available' ? `${allocation} ${claimAccess}`
      : view === 'ongoing' ? `k.lifecycle_status IN ('reserved','assigned','active') AND b.released_at IS NULL AND b.stop_new_use_at IS NULL AND b.release_status<>'requested' AND ${readiness} AND NOT ${ownershipConflictSql()}`
      : view === 'registered' ? `${compositionCount}>0`
      : view === 'retired' ? `k.lifecycle_status='retired'` : '1=1';
    const filterArgs = view === 'registered' ? workScope.bindings : view === 'available' && user.role === 'creator' ? [user.sub] : [];
    const args = [scope.projectId, scope.accountId, `%${search}%`, `%${search}%`, ...visibility.bindings, ...planScope.bindings, ...workScope.bindings, ...filterArgs];
    const where = `p.project_id=? AND ${planAccountSql()}=? AND (p.keyword LIKE ? OR p.novel_title LIKE ?)
      AND (k.id IS NULL OR (k.project_id=p.project_id AND k.lifecycle_status<>'archived'))
      AND ((k.id IS NOT NULL AND ${visibility.clause}) OR (k.id IS NULL AND ${planScope.clause}) OR ${compositionCount}>0) AND (${filter})`;
    const from = `FROM plans p LEFT JOIN zh_keywords k ON k.plan_id=p.id
      LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id`;
    const [total] = await select(c,
      `SELECT COUNT(*) total,
        COALESCE(SUM(p.sync_status='local'),0) pending,
        COALESCE(SUM(p.sync_status='syncing'),0) submitting,
        COALESCE(SUM(p.sync_status='synced' AND NULLIF(TRIM(p.zhihu_plan_id),'') IS NOT NULL),0) created,
        COALESCE(SUM(p.sync_status='failed'),0) failed,
        COALESCE(SUM(p.sync_status='simulated'),0) simulated
       ${from} WHERE ${where}`,
      args,
    );
    const list = await select(
      c,
      `SELECT COALESCE(CAST(k.id AS CHAR),CONCAT('plan:',p.id)) id,p.keyword,
      CAST(k.task_id AS CHAR) task_id,CAST(p.id AS CHAR) plan_id,CAST(k.channel_mapping_id AS CHAR) mapping_id,p.landing_url,p.popularize_type,
      p.novel_title,COALESCE(NULLIF(p.novel_url,''),p.landing_url) novel_url,p.novel_url novel_url_override,CAST(k.id AS CHAR) keyword_id,CAST(p.owner_id AS CHAR) owner_id,
      (SELECT MAX(t.name) FROM tasks t WHERE t.project_id=p.project_id AND t.zhihu_task_id=p.zhihu_task_id) task_name,
      COALESCE(k.lifecycle_status,'historical') lifecycle_status,k.upstream_status,p.sync_status,p.status AS plan_status,
      (NULLIF(TRIM(p.zhihu_plan_id),'') IS NOT NULL) has_upstream_plan,p.sync_error AS sync_error,
      ${readiness} AS upstream_ready, NOT ${unused} AS has_usage_history,
      ${ownershipHistorySql()} AS has_ownership_history,
      (SELECT DATE_FORMAT(MIN(f.business_date),'%Y-%m-%d') FROM zh_metric_facts f WHERE f.keyword_id=k.id AND ${unconfirmedFactSql()}) retro_from_date,
      ${ownershipConflictSql()} AS ownership_conflict,
      ${allocation} AS allocation_ready,b.stop_new_use_at,b.released_at,
      (k.id IS NULL OR NOT (${visibility.clause})) read_only,
      ${compositionCount} composition_count,
      (SELECT u.display_name FROM users u WHERE u.id=p.owner_id) owner_name,
      DATE_FORMAT(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP()),k.priority_until),'%Y-%m-%dT%H:%i:%s.%fZ') priority_until,k.used_ever_at,k.version,
      CAST(b.id AS CHAR) binding_id,b.path_type,CAST(b.leader_id AS CHAR) leader_id,CAST(b.executor_id AS CHAR) executor_id,b.verification_status,b.release_status,
      CAST(COALESCE(k.created_by,p.created_by) AS CHAR) created_by,
      (k.priority_until<=NOW(3)) AS priority_ended
      ${from}
      WHERE ${where} ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`,
      [...visibility.bindings, ...workScope.bindings, ...args, pageSize, (page - 1) * pageSize],
    );
    const summary = {
      pending: Number(total.pending), submitting: Number(total.submitting),
      created: Number(total.created), failed: Number(total.failed), simulated: Number(total.simulated),
      unknown: 0,
    };
    summary.unknown = Number(total.total) - Object.values(summary).reduce((sum, count) => sum + count, 0);
    const simulated = await simulationScope(c, scope);
    const stopped = await select(c, "SELECT id FROM zh_engine_routes WHERE account_id=? AND project_id=? AND mode='stopped'", [scope.accountId, scope.projectId]);
    for (const word of list) {
      // MySQL returns BIGINT expressions as strings. Expose numeric flags so
      // clients do not interpret a false value ("0") as a conflict or prior use.
      for (const flag of ['ownership_conflict','has_usage_history','upstream_ready','has_upstream_plan','priority_ended']) {
        word[flag] = Number(word[flag]);
      }
      // Historical use without a current binding is not a public-pool word.
      if (!word.binding_id && Number(word.has_ownership_history)) { word.lifecycle_status = 'historical'; word.read_only = 1; }
      word.can_assign_retro=Number(dutyAllows(user,'operations')&&word.keyword_id&&!Number(word.has_ownership_history)&&!word.executor_id&&!Number(word.read_only)&&!stopped.length&&!word.released_at&&!word.stop_new_use_at&&word.release_status!=='requested'&&!['archived','retired'].includes(String(word.lifecycle_status)));
      word.read_only = Number(word.read_only);
      word.can_edit_novel = Number(canEditNovel(user, word));
      word.composition_count = Number(word.composition_count);
      const canFix = !String(word.id).startsWith('plan:') && word.sync_status === 'failed' && !Number(word.has_upstream_plan) && word.plan_status !== 'ended' && (isStaffRole(user.role) || String(word.created_by) === user.sub || String(word.leader_id) === user.sub || String(word.executor_id) === user.sub);
      word.can_delete_failed = Number(canFix);
      word.can_edit_failed = Number(canFix && !Number(word.has_usage_history) && word.lifecycle_status !== 'retired' && word.release_status !== 'requested');
      word.can_copy_failed = Number(canFix && (Number(word.has_usage_history) === 1 || word.lifecycle_status === 'retired'));
      word.sync_error = word.sync_status === 'failed' ? keywordFailureMessage(word.sync_error) : null;
      if (Number(word.ownership_conflict) && word.sync_status !== 'failed') word.sync_error = '关键词历史作品归属与当前使用人不一致，请联系管理员核对，暂不可新增使用';
      word.usage_ready = Number(!Number(word.ownership_conflict) && !stopped.length && !word.read_only && Number(word.upstream_ready) === 1 && !!word.binding_id && !word.released_at && !word.stop_new_use_at && word.release_status !== 'requested' && ['reserved','assigned','active'].includes(String(word.lifecycle_status)));
      word.allocation_ready = Number(Number(word.allocation_ready) === 1 && !stopped.length && !word.read_only && !word.binding_id && word.lifecycle_status === 'available' && word.plan_status === 'active'
        && (word.sync_status === 'synced' && Number(word.has_upstream_plan) === 1
          || word.sync_status === 'simulated' && word.upstream_status === 'simulated' && simulated));
    }
    return {
      list,
      total: Number(total.total), page, pageSize, summary,
      source: 'local', officialTotal: null, officialRead: officialPlanReadCapability,
      readAt: new Date().toISOString(),
    };
  });
}
export async function claim(user: AuthUser, scope: Scope, id: string, key: string) {
  if (!['leader', 'creator'].includes(user.role)) fail('管理员请通过团长或达人身份领取', 403);
  await authorize(user, scope);
  await synchronizeKeywords(scope);
  return mutate(user, scope, 'keyword.claim', key, { id }, async (c) => {
    const word = await keywordLock(c, scope, id);
    if (word.current_binding_id || word.lifecycle_status !== 'available') fail('关键词不可领取或已被占用', 409);
    await assertKeywordReady(c, id);
    await assertKeywordUnused(c, id);
    await assertNoLiveBinding(c, id);
    const [actor] = await select(c, 'SELECT id,role,parent_id,is_active FROM users WHERE id=? FOR SHARE', [user.sub]);
    if (!actor?.is_active || actor.role !== user.role) fail('账号权限已变化，请重新登录', 403);
    const [time] = await select(c, 'SELECT (priority_until<=NOW(3)) AS ended FROM zh_keywords WHERE id=?', [id]);
    if (user.role === 'creator' && ((await teamLeader(c, scope, actor)) !== null || Number(time.ended) !== 1))
      fail('仅优先期结束后的直属达人可领取', 403);
    const leader = user.role === 'leader';
    const bindingId = await insert(
      c,
      'INSERT INTO zh_keyword_bindings(keyword_id,path_type,leader_id,executor_id,relation_snapshot,assigned_at) VALUES(?,?,?,?,?,?)',
      [
        id,
        leader ? 'reserved' : 'direct_creator',
        leader ? user.sub : null,
        leader ? null : user.sub,
        JSON.stringify({ ...scope, actor }),
        leader ? null : new Date(),
      ],
    );
    await c.query('UPDATE zh_keywords SET current_binding_id=?,lifecycle_status=?,version=version+1 WHERE id=?', [
      bindingId,
      leader ? 'reserved' : 'assigned',
      id,
    ]);
    await audit(c, user, 'keyword.claim', id, { bindingId });
    return { id: bindingId };
  });
}
export async function changeBinding(
  user: AuthUser,
  scope: Scope,
  id: string,
  key: string,
  input: {
    action: 'assign' | 'activate' | 'request-release' | 'release' | 'stop';
    executorId?: string;
    reason?: string;
  },
) {
  return mutate(user, scope, `binding.${input.action}`, key, { id, ...input }, async (c) => {
    const { word, binding } = await bindingLock(c, scope, id);
    ownBinding(user, binding);
    if (String(word.current_binding_id) !== String(binding.id)) fail('绑定已失效，请刷新后重试', 409);
    if (binding.released_at) fail('绑定已经释放', 409);
    if (input.action === 'assign') {
      await assertKeywordReady(c, String(word.id));
      await assertKeywordUnused(c, String(word.id));
      if (binding.release_status === 'requested') fail('释放申请中不可分配', 409);
      if (binding.stop_new_use_at) fail('已停止新增使用，不可重新分配', 409);
      if (
        binding.used_at ||
        (!isStaffRole(user.role) && (user.role !== 'leader' || String(binding.leader_id) !== user.sub))
      )
        fail('无权重新分配此绑定', 403);
      if (!binding.leader_id) fail('直属达人绑定不可由团长分配');
      const [target] = await select(c, 'SELECT id,role,parent_id,is_active FROM users WHERE id=? FOR SHARE', [
        input.executorId,
      ]);
      const members = await select(
        c,
        'SELECT user_id FROM project_members WHERE project_id=? AND user_id=? AND left_at IS NULL FOR SHARE',
        [scope.projectId, input.executorId],
      );
      const self = input.executorId === String(binding.leader_id);
      if (
        !target ||
        !target.is_active ||
        !members.length ||
        (self
          ? target.role !== 'leader'
          : target.role !== 'creator' || String(target.parent_id) !== String(binding.leader_id))
      )
        fail('执行人必须是本团长或有效团队达人及项目成员', 403);
      await c.query(
        'UPDATE zh_keyword_bindings SET path_type=?,executor_id=?,assigned_at=NOW(3),relation_snapshot=?,version=version+1 WHERE id=?',
        [
          self ? 'leader_self' : 'team_creator',
          input.executorId,
          JSON.stringify({ ...scope, leaderId: String(binding.leader_id), target }),
          id,
        ],
      );
      await c.query("UPDATE zh_keywords SET lifecycle_status='assigned',version=version+1 WHERE id=?", [word.id]);
    } else if (input.action === 'activate') {
      await assertKeywordReady(c, String(word.id));
      if (String(binding.executor_id) !== user.sub) fail('仅执行人可以声明使用', 403);
      if (binding.used_at) return { id };
      if (binding.stop_new_use_at) fail('已停止新增使用', 409);
      const [executor] = await select(c, 'SELECT role,parent_id FROM users WHERE id=? FOR SHARE', [user.sub]);
      if (
        (binding.path_type === 'team_creator' && String(executor.parent_id) !== String(binding.leader_id)) ||
        (binding.path_type === 'direct_creator' && (await teamLeader(c, scope, executor)) !== null) ||
        (binding.path_type === 'leader_self' && executor.role !== 'leader')
      )
        fail('团队关系已变化，请使用新团队分配的关键词', 409);
      if (binding.release_status === 'requested') fail('释放申请中不可使用', 409);
      await c.query('UPDATE zh_keyword_bindings SET used_at=NOW(3),activated_on=?,version=version+1 WHERE id=?', [
        await bindingStartDay(c,id),
        id,
      ]);
      await c.query(
        "UPDATE zh_keywords SET used_ever_at=NOW(3),lifecycle_status='active',version=version+1 WHERE id=?",
        [word.id],
      );
      await recomputeStartDateFacts(c,scope,String(word.id));
    } else if (input.action === 'stop') {
      await c.query('UPDATE zh_keyword_bindings SET stop_new_use_at=NOW(3),version=version+1 WHERE id=?', [id]);
      await c.query("UPDATE zh_keywords SET lifecycle_status='retired',version=version+1 WHERE id=?", [word.id]);
    } else {
      if (word.used_ever_at || binding.used_at) fail('已使用关键词必须保留原归属', 409);
      await assertKeywordUnused(c, String(word.id));
      if (!input.reason?.trim()) fail('请填写未使用核实依据');
      if (input.action === 'release') {
        if (!isStaffRole(user.role) || binding.release_status !== 'requested') fail('仅管理员可审核释放申请', 403);
        await c.query(
          "UPDATE zh_keyword_bindings SET released_at=NOW(3),release_status='approved',release_reason=?,version=version+1 WHERE id=?",
          [input.reason, id],
        );
        await c.query(
          "UPDATE zh_keywords SET current_binding_id=NULL,lifecycle_status='available',version=version+1 WHERE id=?",
          [word.id],
        );
      } else
        await c.query(
          "UPDATE zh_keyword_bindings SET release_status='requested',release_reason=?,version=version+1 WHERE id=?",
          [input.reason, id],
        );
    }
    await audit(c, user, `binding.${input.action}`, id, input);
    return { id };
  });
}

export async function distribute(user:AuthUser,scope:Scope,id:string,key:string,targetId:string){
 if(!isStaffRole(user.role))fail('只有运营人员可以直接分发关键词',403);
 await authorize(user,scope);
 await synchronizeKeywords(scope);
 return mutate(user,scope,'keyword.distribute',key,{id,targetId},async c=>{
  const word=await keywordLock(c,scope,id);
  if(word.current_binding_id||word.lifecycle_status!=='available')fail('关键词已分配或尚不可用',409);
  await assertKeywordReady(c,id);
  await assertKeywordUnused(c,id);
  await assertNoLiveBinding(c,id);
  const [target]=await select(c,'SELECT u.id,u.role,u.parent_id FROM users u JOIN project_members pm ON pm.user_id=u.id WHERE u.id=? AND u.is_active=1 AND pm.project_id=? AND pm.left_at IS NULL FOR SHARE',[targetId,scope.projectId]);
  if(!target||!['leader','creator'].includes(String(target.role)))fail('请选择有效的团长或达人');
  const leader=target.role==='leader'?targetId:await teamLeader(c,scope,target);
  if(leader&&target.role==='creator'){
   const parents=await select(c,"SELECT u.id FROM users u JOIN project_members pm ON pm.user_id=u.id WHERE u.id=? AND u.role='leader' AND u.is_active=1 AND pm.project_id=? AND pm.left_at IS NULL FOR SHARE",[leader,scope.projectId]);
   if(!parents.length)fail('请先将该达人的团长加入项目');
  }
  const reserved=target.role==='leader';
  const bindingId=await insert(c,'INSERT INTO zh_keyword_bindings(keyword_id,path_type,leader_id,executor_id,relation_snapshot,assigned_at) VALUES(?,?,?,?,?,?)',[id,reserved?'reserved':leader?'team_creator':'direct_creator',leader,reserved?null:targetId,JSON.stringify({scope,target,assignedBy:user.sub}),reserved?null:new Date()]);
  await c.query('UPDATE zh_keywords SET current_binding_id=?,lifecycle_status=?,version=version+1 WHERE id=?',[bindingId,reserved?'reserved':'assigned',id]);
  await audit(c,user,'keyword.distribute',id,{targetId,bindingId});return{id:bindingId};
 });
}
