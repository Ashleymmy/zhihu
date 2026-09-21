import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../../../db';
import { AppError } from '../../../middleware/errors';
import { AuthUser } from '../../../types';
import { writeAudit } from '../../../services/audit.service';
import { DEV_DEMO_USER_IDS, isDevDemoAuthUser } from '../dev-demo';

export const STORY_ITEM_TYPES = [
  'salt_pick',      // 盐选榜单
  'comment_watch',  // 评论截流
  'risk_report',    // 风险举报
  'media',          // 有声书 / 漫画
  'tag',            // 内容标签
  'product',        // 产品库
  'asset',          // 素材库
] as const;

export type StoryItemType = (typeof STORY_ITEM_TYPES)[number];

interface StoryItemRow extends RowDataPacket {
  id: string;
  type: StoryItemType;
  title: string;
  url: string | null;
  note: string | null;
  status: 'active' | 'archived';
  owner_id: string;
  owner_name?: string;
  created_at: string;
  updated_at: string;
}

const demoStoryItems = (type: StoryItemType) => [
  {
    id: `story-${type}-1`,
    type,
    title:
      type === 'salt_pick'
        ? '盐选高转化内容样例'
        : type === 'comment_watch'
          ? '评论截流监控样例'
          : type === 'risk_report'
            ? '风险内容登记样例'
            : type === 'media'
              ? '有声书/漫画推广样例'
              : type === 'tag'
                ? '内容标签样例'
                : type === 'product'
                  ? '推广产品样例'
                  : '素材库样例',
    url: type === 'tag' ? null : 'https://www.zhihu.com',
    note: '本地演示数据，用于查看列表、新建、归档等页面交互。',
    status: 'active' as const,
    ownerId: DEV_DEMO_USER_IDS.creator,
    ownerName: '本地达人',
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
];

export async function listStoryItems(user: AuthUser, type: StoryItemType, includeArchived: boolean, page = 1, pageSize = 100) {
  if (isDevDemoAuthUser(user)) {
    const items = demoStoryItems(type);
    return { list: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
  }

  const scope = user.role === 'admin' ? '' : 'AND (i.owner_id = ? OR i.owner_id IN (SELECT id FROM users WHERE parent_id = ?))';
  const bindings: unknown[] = [type];
  if (user.role !== 'admin') bindings.push(user.sub, user.sub);
  const where = `i.type = ? ${includeArchived ? '' : "AND i.status = 'active'"} ${scope}`;
  const [count] = await rows<RowDataPacket & { total: number }>(`SELECT COUNT(*) total FROM story_items i WHERE ${where}`, bindings);
  const list = await rows<StoryItemRow>(
    `SELECT i.*, u.display_name AS owner_name
     FROM story_items i JOIN users u ON u.id = i.owner_id
     WHERE ${where}
     ORDER BY i.created_at DESC,i.id DESC LIMIT ? OFFSET ?`,
    [...bindings, pageSize, (page - 1) * pageSize],
  );
  return { list, total: Number(count?.total ?? 0), page, pageSize };
}

export async function createStoryItem(
  user: AuthUser,
  input: { type: StoryItemType; title: string; url?: string | null; note?: string | null },
  ip?: string,
) {
  if (isDevDemoAuthUser(user)) return { id: `story-item-${Date.now()}` };

  const id = await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      'INSERT INTO story_items (type, title, url, note, owner_id) VALUES (?, ?, ?, ?, ?)',
      [input.type, input.title, input.url ?? null, input.note ?? null, user.sub],
    );
    const itemId = String(result.insertId);
    await writeAudit(
      { userId: user.sub, action: 'story_item.create', resourceType: 'story_item', resourceId: itemId, detail: { type: input.type }, ip },
      connection,
    );
    return itemId;
  });
  return { id };
}

export async function updateStoryItem(
  user: AuthUser,
  id: string,
  patch: { title?: string; url?: string | null; note?: string | null; status?: 'active' | 'archived' },
  ip?: string,
) {
  if (isDevDemoAuthUser(user)) return;

  await mustOwn(user, id);
  const fields: string[] = [];
  const bindings: unknown[] = [];
  for (const key of ['title', 'url', 'note', 'status'] as const) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      bindings.push(patch[key]);
    }
  }
  if (!fields.length) throw new AppError(422, 42200, '没有可修改的字段');
  await withTransaction(async (connection) => {
    await connection.query(`UPDATE story_items SET ${fields.join(', ')} WHERE id = ?`, [...bindings, id]);
    await writeAudit(
      { userId: user.sub, action: 'story_item.update', resourceType: 'story_item', resourceId: id, detail: patch, ip },
      connection,
    );
  });
}

export async function deleteStoryItem(user: AuthUser, id: string, ip?: string) {
  if (isDevDemoAuthUser(user)) return;

  await mustOwn(user, id);
  await withTransaction(async (connection) => {
    await connection.query('DELETE FROM story_items WHERE id = ?', [id]);
    await writeAudit(
      { userId: user.sub, action: 'story_item.delete', resourceType: 'story_item', resourceId: id, ip },
      connection,
    );
  });
}

/** 归属于自己的才能改/删；admin 全量。 */
async function mustOwn(user: AuthUser, id: string) {
  const [item] = await rows<StoryItemRow>('SELECT id, owner_id FROM story_items WHERE id = ? LIMIT 1', [id]);
  if (!item) throw new AppError(404, 40401, '内容不存在');
  if (user.role !== 'admin' && String(item.owner_id) !== user.sub) throw new AppError(403, 40301, '无权操作该内容');
}
