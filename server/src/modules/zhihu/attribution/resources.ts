import type { PoolConnection } from 'mysql2/promise';
import { db, withTransaction } from '../../../db';
import type { AuthUser } from '../../../types';
import { enqueue } from '../queue';
import { audit, authorize, bindingLock, insert, keywordLock, mutate, ownBinding, scopeLock, select } from './store';
import { businessDay, day, fail, keywordText, type Scope } from './domain';
import { logger } from '../../../utils/logger';

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
export async function synchronizeKeywords(scope?: Scope) {
  await db.query(
    `UPDATE zh_keywords k JOIN plans p ON p.id=k.plan_id JOIN zh_agency_spaces s ON s.id=k.agency_space_id
    SET k.upstream_status='available', k.lifecycle_status='available',
    k.upstream_confirmed_at=NOW(3), k.priority_until=TIMESTAMPADD(SECOND,s.priority_seconds,NOW(3)), k.version=k.version+1
    WHERE k.upstream_confirmed_at IS NULL AND p.sync_status='synced' AND p.status='active'
      AND (? IS NULL OR k.account_id=?) AND (? IS NULL OR k.project_id=?)
      AND NOT EXISTS(SELECT 1 FROM zh_engine_routes r WHERE r.account_id=k.account_id AND r.project_id=k.project_id AND r.mode='stopped')`,
    [scope?.accountId ?? null, scope?.accountId ?? null, scope?.projectId ?? null, scope?.projectId ?? null],
  );
}
export async function confirmUpstream(user: AuthUser, scope: Scope, id: string, key: string, reason: string) {
  if (user.role !== 'admin') fail('仅管理员可核实上游状态', 403);
  return mutate(user, scope, 'keyword.confirm-upstream', key, { id, reason }, async (c) => {
    const word = await keywordLock(c, scope, id);
    const [plan] = await select(c, 'SELECT sync_status,zhihu_plan_id,status FROM plans WHERE id=? FOR UPDATE', [
      word.plan_id,
    ]);
    if (
      plan.sync_status !== 'synced' ||
      !plan.zhihu_plan_id ||
      ['ended', 'rejected', 'paused'].includes(String(plan.status))
    )
      fail('上游尚未创建成功或计划不可用');
    if (!reason.trim()) fail('请记录上游可用的核实依据');
    if (!word.upstream_confirmed_at) {
      await c.query("UPDATE plans SET status='active' WHERE id=?", [word.plan_id]);
      await c.query(
        "UPDATE zh_keywords SET upstream_status='available',lifecycle_status='available',upstream_confirmed_at=NOW(3),priority_until=TIMESTAMPADD(SECOND,(SELECT priority_seconds FROM zh_agency_spaces WHERE id=1),NOW(3)),version=version+1 WHERE id=?",
        [id],
      );
      await audit(c, user, 'keyword.confirm-upstream', id, { reason });
    }
    return { id };
  });
}
export async function retryKeyword(user: AuthUser, scope: Scope, id: string, key: string) {
  if (user.role !== 'admin') fail('仅管理员可重试上游创建', 403);
  const result = await mutate(user, scope, 'keyword.retry-upstream', key, { id }, async (c) => {
    const word = await keywordLock(c, scope, id);
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
export async function options(user: AuthUser, scope: Scope) {
  await authorize(user, scope);
  return withTransaction(async (c) => {
    await scopeLock(c, scope, user);
    const tasks = await select(c, 'SELECT CAST(id AS CHAR) id,name FROM tasks WHERE project_id=? ORDER BY id', [
      scope.projectId,
    ]);
    const channels =
      user.role === 'admin'
        ? await select(c, 'SELECT CAST(id AS CHAR) id,name FROM channels WHERE project_id=? AND is_enabled=1', [
            scope.projectId,
          ])
        : [];
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
      AND (?='admin' OR u.parent_id=? OR u.id=?) ORDER BY u.id`,
            [scope.projectId, user.role, user.sub, user.sub],
          );
    return { tasks, channels, mappings, users };
  });
}
export async function createMapping(
  user: AuthUser,
  scope: Scope,
  key: string,
  input: { channelId: string; name: string; from: string; to?: string; canonicalId?: string },
) {
  if (user.role !== 'admin') fail('仅管理员可以维护渠道映射', 403);
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
  input: { keyword: string; taskId: string; mappingId: string; landingUrl: string; popularizeType: number },
) {
  if (user.role !== 'admin') fail('仅管理员可以创建词库关键词', 403);
  const keyword = keywordText(input.keyword);
  const result = await mutate(user, scope, 'keyword.create', key, input, async (c) => {
    await assertKeywordFree(c, keyword);
    const [task] = await select(c, 'SELECT * FROM tasks WHERE id=? AND project_id=?', [input.taskId, scope.projectId]);
    const [mapping] = await select(
      c,
      `SELECT m.*,ch.zhihu_channel_id FROM zh_channel_mappings m JOIN channels ch ON ch.id=m.channel_id
      WHERE m.id=? AND m.account_id=? AND m.project_id=? AND m.canonical_id IS NULL AND ch.is_enabled=1`,
      [input.mappingId, scope.accountId, scope.projectId],
    );
    if (!task || !mapping) fail('任务或渠道映射不属于当前范围');
    const planId = await insert(
      c,
      `INSERT INTO plans(project_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by)
      VALUES(?,?,?,?,?,?,?,?)`,
      [
        scope.projectId,
        task.zhihu_task_id,
        mapping.zhihu_channel_id,
        keyword,
        input.landingUrl,
        input.popularizeType,
        user.sub,
        user.sub,
      ],
    );
    const id = await insert(
      c,
      'INSERT INTO zh_keywords(account_id,project_id,task_id,channel_mapping_id,plan_id,keyword,created_by) VALUES(?,?,?,?,?,?,?)',
      [scope.accountId, scope.projectId, input.taskId, input.mappingId, planId, keyword, user.sub],
    );
    await audit(c, user, 'keyword.create', id, { ...scope, planId });
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
export async function listKeywords(user: AuthUser, scope: Scope, page: number, pageSize: number, search = '') {
  await authorize(user, scope);
  await synchronizeKeywords(scope);
  return withTransaction(async (c) => {
    await scopeLock(c, scope, user);
    const where = `k.account_id=? AND k.project_id=? AND k.keyword LIKE ? AND
      (?='admin' OR k.current_binding_id IS NULL OR b.leader_id=? OR b.executor_id=?)`;
    const args = [scope.accountId, scope.projectId, `%${search}%`, user.role, user.sub, user.sub];
    const [total] = await select(
      c,
      `SELECT COUNT(*) total FROM zh_keywords k LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id WHERE ${where}`,
      args,
    );
    const list = await select(
      c,
      `SELECT CAST(k.id AS CHAR) id,k.keyword,CAST(k.task_id AS CHAR) task_id,CAST(k.plan_id AS CHAR) plan_id,
      k.lifecycle_status,p.sync_status,p.status AS plan_status,${user.role === 'admin' ? 'p.sync_error' : 'NULL'} AS sync_error,
      DATE_FORMAT(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP()),k.priority_until),'%Y-%m-%dT%H:%i:%s.%fZ') priority_until,k.used_ever_at,k.version,
      CAST(b.id AS CHAR) binding_id,b.path_type,CAST(b.leader_id AS CHAR) leader_id,CAST(b.executor_id AS CHAR) executor_id,b.verification_status,b.release_status,
      (k.priority_until<=NOW(3)) AS priority_ended
      FROM zh_keywords k JOIN plans p ON p.id=k.plan_id LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id
      WHERE ${where} ORDER BY k.id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    );
    return { list, total: Number(total.total), page, pageSize };
  });
}
export async function claim(user: AuthUser, scope: Scope, id: string, key: string) {
  if (!['leader', 'creator'].includes(user.role)) fail('管理员请通过团长或达人身份领取', 403);
  await synchronizeKeywords(scope);
  return mutate(user, scope, 'keyword.claim', key, { id }, async (c) => {
    const word = await keywordLock(c, scope, id);
    if (word.current_binding_id || word.lifecycle_status !== 'available') fail('关键词不可领取或已被占用', 409);
    const [plan] = await select(c, 'SELECT status,sync_status FROM plans WHERE id=? FOR SHARE', [word.plan_id]);
    if (plan.status !== 'active' || plan.sync_status !== 'synced') fail('上游计划当前不可用', 409);
    const [actor] = await select(c, 'SELECT id,role,parent_id FROM users WHERE id=? FOR SHARE', [user.sub]);
    const [time] = await select(c, 'SELECT (priority_until<=NOW(3)) AS ended FROM zh_keywords WHERE id=?', [id]);
    if (user.role === 'creator' && (actor.parent_id !== null || Number(time.ended) !== 1))
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
    if (binding.released_at) fail('绑定已经释放', 409);
    if (input.action === 'assign') {
      if (binding.stop_new_use_at) fail('已停止新增使用，不可重新分配', 409);
      if (
        binding.used_at ||
        (user.role !== 'admin' && (user.role !== 'leader' || String(binding.leader_id) !== user.sub))
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
      if (String(binding.executor_id) !== user.sub) fail('仅执行人可以声明使用', 403);
      if (binding.used_at) return { id };
      if (binding.stop_new_use_at) fail('已停止新增使用', 409);
      const [executor] = await select(c, 'SELECT role,parent_id FROM users WHERE id=? FOR SHARE', [user.sub]);
      if (
        (binding.path_type === 'team_creator' && String(executor.parent_id) !== String(binding.leader_id)) ||
        (binding.path_type === 'direct_creator' && executor.parent_id !== null) ||
        (binding.path_type === 'leader_self' && executor.role !== 'leader')
      )
        fail('团队关系已变化，请使用新团队分配的关键词', 409);
      if (binding.release_status === 'requested') fail('释放申请中不可使用', 409);
      await c.query('UPDATE zh_keyword_bindings SET used_at=NOW(3),activated_on=?,version=version+1 WHERE id=?', [
        businessDay(),
        id,
      ]);
      await c.query(
        "UPDATE zh_keywords SET used_ever_at=NOW(3),lifecycle_status='active',version=version+1 WHERE id=?",
        [word.id],
      );
    } else if (input.action === 'stop') {
      await c.query('UPDATE zh_keyword_bindings SET stop_new_use_at=NOW(3),version=version+1 WHERE id=?', [id]);
      await c.query("UPDATE zh_keywords SET lifecycle_status='retired',version=version+1 WHERE id=?", [word.id]);
    } else {
      if (word.used_ever_at || binding.used_at) fail('已使用关键词必须保留原归属', 409);
      const sourceUse = await select(c, 'SELECT id FROM zh_metric_facts WHERE keyword_id=? LIMIT 1', [word.id]);
      if (sourceUse.length) fail('该词已有来源事实，不能证明未使用；请先核实来源异常', 409);
      if (!input.reason?.trim()) fail('请填写未使用核实依据');
      if (input.action === 'release') {
        if (user.role !== 'admin' || binding.release_status !== 'requested') fail('仅管理员可审核释放申请', 403);
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
