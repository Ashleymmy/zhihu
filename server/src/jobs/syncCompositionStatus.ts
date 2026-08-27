import { RowDataPacket } from 'mysql2/promise';
import { db } from '../db';
import { zhihuGet } from '../zhihu/client';

interface ZhihuComposition {
  composition_id?: string;
  compositionId?: string;
  title: string;
  status?: string;
  audit_status?: string;
  auditStatus?: string;
  reject_reason?: string;
  rejectReason?: string;
}

interface LocalComposition extends RowDataPacket {
  id: string;
  zhihu_composition_id: string;
  title: string;
}

/**
 * 从知乎 API 拉取作品列表，同步审核状态和拒绝原因
 * 官方反馈：不论什么状态都应该有返回参数（待审核、已通过、已拒绝等）
 */
export async function syncCompositionStatus() {
  // 1. 获取本地所有已同步的作品（有 zhihu_composition_id 的）
  const [localCompositions] = await db.query<LocalComposition[]>(
    `SELECT id, zhihu_composition_id, title FROM compositions
     WHERE zhihu_composition_id IS NOT NULL AND status <> 'deleted'`,
  );

  if (localCompositions.length === 0) {
    console.log('syncCompositionStatus: 无已同步的作品');
    return;
  }

  // 2. 调用知乎 API 获取作品列表
  try {
    const response = await zhihuGet<unknown>('/alliance/api/popularize_compositions', {
      page: 1,
      page_size: 100
    });
    const body = response as Record<string, unknown>;
    const zhihuCompositions = ((body.data as Record<string, unknown>)?.list ?? body.list ?? body.data ?? []) as ZhihuComposition[];

    // 3. 建立 zhihu_composition_id -> 知乎作品状态的映射
    const statusMap = new Map<string, { status?: string; auditStatus?: string; rejectReason?: string }>();
    for (const zc of zhihuCompositions) {
      const cid = String(zc.composition_id ?? zc.compositionId ?? '');
      if (!cid) continue;
      statusMap.set(cid, {
        status: zc.status,
        auditStatus: zc.audit_status ?? zc.auditStatus,
        rejectReason: zc.reject_reason ?? zc.rejectReason,
      });
    }

    // 4. 更新本地作品的知乎状态字段
    let updated = 0;
    for (const local of localCompositions) {
      const remote = statusMap.get(local.zhihu_composition_id);
      if (!remote) continue;

      // 将知乎状态同步到 compositions.zhihu_status_json
      await db.query(
        `UPDATE compositions
         SET zhihu_status_json = ?, updated_at = NOW()
         WHERE id = ?`,
        [JSON.stringify(remote), local.id],
      );
      updated++;
    }

    console.log(`syncCompositionStatus: 更新了 ${updated}/${localCompositions.length} 个作品状态`);
  } catch (error) {
    console.error('syncCompositionStatus 失败:', error instanceof Error ? error.message : String(error));
  }
}
