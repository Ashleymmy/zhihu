import type { AuthUser } from '../../../types';
import type { KeywordBindingFilter, KeywordBindingRow } from '../../../core/contracts';
import { canViewWorkStatistics } from '../../../auth/roles';
import { userIdMap } from '../../../auth/user-id';
import { withTransaction } from '../../../db';
import { AppError } from '../../../middleware/errors';
import { planAccountSql } from '../services/plan-account';
import { keywordFailureMessage } from './keyword-usability';
import { authorize, select } from './store';
import type { Scope } from './domain';

// A row describes one retained assignment, including released assignments. Never use the
// user's current parent_id to reconstruct a historical team. Unassigned failed creations
// use their creation date, explicitly marked, so they remain available for reconciliation.
export async function keywordBindings(
  scope: Scope,
  user: AuthUser,
  filter: KeywordBindingFilter,
): Promise<KeywordBindingRow[]> {
  if (!canViewWorkStatistics(user.role)) throw new AppError(403, 40300, '仅管理员和开发者可导出关键词记录');
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const date = 'COALESCE(b.assigned_at,b.claimed_at,p.created_at)';
    const where = [
      'p.project_id=?',
      `${planAccountSql()}=?`,
      "(b.id IS NOT NULL OR p.sync_status='failed' OR p.status='rejected')",
    ];
    const args: unknown[] = [scope.projectId, scope.accountId];
    if (filter.from) {
      where.push(`${date}>=?`);
      args.push(filter.from);
    }
    if (filter.to) {
      where.push(`${date}<DATE_ADD(?,INTERVAL 1 DAY)`);
      args.push(filter.to);
    }
    if (filter.search) {
      where.push("(LOCATE(?,p.keyword)>0 OR LOCATE(?,COALESCE(p.novel_title,''))>0)");
      args.push(filter.search, filter.search);
    }
    const rows = await select(
      c,
      `SELECT CAST(p.id AS CHAR) id,CAST(b.id AS CHAR) binding_id,
      DATE_FORMAT(COALESCE(b.assigned_at,b.claimed_at),'%Y-%m-%d %H:%i:%s') bound_at,
      DATE_FORMAT(p.created_at,'%Y-%m-%d %H:%i:%s') created_at,
      p.keyword,p.novel_title,COALESCE(NULLIF(p.novel_url,''),p.landing_url) novel_url,
      p.sync_status,p.status,p.sync_error,b.released_at,b.executor_id,b.leader_id,
      (SELECT MAX(t.name) FROM tasks t WHERE t.project_id=p.project_id AND t.zhihu_task_id=p.zhihu_task_id) task_name,
      COALESCE(cm.channel_name,(SELECT MAX(ch.name) FROM channels ch WHERE ch.project_id=p.project_id AND ch.zhihu_channel_id=p.channel_id),CAST(p.channel_id AS CHAR)) channel_name,
      CAST(creator.id AS CHAR) creator_id,creator.username creator_account,creator.display_name creator_name,
      (SELECT cl.display_name FROM zh_keyword_bindings cb JOIN users cl ON cl.id=cb.leader_id
        WHERE cb.keyword_id=k.id AND cb.executor_id=creator.id AND cb.leader_id<>cb.executor_id
        ORDER BY cb.claimed_at,cb.id LIMIT 1) creator_leader_name,
      CAST(performer.id AS CHAR) performer_id,performer.username performer_account,performer.display_name performer_name,
      leader.username leader_account,leader.display_name leader_name
      FROM plans p LEFT JOIN zh_keywords k ON k.plan_id=p.id
      LEFT JOIN zh_keyword_bindings b ON b.keyword_id=k.id
      LEFT JOIN zh_channel_mappings cm ON cm.id=k.channel_mapping_id
      LEFT JOIN users creator ON creator.id=COALESCE(k.created_by,p.created_by)
      LEFT JOIN users performer ON performer.id=b.executor_id
      LEFT JOIN users leader ON leader.id=b.leader_id
      WHERE ${where.join(' AND ')} ORDER BY ${date} DESC,p.id DESC,b.id DESC LIMIT 30001`,
      args,
    );
    if (rows.length > 30000) throw new AppError(422, 42200, '符合条件的记录超过 30000 条，请缩小日期范围后导出');
    const text = (v: unknown) => (v == null ? '' : String(v));
    const publicIds = await userIdMap(c, rows.flatMap(r => [r.creator_id,r.performer_id,r.leader_id]));
    const uid = (v: unknown) => (v == null ? '' : publicIds.get(String(v)) ?? '');
    return rows.map((r) => ({
      id: text(r.id),
      bindingId: text(r.binding_id),
      boundAt: text(r.bound_at),
      createdAt: text(r.created_at),
      dateBasis: r.binding_id ? (r.executor_id ? '分配／领取日期' : '团长领取日期') : '未分配，按创建日期收录失败记录',
      taskName: text(r.task_name),
      channelName: text(r.channel_name),
      keyword: text(r.keyword),
      novelTitle: text(r.novel_title),
      novelUrl: text(r.novel_url),
      creatorAccount: text(r.creator_account),
      creatorName: text(r.creator_name),
      creatorId: uid(r.creator_id),
      creatorLeaderName: text(r.creator_leader_name),
      performerAccount: text(r.performer_account),
      performerName: text(r.performer_name),
      performerId: uid(r.performer_id),
      leaderName: text(r.leader_name),
      leaderAccount: text(r.leader_account),
      leaderId: uid(r.leader_id),
      relationNote: !r.binding_id
        ? '无领取／分配记录'
        : r.leader_id
          ? '团长来自该条领取／分配记录；创建人团长来自其最早的使用记录'
          : '该条记录为独立使用，无团长',
      creationStatus:
        r.sync_status === 'failed'
          ? '创建失败'
          : r.status === 'rejected'
            ? '已退回'
            : r.sync_status === 'synced'
              ? '创建成功'
              : '待提交／处理中',
      failureReason: r.sync_status === 'failed' ? keywordFailureMessage(r.sync_error) : '',
      bindingStatus: !r.binding_id
        ? '未领取／分配'
        : r.released_at
          ? '已释放'
          : r.executor_id
            ? '已分配使用人'
            : '团长已领取，待分配',
    }));
  });
}
