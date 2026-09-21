import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { db, rows } from '../../../db';
import { zhihuPost, zhihuSyncErrorDetail } from '../zhihu/client';
import { PLAN_UPDATE_UNSUPPORTED_ERROR } from '../zhihu/allianceVersionPolicy';
import { synchronizeKeywords } from '../attribution/keyword-readiness';

export interface PlanPayloadInput {
  zhihu_task_id: string;
  channel_id: string;
  second_channel_id: string | null;
  keyword: string;
  landing_url: string;
  popularize_type: number;
}

interface PlanRow extends RowDataPacket, PlanPayloadInput {
  id: string;
  status: string;
  zhihu_plan_id: string | null;
  name: string | null;
  daily_budget: number | null;
  simulation_mode?: number;
  account_id?: string;
  keyword_project_id?: string;
}

/**
 * 将本地计划字段映射为知乎推广计划接口契约。
 * 本地 landing_url/name/daily_budget 不能直接透传给上游；知乎接口要求 content_url，
 * 且只接受接口文档列出的业务字段。二代渠道仅在有值时传递，避免发送 null。
 */
export function buildPlanPayload(plan: PlanPayloadInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    task_id: plan.zhihu_task_id,
    channel_id: plan.channel_id,
    content_url: plan.landing_url,
    popularize_type: plan.popularize_type,
    keyword: plan.keyword,
  };
  if (plan.second_channel_id) body.second_channel_id = plan.second_channel_id;
  return body;
}

const upstreamId = (response: unknown): string | null => {
  const value = response as Record<string, unknown>;
  const data = (value?.data ?? value) as Record<string, unknown>;
  const id = data?.plan_id ?? data?.planId ?? data?.id;
  return id == null ? null : String(id);
};

export async function pushPlan(data: Record<string, unknown>) {
  const id = String(data.planId);
  const [plan] = await rows<PlanRow>("SELECT p.*, k.account_id, k.project_id keyword_project_id, CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(s.config_json, '$.mode')) = 'simulation' THEN 1 ELSE 0 END AS simulation_mode FROM plans p LEFT JOIN zh_keywords k ON k.plan_id=p.id LEFT JOIN zhihu_account_settings s ON s.project_id=k.project_id AND s.account_id=k.account_id WHERE p.id = ? LIMIT 1", [id]);
  if (!plan || plan.status === 'ended') return;
  if (plan.account_id && ((data.accountId && data.accountId !== 'legacy' && String(data.accountId) !== String(plan.account_id)) ||
      (data.projectId && String(data.projectId) !== String(plan.keyword_project_id)))) {
    throw new Error('关键词同步任务与接入账号或项目不一致');
  }

  if (plan.zhihu_plan_id != null) {
    await db.query(
      "UPDATE plans SET sync_status = 'failed', sync_error = ? WHERE id = ? AND keyword = ? AND sync_status IN ('local', 'failed') AND zhihu_plan_id = ?",
      [PLAN_UPDATE_UNSUPPORTED_ERROR, id, plan.keyword, plan.zhihu_plan_id],
    );
    return;
  }

  const [claimed] = await db.query<ResultSetHeader>(
    "UPDATE plans SET sync_status = 'syncing', sync_error = NULL WHERE id = ? AND keyword = ? AND sync_status IN ('local', 'failed')",
    [id, plan.keyword],
  );
  if (claimed.affectedRows === 0) return;
  const body = buildPlanPayload(plan);

  try {
    // 联测账号使用显式账号配置的本地适配器，绝不访问知乎上游。
    if (Number(plan.simulation_mode) === 1) {
      await db.query(
        `UPDATE plans p JOIN zh_keywords k ON k.plan_id=p.id
         SET p.sync_status='simulated',p.status='active',p.sync_error=NULL,
             k.upstream_status='simulated',k.lifecycle_status='available',k.version=k.version+1
         WHERE p.id=? AND p.keyword=? AND p.sync_status='syncing'
           AND p.zhihu_plan_id IS NULL AND k.current_binding_id IS NULL AND k.used_ever_at IS NULL
           AND NOT EXISTS(SELECT 1 FROM zh_engine_routes r WHERE r.account_id=k.account_id AND r.project_id=k.project_id AND r.mode='stopped')`,
        [id, plan.keyword],
      );
      return;
    }
    const response = await zhihuPost('/alliance/api/popularize_plan', body);
    const planId = upstreamId(response);
    if (!planId?.trim()) throw new Error('知乎未返回有效的计划 ID');
    await db.query(
      `UPDATE plans SET sync_status = 'synced', zhihu_plan_id = ?, sync_error = NULL,
       status = IF(status = 'pending', 'active', status) WHERE id = ? AND keyword = ? AND sync_status = 'syncing'`,
      [planId, id, plan.keyword],
    );
  } catch (error) {
    const message = zhihuSyncErrorDetail(error);
    await db.query(
      "UPDATE plans SET sync_status = 'failed', sync_error = ? WHERE id = ? AND keyword = ? AND sync_status = 'syncing'",
      [message, id, plan.keyword],
    );
    throw error;
  }
  if (plan.account_id && plan.keyword_project_id) {
    await synchronizeKeywords({accountId:String(plan.account_id),projectId:String(plan.keyword_project_id)},id);
  }
}
