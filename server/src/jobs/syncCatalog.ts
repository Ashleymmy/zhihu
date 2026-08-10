import { RowDataPacket } from 'mysql2/promise';
import { db, rows } from '../db';
import { zhihuGet } from '../zhihu/client';

interface ChannelRow extends RowDataPacket {
  zhihu_channel_id: string;
}

export function listOf(response: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(response)) return response as Array<Record<string, unknown>>;
  if (!response || typeof response !== 'object') return [];
  const value = response as Record<string, unknown>;
  if (Array.isArray(value.data)) return value.data as Array<Record<string, unknown>>;
  const data = value.data && typeof value.data === 'object'
    ? value.data as Record<string, unknown>
    : value;
  if (Array.isArray(data.list)) return data.list as Array<Record<string, unknown>>;
  if (Array.isArray(data.items)) return data.items as Array<Record<string, unknown>>;
  if (Array.isArray(value.list)) return value.list as Array<Record<string, unknown>>;
  return [];
}

function nullableString(value: unknown): string | null {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function mysqlDateOrNull(value: unknown): string | null {
  const text = nullableString(value);
  return text && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/.test(text) ? text : null;
}

export function normalizeChannel(item: Record<string, unknown>) {
  const channelId = nullableString(item.channel_id ?? item.channelId ?? item.id);
  if (!channelId) return null;
  return {
    channelId,
    parentChannelId: nullableString(item.parent_channel_id ?? item.parentChannelId),
    generation: Number(item.generation ?? 1),
    name: String(item.channel_name ?? item.channelName ?? item.name ?? channelId),
    commissionRate: item.commission_rate ?? item.commissionRate ?? null,
  };
}

export function normalizeTask(item: Record<string, unknown>) {
  const taskId = nullableString(item.task_id ?? item.taskId ?? item.id);
  if (!taskId) return null;
  return {
    taskId,
    name: String(item.task_name ?? item.taskName ?? item.name ?? taskId),
    popularizeType: item.popularize_type ?? item.popularizeType ?? null,
    settleType: nullableString(item.pay_caliber ?? item.settle_type ?? item.settleType),
    unitPrice: item.unit_price ?? item.unitPrice ?? null,
    startTime: mysqlDateOrNull(item.start_time ?? item.startTime),
    endTime: mysqlDateOrNull(item.expiry_time ?? item.end_time ?? item.endTime),
    status: nullableString(item.status),
    rawJson: JSON.stringify(item),
  };
}

export async function syncChannels() {
  const response = await zhihuGet('/alliance/api/get_agent_channels');
  for (const item of listOf(response)) {
    const channel = normalizeChannel(item);
    if (!channel) continue;
    await db.query(
      `INSERT INTO channels
        (project_id, zhihu_channel_id, parent_channel_id, generation, name, commission_rate, is_enabled, synced_at)
       VALUES (1, ?, ?, ?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE
        parent_channel_id=VALUES(parent_channel_id), generation=VALUES(generation), name=VALUES(name),
        commission_rate=VALUES(commission_rate), synced_at=NOW()`,
      [channel.channelId, channel.parentChannelId, channel.generation, channel.name, channel.commissionRate],
    );
  }
}

export async function syncTasks(data: Record<string, unknown> = {}) {
  const requestedChannelId = nullableString(data.channelId);
  const channelIds = requestedChannelId
    ? [requestedChannelId]
    : (await rows<ChannelRow>(
      'SELECT zhihu_channel_id FROM channels WHERE is_enabled = 1 AND generation = 1 ORDER BY id',
    )).map((row) => String(row.zhihu_channel_id));

  for (const channelId of channelIds) {
    const response = await zhihuGet('/alliance/api/popularize_tasks', {
      channel_id: channelId,
      offset: 0,
      limit: 100,
    });
    for (const item of listOf(response)) {
      const task = normalizeTask(item);
      if (!task) continue;
      await db.query(
        `INSERT INTO tasks
          (project_id, zhihu_task_id, name, popularize_type, settle_type, unit_price,
           start_time, end_time, status, raw_json, synced_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
          name=VALUES(name), popularize_type=VALUES(popularize_type), settle_type=VALUES(settle_type),
          unit_price=VALUES(unit_price), start_time=VALUES(start_time), end_time=VALUES(end_time),
          status=VALUES(status), raw_json=VALUES(raw_json), synced_at=NOW()`,
        [
          task.taskId, task.name, task.popularizeType, task.settleType, task.unitPrice,
          task.startTime, task.endTime, task.status, task.rawJson,
        ],
      );
    }
  }
}
