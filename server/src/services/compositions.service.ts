import crypto from 'node:crypto';
import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { enqueue } from '../queue';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { pageOffset } from '../utils/pagination';
import { scopeFilter } from '../utils/scopeFilter';
import { writeAudit } from './audit.service';
import { isCompositionCategoryValid } from '../zhihu/composition';

interface CountRow extends RowDataPacket { total: number }
interface ItemRow extends RowDataPacket { id: string; owner_id: string; status: string; sync_status: string }
interface PlanOwnerRow extends RowDataPacket { owner_id: string }
export interface CompositionInput {
  planId: string;
  mediaType: string;
  mediaAccount: string;
  compositionType: number;
  compositionSubType: number;
  title?: string | null;
  promoUrl: string;
  releaseTime: string;
}

const stableHash = (value: unknown) => crypto
  .createHash('sha256')
  .update(JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort()))
  .digest('hex')
  .slice(0, 16);

const syncJobOptions = (jobId: string) => ({ jobId, removeOnComplete: true, removeOnFail: true });

async function planOwner(user: AuthUser, planId: string, connection: PoolConnection) {
  const scope = scopeFilter(user, 'owner_id');
  const [plans] = await connection.query<PlanOwnerRow[]>(
    `SELECT owner_id
     FROM plans
     WHERE id = ? AND status <> 'ended' AND ${scope.clause}
     LIMIT 1`,
    [planId, ...scope.bindings],
  );
  const plan = plans[0];
  if (!plan) throw new AppError(404, 40401, '推广计划不存在');
  return String(plan.owner_id);
}

export async function listCompositions(user: AuthUser, query: Record<string, unknown>) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  const scope = scopeFilter(user, 'c.owner_id');
  const where = [scope.clause];
  const bindings: unknown[] = [...scope.bindings];
  if (query.planId) { where.push('c.plan_id = ?'); bindings.push(query.planId); }
  if (query.status) { where.push('c.status = ?'); bindings.push(query.status); }
  const clause = where.join(' AND ');
  const [count] = await rows<CountRow>(
    `SELECT COUNT(*) total FROM compositions c WHERE ${clause}`,
    bindings,
  );
  const list = await rows<ItemRow>(
    `SELECT c.*, p.keyword, p.channel_id, ch.name channel_name,
            u.display_name assignee_name
     FROM compositions c
     JOIN plans p ON p.id = c.plan_id
     LEFT JOIN channels ch
       ON ch.project_id = p.project_id AND ch.zhihu_channel_id = p.channel_id
     JOIN users u ON u.id = c.owner_id
     WHERE ${clause}
     ORDER BY c.created_at DESC
     LIMIT ? OFFSET ?`,
    [...bindings, pageSize, pageOffset(page, pageSize)],
  );
  return { list, total: Number(count?.total ?? 0), page, pageSize };
}

export async function getComposition(user: AuthUser, id: string) {
  const scope = scopeFilter(user, 'c.owner_id');
  const [item] = await rows<ItemRow>(
    `SELECT c.* FROM compositions c WHERE c.id = ? AND ${scope.clause} LIMIT 1`,
    [id, ...scope.bindings],
  );
  if (!item) throw new AppError(404, 40401, '作品不存在');
  return item;
}

async function insertComposition(
  user: AuthUser,
  input: CompositionInput,
  connection: PoolConnection,
) {
  const ownerId = await planOwner(user, input.planId, connection);
  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO compositions
      (plan_id, owner_id, media_type, media_account, composition_type,
       composition_sub_type, title, promo_url, release_time, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local')`,
    [
      input.planId,
      ownerId,
      input.mediaType,
      input.mediaAccount,
      input.compositionType,
      input.compositionSubType,
      input.title ?? null,
      input.promoUrl,
      new Date(input.releaseTime),
    ],
  );
  return String(result.insertId);
}

export async function createComposition(user: AuthUser, input: CompositionInput, ip?: string) {
  const id = await withTransaction(async (connection) => {
    const value = await insertComposition(user, input, connection);
    await writeAudit({
      userId: user.sub,
      action: 'composition.create',
      resourceType: 'composition',
      resourceId: value,
      ip,
    }, connection);
    return value;
  });
  await enqueue('push-composition', { compositionId: id }, syncJobOptions(`composition-${id}`));
  return { id, syncStatus: 'local' };
}

export async function createCompositionBatch(user: AuthUser, items: CompositionInput[], ip?: string) {
  const ids = await withTransaction(async (connection) => {
    const created: string[] = [];
    for (const item of items) created.push(await insertComposition(user, item, connection));
    await writeAudit({
      userId: user.sub,
      action: 'composition.batch_create',
      resourceType: 'composition',
      detail: { count: created.length },
      ip,
    }, connection);
    return created;
  });
  for (const id of ids) {
    await enqueue('push-composition', { compositionId: id }, syncJobOptions(`composition-${id}`));
  }
  return { ids, count: ids.length, syncStatus: 'local' };
}

export async function updateComposition(
  user: AuthUser,
  id: string,
  patch: Record<string, unknown>,
  ip?: string,
) {
  const existing = await getComposition(user, id) as ItemRow & {
    composition_type: number;
    composition_sub_type: number;
  };
  const nextType = patch.compositionType === undefined
    ? Number(existing.composition_type)
    : Number(patch.compositionType);
  const nextSubType = patch.compositionSubType === undefined
    ? Number(existing.composition_sub_type)
    : Number(patch.compositionSubType);
  if (!isCompositionCategoryValid(nextType, nextSubType)) {
    throw new AppError(422, 42200, '作品分类组合不正确');
  }
  const mapping: Record<string, string> = {
    mediaAccount: 'media_account',
    compositionType: 'composition_type',
    compositionSubType: 'composition_sub_type',
    title: 'title',
    promoUrl: 'promo_url',
    releaseTime: 'release_time',
  };
  const fields: string[] = [];
  const bindings: unknown[] = [];
  for (const [key, column] of Object.entries(mapping)) {
    if (key in patch) {
      fields.push(`${column} = ?`);
      bindings.push(key === 'releaseTime' && patch[key] != null ? new Date(String(patch[key])) : patch[key]);
    }
  }
  if (!fields.length) throw new AppError(422, 42200, '没有可修改的字段');

  await withTransaction(async (connection) => {
    await connection.query(
      `UPDATE compositions SET ${fields.join(', ')}, sync_status = 'local' WHERE id = ?`,
      [...bindings, id],
    );
    await writeAudit({
      userId: user.sub,
      action: 'composition.update',
      resourceType: 'composition',
      resourceId: id,
      detail: patch,
      ip,
    }, connection);
  });
  await enqueue(
    'push-composition',
    { compositionId: id },
    syncJobOptions(`composition-update-${id}-${stableHash(patch)}`),
  );
  return getComposition(user, id);
}
