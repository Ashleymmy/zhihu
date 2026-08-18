import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { db, rows } from '../db';
import { zhihuPost, zhihuPut, zhihuSyncErrorDetail } from '../zhihu/client';
import { COMPOSITION_ID_INVALID_ERROR, isCanonicalCompositionId } from '../zhihu/allianceVersionPolicy';

export interface CompositionPayloadInput {
  zhihu_plan_id: string;
  channel_id: string;
  media_type: string;
  media_account: string;
  composition_type: number;
  composition_sub_type: number;
  promo_url: string;
  release_time: Date;
}
interface CompositionRow extends RowDataPacket, Partial<CompositionPayloadInput> {
  id: string;
  zhihu_composition_id: string | null;
  status: string;
  sync_status: string;
  plan_sync_status: string;
}

export function buildCompositionPayload(item: CompositionPayloadInput): Record<string, unknown> {
  return {
    plan_id: item.zhihu_plan_id,
    channel_id: item.channel_id,
    media_type: item.media_type,
    media_account: item.media_account,
    composition_type: item.composition_type,
    composition_sub_type: item.composition_sub_type,
    composition_url: item.promo_url,
    release_time: Math.floor(item.release_time.getTime() / 1000),
  };
}

const upstreamId = (response: unknown) => {
  const value = response as Record<string, unknown>;
  const data = (value.data ?? value) as Record<string, unknown>;
  const id = data.composition_id ?? data.compositionId ?? data.id;
  return id == null ? null : String(id);
};

async function failLocally(id: string, message: string) {
  await db.query(
    "UPDATE compositions SET sync_status = 'failed', sync_error = ? WHERE id = ? AND sync_status = 'syncing'",
    [message, id],
  );
}

export async function pushComposition(data: Record<string, unknown>) {
  const id = String(data.compositionId);
  const [item] = await rows<CompositionRow>(
    `SELECT c.*, p.zhihu_plan_id, p.channel_id, p.sync_status AS plan_sync_status
     FROM compositions c
     JOIN plans p ON p.id = c.plan_id
     WHERE c.id = ?
     LIMIT 1`,
    [id],
  );
  if (!item || item.status === 'ended') return;

  const [claimed] = await db.query<ResultSetHeader>(
    "UPDATE compositions SET sync_status = 'syncing', sync_error = NULL WHERE id = ? AND sync_status IN ('local', 'failed')",
    [id],
  );
  if (claimed.affectedRows === 0) return;

  if (item.plan_sync_status !== 'synced' || !item.zhihu_plan_id) {
    await failLocally(id, '推广计划尚未同步成功，请稍后重试');
    return;
  }
  if (!item.release_time || !(item.release_time instanceof Date) || Number.isNaN(item.release_time.getTime())) {
    await failLocally(id, '作品发布时间缺失，请补充后重试');
    return;
  }

  const hasExistingCompositionId = item.zhihu_composition_id != null;
  if (hasExistingCompositionId) {
    if (!isCanonicalCompositionId(item.zhihu_composition_id)) {
      await failLocally(id, COMPOSITION_ID_INVALID_ERROR);
      return;
    }
  }

  const body = buildCompositionPayload(item as CompositionPayloadInput);
  try {
    const response = hasExistingCompositionId
      ? await zhihuPut(`/alliance/api/popularize_composition/v2/${item.zhihu_composition_id}`, body)
      : await zhihuPost('/alliance/api/popularize_composition/v2', body);
    await db.query(
      `UPDATE compositions
       SET sync_status = 'synced', zhihu_composition_id = COALESCE(?, zhihu_composition_id), sync_error = NULL
       WHERE id = ? AND sync_status = 'syncing'`,
      [upstreamId(response), id],
    );
  } catch (error) {
    const message = zhihuSyncErrorDetail(error);
    await db.query(
      "UPDATE compositions SET sync_status = 'failed', sync_error = ? WHERE id = ? AND sync_status = 'syncing'",
      [message, id],
    );
    throw error;
  }
}
