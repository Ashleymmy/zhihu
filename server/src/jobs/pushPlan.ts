import { RowDataPacket } from 'mysql2/promise';
import { db, rows } from '../db';
import { zhihuPost, zhihuPut, zhihuSyncErrorDetail } from '../zhihu/client';

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
  const [plan] = await rows<PlanRow>('SELECT * FROM plans WHERE id = ? LIMIT 1', [id]);
  if (!plan || plan.status === 'ended') return;

  await db.query("UPDATE plans SET sync_status = 'syncing', sync_error = NULL WHERE id = ?", [id]);
  const body = buildPlanPayload(plan);

  try {
    const response = plan.zhihu_plan_id
      ? await zhihuPut(`/alliance/api/popularize_plan/${plan.zhihu_plan_id}`, body)
      : await zhihuPost('/alliance/api/popularize_plan', body);
    await db.query(
      `UPDATE plans
       SET sync_status = 'synced', zhihu_plan_id = COALESCE(?, zhihu_plan_id), sync_error = NULL
       WHERE id = ?`,
      [upstreamId(response), id],
    );
  } catch (error) {
    const message = zhihuSyncErrorDetail(error);
    await db.query("UPDATE plans SET sync_status = 'failed', sync_error = ? WHERE id = ?", [message, id]);
    throw error;
  }
}
