import { RowDataPacket } from 'mysql2/promise';
import { db, rows } from '../db';
import { zhihuPost, zhihuPut } from '../zhihu/client';

interface PlanRow extends RowDataPacket {
  id: string;
  status: string;
  zhihu_plan_id: string | null;
  zhihu_task_id: string;
  channel_id: string;
  second_channel_id: string | null;
  keyword: string;
  landing_url: string;
  popularize_type: number;
  name: string | null;
  daily_budget: number | null;
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
  const body = {
    task_id: plan.zhihu_task_id,
    channel_id: plan.channel_id,
    second_channel_id: plan.second_channel_id,
    keyword: plan.keyword,
    landing_url: plan.landing_url,
    popularize_type: plan.popularize_type,
    name: plan.name,
    daily_budget: plan.daily_budget,
  };

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
    const message = error instanceof Error ? error.message.slice(0, 512) : 'unknown error';
    await db.query("UPDATE plans SET sync_status = 'failed', sync_error = ? WHERE id = ?", [message, id]);
    throw error;
  }
}
