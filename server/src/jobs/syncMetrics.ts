import { RowDataPacket } from 'mysql2/promise';
import { db, rows } from '../db';
import { zhihuGet } from '../zhihu/client';

interface MetricItem { channel_id?: string; channelId?: string; keyword: string; stat_date?: string; statDate?: string; impressions?: number; clicks?: number; conversions?: number; earning?: number }
interface OwnerRow extends RowDataPacket { id: string; owner_id: string }

const date = (daysAgo: number) => {
  const value = new Date(); value.setUTCDate(value.getUTCDate() - daysAgo);
  return value.toISOString().slice(0, 10);
};

export async function syncMetrics(data: Record<string, unknown>) {
  const from = String(data.from ?? date(7)); const to = String(data.to ?? date(1));
  const response = await zhihuGet<unknown>('/alliance/api/data_report/daily_data', { start_date: from, end_date: to });
  const body = response as Record<string, unknown>;
  const items = ((body.data as Record<string, unknown>)?.list ?? body.list ?? body.data ?? []) as MetricItem[];
  for (const item of items) {
    const channelId = String(item.channel_id ?? item.channelId ?? '');
    const [owner] = await rows<OwnerRow>("SELECT id, owner_id FROM plans WHERE channel_id = ? AND keyword = ? AND status <> 'ended' LIMIT 1", [channelId, item.keyword]);
    if (!owner && process.env.NODE_ENV !== 'test') console.warn('metric_owner_missing', { channelId, keyword: item.keyword });
    await db.query(
      `INSERT INTO daily_metrics (project_id, channel_id, keyword, plan_id, owner_id, stat_date, impressions, clicks, conversions, earning, raw_json, fetched_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE impressions=VALUES(impressions), clicks=VALUES(clicks), conversions=VALUES(conversions), earning=VALUES(earning), raw_json=VALUES(raw_json), owner_id=VALUES(owner_id), plan_id=VALUES(plan_id), fetched_at=NOW()`,
      [channelId, item.keyword, owner?.id ?? null, owner?.owner_id ?? null, item.stat_date ?? item.statDate,
        item.impressions ?? 0, item.clicks ?? 0, item.conversions ?? 0, item.earning ?? 0, JSON.stringify(item)],
    );
  }
}
