import { RowDataPacket } from 'mysql2/promise';
import { db, rows } from '../db';
import { zhihuPost, zhihuPut } from '../zhihu/client';

interface CompositionRow extends RowDataPacket {
  id: string;
  zhihu_composition_id: string | null;
  media_type: number;
  media_account: string;
  composition_type: number;
  composition_sub_type: number;
  title: string | null;
  promo_url: string;
  release_time: Date | null;
  status: string;
}

const upstreamId = (response: unknown) => {
  const value = response as Record<string, unknown>;
  const data = (value.data ?? value) as Record<string, unknown>;
  const id = data.composition_id ?? data.compositionId ?? data.id;
  return id == null ? null : String(id);
};

export async function pushComposition(data: Record<string, unknown>) {
  const id = String(data.compositionId);
  const [item] = await rows<CompositionRow>('SELECT * FROM compositions WHERE id = ? LIMIT 1', [id]);
  if (!item || item.status === 'ended') return;

  await db.query("UPDATE compositions SET sync_status = 'syncing', sync_error = NULL WHERE id = ?", [id]);
  const body = {
    media_type: item.media_type,
    media_account: item.media_account,
    composition_type: item.composition_type,
    composition_sub_type: item.composition_sub_type,
    title: item.title,
    promo_url: item.promo_url,
    release_time: item.release_time?.toISOString() ?? null,
  };

  try {
    const response = item.zhihu_composition_id
      ? await zhihuPut(`/alliance/api/popularize_composition/v2/${item.zhihu_composition_id}`, body)
      : await zhihuPost('/alliance/api/popularize_composition/v2', body);
    await db.query(
      `UPDATE compositions
       SET sync_status = 'synced', zhihu_composition_id = COALESCE(?, zhihu_composition_id), sync_error = NULL
       WHERE id = ?`,
      [upstreamId(response), id],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 512) : 'unknown error';
    await db.query("UPDATE compositions SET sync_status = 'failed', sync_error = ? WHERE id = ?", [message, id]);
    throw error;
  }
}
