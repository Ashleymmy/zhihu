import crypto from 'node:crypto';
import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../../../db';
import { enqueue } from '../queue';
import { AppError } from '../../../middleware/errors';
import { AuthUser } from '../../../types';
import { pageOffset } from '../../../utils/pagination';
import { scopeFilter } from '../../../utils/scopeFilter';
import { writeAudit } from '../../../services/audit.service';
import { isCompositionCategoryValid } from '../zhihu/composition';
import { DEV_DEMO_USER_IDS, isDevDemoAuthUser } from '../dev-demo';
import { planAccountSql } from './plan-account';
import { compositionPlanScope } from './composition-access';
import { assertKeywordReady } from '../attribution/keyword-usability';
import { compositionLinkProblem, submissionFailure } from './submission-feedback';
import { businessDay } from '../attribution/domain';

interface CountRow extends RowDataPacket {
  total: number;
}
interface ItemRow extends RowDataPacket {
  id: string;
  owner_id: string;
  status: string;
  sync_status: string;
}
interface PlanOwnerRow extends RowDataPacket {
  owner_id: string;
  keyword_id: string | null;
  binding_id: string | null;
  executor_id: string | null;
}
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

const stableHash = (value: unknown) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort()))
    .digest('hex')
    .slice(0, 16);

const syncJobOptions = (jobId: string) => ({ jobId, removeOnComplete: true, removeOnFail: true });

async function planOwner(user: AuthUser, planId: string, connection: PoolConnection, releaseTime?:string) {
  const scope = compositionPlanScope(user, true, false);
  const [plans] = await connection.query<PlanOwnerRow[]>(
    `SELECT p.owner_id,CAST(k.id AS CHAR) keyword_id,CAST(b.id AS CHAR) binding_id,CAST(b.executor_id AS CHAR) executor_id,CAST(k.project_id AS CHAR) project_id,CAST(k.account_id AS CHAR) account_id
     FROM plans p
     LEFT JOIN zh_keywords k ON k.plan_id=p.id
     LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id AND b.keyword_id=k.id
     WHERE p.id = ? AND ${scope.clause}
     LIMIT 1 FOR UPDATE`,
    [planId, ...scope.bindings],
  );
  const plan = plans[0];
  if (!plan) throw new AppError(404, 40401, '推广计划不存在');
  if (plan.keyword_id) await assertKeywordReady(connection, String(plan.keyword_id));
  // Freeze the same assignment used to authorize this work. A failed insert
  // rolls these updates back; the original plan owner is never reassigned.
  if (plan.binding_id && plan.executor_id) {
    const {bindingStartDay,recomputeStartDateFacts}=await import('../attribution/activation-date');
    await connection.query('UPDATE zh_keyword_bindings SET used_at=COALESCE(used_at,NOW(3)),activated_on=?,version=version+1 WHERE id=?',
      [await bindingStartDay(connection,String(plan.binding_id),releaseTime?businessDay(new Date(releaseTime)):undefined),plan.binding_id]);
    await connection.query("UPDATE zh_keywords SET used_ever_at=COALESCE(used_ever_at,NOW(3)),lifecycle_status='active',version=version+1 WHERE id=?",[plan.keyword_id]);
    await recomputeStartDateFacts(connection,{projectId:String(plan.project_id),accountId:String(plan.account_id)},String(plan.keyword_id));
  } else if (plan.keyword_id) {
    // Staff historical registration preserves the platform plan's original
    // owner, without inventing a creator or a commission-bearing assignment.
    await connection.query("UPDATE zh_keywords SET used_ever_at=COALESCE(used_ever_at,NOW(3)),lifecycle_status='active',version=version+1 WHERE id=?",[plan.keyword_id]);
  }
  return String(plan.executor_id ?? plan.owner_id);
}

