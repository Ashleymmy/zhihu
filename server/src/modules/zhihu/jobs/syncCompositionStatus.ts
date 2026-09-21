import { RowDataPacket } from 'mysql2/promise';
import { db } from '../../../db';
import { zhihuGet } from '../zhihu/client';
import { listPages } from './listPages';

interface LocalComposition extends RowDataPacket {
  id: string;
  zhihu_composition_id: string;
  channel_id: string;
  keyword: string;
}

export async function syncCompositionStatus() {
  const [local] = await db.query<LocalComposition[]>(
    `SELECT c.id,c.zhihu_composition_id,p.channel_id,p.keyword
     FROM compositions c JOIN plans p ON p.id=c.plan_id
     LEFT JOIN zh_keywords k ON k.plan_id=p.id
     LEFT JOIN zhihu_account_settings s ON s.project_id=k.project_id AND s.account_id=k.account_id
     WHERE c.zhihu_composition_id IS NOT NULL AND c.status<>'ended'
       AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.config_json,'$.mode')),'upstream')<>'simulation'`,
  );
  const groups = new Map<string, LocalComposition[]>();
  for (const item of local) {
    const key = JSON.stringify([item.channel_id, item.keyword]);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  let updated = 0;
  for (const group of groups.values()) {
    const targets = new Map(group.map(item => [String(item.zhihu_composition_id), item.id]));
    for await (const remote of listPages(
      (offset, limit) => zhihuGet('/alliance/api/popularize_compositions', {
        channel_id: group[0].channel_id, keyword: group[0].keyword, offset, limit,
      }),
      item => String(item.compositionId ?? item.composition_id),
    )) {
      const id = targets.get(String(remote.compositionId ?? remote.composition_id));
      if (!id) continue;
      const review: Record<string, unknown> = {};
      for (const [name, aliases] of Object.entries({status:['status'],auditStatus:['auditStatus','audit_status'],rejectReason:['rejectReason','reject_reason']})) {
        const key = aliases.find(alias => Object.prototype.hasOwnProperty.call(remote, alias));
        if (key) review[name] = remote[key];
      }
      if (!Object.keys(review).length) continue;
      // Missing fields leave existing observations intact. Explicit null clears a
      // field; neither submission success nor platform review is changed here.
      await db.query(
        `UPDATE compositions SET zhihu_status_json=JSON_MERGE_PATCH(
          IF(JSON_VALID(zhihu_status_json),zhihu_status_json,JSON_OBJECT()),?),updated_at=NOW() WHERE id=?`,
        [JSON.stringify(review), id],
      );
      updated++;
    }
  }
  // Propagate upstream/pagination failures so the queue can retry and report failure.
  return { updated, total: local.length };
}