export async function listCompositions(user: AuthUser, query: Record<string, unknown>) {
  if (isDevDemoAuthUser(user)) {
    const list = [
      {
        id: 'composition-demo-1',
        planId: '10001',
        ownerId: DEV_DEMO_USER_IDS.creator,
        mediaType: 'KOC视频号',
        mediaAccount: 'creator_demo',
        compositionType: 1,
        compositionSubType: 1,
        title: '知乎故事推广演示作品',
        promoUrl: 'https://www.zhihu.com',
        releaseTime: new Date(Date.now() - 86_400_000).toISOString(),
        status: 'active',
        rejectReason: null,
        syncStatus: 'synced',
        zhihuStatusJson: { auditStatus: 'approved' },
        keyword: '知乎故事推广',
        channelName: '知乎故事一代渠道',
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    ].filter((item) => user.role !== 'creator' || item.ownerId === user.sub);
    return { list, total: list.length, page: Number(query.page ?? 1), pageSize: Number(query.pageSize ?? 20) };
  }

  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  const scope = scopeFilter(user, 'c.owner_id');
  const where = [scope.clause];
  const bindings: unknown[] = [...scope.bindings];
  if (query.planId) {
    where.push('c.plan_id = ?');
    bindings.push(query.planId);
  }
  if (query.status) {
    where.push('c.status = ?');
    bindings.push(query.status);
  }
  if (query.keyword) {
    where.push('p.keyword LIKE ?');
    bindings.push(`%${String(query.keyword)}%`);
  }
  const clause = where.join(' AND ');
  const [count] = await rows<CountRow>(`SELECT COUNT(*) total FROM compositions c JOIN plans p ON p.id=c.plan_id WHERE ${clause}`, bindings);
  const list = await rows<ItemRow>(
    `SELECT c.*, p.keyword, p.channel_id, ch.name channel_name,p.sync_status plan_sync_status,p.sync_error plan_sync_error,
            CAST(p.project_id AS CHAR) keyword_project_id,
            CAST(${planAccountSql()} AS CHAR) keyword_account_id,
            u.display_name assignee_name
     FROM compositions c
     JOIN plans p ON p.id = c.plan_id
     LEFT JOIN channels ch
       ON ch.project_id = p.project_id AND ch.zhihu_channel_id = p.channel_id
     JOIN users u ON u.id = c.owner_id
     WHERE ${clause}
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT ? OFFSET ?`,
    [...bindings, pageSize, pageOffset(page, pageSize)],
  );
  for (const item of list) {
    item.failure_reason = item.sync_status === 'failed' ? compositionLinkProblem(String(item.media_type),String(item.promo_url)) || submissionFailure(item.plan_sync_status==='failed'?item.plan_sync_error:item.sync_error,item.plan_sync_status==='failed'?'keyword':'composition') : null;
    item.can_edit = item.sync_status !== 'syncing' && item.status !== 'ended' && item.plan_sync_status === 'synced';
  }
  return { list, total: Number(count?.total ?? 0), page, pageSize };
}

export async function getComposition(user: AuthUser, id: string) {
  if (isDevDemoAuthUser(user)) {
    return {
      id,
      planId: '10001',
      ownerId: DEV_DEMO_USER_IDS.creator,
      mediaType: 'KOC视频号',
      mediaAccount: 'creator_demo',
      compositionType: 1,
      compositionSubType: 1,
      title: '知乎故事推广演示作品',
      promoUrl: 'https://www.zhihu.com',
      releaseTime: new Date(Date.now() - 86_400_000).toISOString(),
      status: 'active',
      rejectReason: null,
      syncStatus: 'synced',
      zhihuStatusJson: { auditStatus: 'approved' },
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    };
  }

  const scope = scopeFilter(user, 'c.owner_id');
  const [item] = await rows<ItemRow>(`SELECT c.* FROM compositions c WHERE c.id = ? AND ${scope.clause} LIMIT 1`, [
    id,
    ...scope.bindings,
  ]);
  if (!item) throw new AppError(404, 40401, '作品不存在');
  return item;
}

export async function insertComposition(user: AuthUser, input: CompositionInput, connection: PoolConnection, expectedOwnerId?: string) {
  const problem=compositionLinkProblem(input.mediaType,input.promoUrl);if(problem)throw new AppError(422,42200,problem);
  const ownerId = await planOwner(user, input.planId, connection,input.releaseTime);
  if (expectedOwnerId !== undefined && ownerId !== expectedOwnerId) throw new AppError(409,40900,'关键词归属刚发生变化，请刷新预览后重试');
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
  if (isDevDemoAuthUser(user)) return { id: `composition-demo-${Date.now()}`, syncStatus: 'local' };

  const id = await withTransaction(async (connection) => {
    const value = await insertComposition(user, input, connection);
    await writeAudit(
      {
        userId: user.sub,
        action: 'composition.create',
        resourceType: 'composition',
        resourceId: value,
        ip,
      },
      connection,
    );
    return value;
  });
  await enqueue('push-composition', { compositionId: id }, syncJobOptions(`composition-${id}`));
  return { id, syncStatus: 'local' };
}

export async function createCompositionBatch(user: AuthUser, items: CompositionInput[], ip?: string) {
  if (isDevDemoAuthUser(user)) return { ids: items.map((_, index) => `composition-demo-${Date.now()}-${index}`), count: items.length, syncStatus: 'local' };

  const ids = await withTransaction(async (connection) => {
    const created: string[] = [];
    for (const item of items) created.push(await insertComposition(user, item, connection));
    await writeAudit(
      {
        userId: user.sub,
        action: 'composition.batch_create',
        resourceType: 'composition',
        detail: { count: created.length },
        ip,
      },
      connection,
    );
    return created;
  });
  for (const id of ids) {
    await enqueue('push-composition', { compositionId: id }, syncJobOptions(`composition-${id}`));
  }
  return { ids, count: ids.length, syncStatus: 'local' };
}

export async function updateComposition(user: AuthUser, id: string, patch: Record<string, unknown>, ip?: string) {
  if (isDevDemoAuthUser(user)) return getComposition(user, id);

  const existing = (await getComposition(user, id)) as ItemRow & {
    composition_type: number;
    composition_sub_type: number;
  };
  const nextType =
    patch.compositionType === undefined ? Number(existing.composition_type) : Number(patch.compositionType);
  const nextSubType =
    patch.compositionSubType === undefined ? Number(existing.composition_sub_type) : Number(patch.compositionSubType);
  if (!isCompositionCategoryValid(nextType, nextSubType)) {
    throw new AppError(422, 42200, '作品分类组合不正确');
  }
  const mapping: Record<string, string> = {
    mediaType: 'media_type',
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
    const access=scopeFilter(user,'owner_id');
    const [locked]=await connection.query<ItemRow[]>(`SELECT * FROM compositions WHERE id=? AND ${access.clause} FOR UPDATE`,[id,...access.bindings]);
    const current=locked[0];if(!current)throw new AppError(404,40401,'作品不存在');
    if(current.sync_status==='syncing')throw new AppError(409,40900,'作品正在提交，请稍后修改');
    if(current.status==='ended')throw new AppError(409,40900,'作品已结束');
    const problem=compositionLinkProblem(String(patch.mediaType??current.media_type),String(patch.promoUrl??current.promo_url));
    if(problem)throw new AppError(422,42200,problem);
    if(patch.releaseTime===null)throw new AppError(422,42200,'请填写作品发布时间');
    const owner=await planOwner(user,String(current.plan_id),connection,patch.releaseTime===undefined?undefined:String(patch.releaseTime));
    if(owner!==String(current.owner_id))throw new AppError(409,40900,'作品归属已变化，请刷新后重试');
    if(!isCompositionCategoryValid(Number(patch.compositionType??current.composition_type),Number(patch.compositionSubType??current.composition_sub_type)))throw new AppError(422,42200,'作品分类组合不正确');
    await connection.query(`UPDATE zh_evidence e JOIN zh_keyword_bindings b ON b.id=e.binding_id JOIN zh_keywords k ON k.id=b.keyword_id
      SET e.work_url=?,e.description=IF(?,?,e.description) WHERE k.plan_id=? AND b.executor_id=? AND BINARY e.work_url=BINARY ?`,[patch.promoUrl??current.promo_url,Object.hasOwn(patch,'title'),patch.title??'',current.plan_id,current.owner_id,current.promo_url]);
    await connection.query(`UPDATE compositions SET ${fields.join(', ')}, sync_status = 'local',sync_error=NULL,zhihu_status_json=NULL,status='pending',reject_reason=NULL WHERE id = ?`, [
      ...bindings,
      id,
    ]);
    await writeAudit(
      {
        userId: user.sub,
        action: 'composition.update',
        resourceType: 'composition',
        resourceId: id,
        detail: patch,
        ip,
      },
      connection,
    );
  });
  await enqueue(
    'push-composition',
    { compositionId: id },
    syncJobOptions(`composition-update-${id}-${stableHash(patch)}`),
  );
  return getComposition(user, id);
}
