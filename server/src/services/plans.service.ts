import crypto from 'node:crypto';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { db, rows, withTransaction } from '../db';
import { enqueue } from '../queue';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { maskName } from '../utils/maskSecret';
import { pageOffset } from '../utils/pagination';
import { scopeFilter } from '../utils/scopeFilter';
import { writeAudit } from './audit.service';

interface CountRow extends RowDataPacket { total: number }
interface PlanRow extends RowDataPacket { id: string; owner_id: string; sync_status: string; status: string }
export interface PlanInput {
  taskId: string;
  channelId: string;
  secondChannelId?: string | null;
  keyword: string;
  landingUrl: string;
  popularizeType: number;
  name?: string | null;
  dailyBudget?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  ownerId?: string;
}

const stableHash = (value: unknown) => crypto
  .createHash('sha256')
  .update(JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort()))
  .digest('hex')
  .slice(0, 16);

const syncJobOptions = (jobId: string) => ({ jobId, removeOnComplete: true, removeOnFail: true });

function translateBindingConflict(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === 'ER_DUP_ENTRY' || code === 'ER_LOCK_DEADLOCK') {
    throw new AppError(409, 40901, '该关键词已被绑定，请换一个词');
  }
  throw error;
}

export async function checkKeyword(user: AuthUser, channelId: string, keyword: string) {
  const [plan] = await rows<RowDataPacket & { id: string; owner_id: string; display_name: string }>(
    `SELECT p.id, p.owner_id, u.display_name
     FROM plans p
     JOIN users u ON u.id = p.owner_id
     WHERE p.channel_id = ? AND p.keyword = ?
     LIMIT 1`,
    [channelId, keyword],
  );
  if (!plan) return { available: true };
  const occupiedByMe = String(plan.owner_id) === user.sub;
  return {
    available: false,
    occupiedBy: maskName(plan.display_name),
    occupiedByMe,
    planId: occupiedByMe ? String(plan.id) : null,
  };
}

export async function listPlans(user: AuthUser, query: Record<string, unknown>) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  const scope = scopeFilter(user, 'p.owner_id');
  const where = [scope.clause, "p.status <> 'ended'"];
  const bindings: unknown[] = [...scope.bindings];
  for (const [sql, value] of [
    ['p.zhihu_task_id = ?', query.taskId],
    ['p.channel_id = ?', query.channelId],
    ['p.status = ?', query.status],
  ] as const) {
    if (value !== undefined && value !== '') {
      where.push(sql);
      bindings.push(value);
    }
  }
  if (query.keyword) {
    where.push('p.keyword LIKE ?');
    bindings.push(`%${String(query.keyword)}%`);
  }
  const clause = where.join(' AND ');
  const [count] = await rows<CountRow>(`SELECT COUNT(*) total FROM plans p WHERE ${clause}`, bindings);
  const list = await rows<PlanRow>(
    `SELECT p.* FROM plans p WHERE ${clause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    [...bindings, pageSize, pageOffset(page, pageSize)],
  );
  return { list, total: Number(count?.total ?? 0), page, pageSize };
}

export async function getPlan(user: AuthUser, id: string) {
  const scope = scopeFilter(user, 'p.owner_id');
  const [plan] = await rows<PlanRow>(
    `SELECT p.* FROM plans p WHERE p.id = ? AND ${scope.clause} LIMIT 1`,
    [id, ...scope.bindings],
  );
  if (!plan) throw new AppError(404, 40401, '推广计划不存在');
  return plan;
}

export async function createPlan(user: AuthUser, input: PlanInput, ip?: string) {
  const ownerId = user.role === 'boss' && input.ownerId ? input.ownerId : user.sub;
  const id = await withTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM plans WHERE channel_id = ? AND keyword = ? LIMIT 1 FOR UPDATE',
      [input.channelId, input.keyword],
    );
    if (existing.length) throw new AppError(409, 40901, '该关键词已被绑定，请换一个词');
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO plans
        (project_id, zhihu_task_id, channel_id, second_channel_id, keyword, landing_url,
         popularize_type, owner_id, created_by, name, daily_budget, start_date, end_date, sync_status)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local')`,
      [
        input.taskId,
        input.channelId,
        input.secondChannelId ?? null,
        input.keyword,
        input.landingUrl,
        input.popularizeType,
        ownerId,
        user.sub,
        input.name ?? null,
        input.dailyBudget ?? null,
        input.startDate ?? null,
        input.endDate ?? null,
      ],
    );
    const planId = String(result.insertId);
    await writeAudit({
      userId: user.sub,
      action: 'plan.create',
      resourceType: 'plan',
      resourceId: planId,
      detail: { ownerId },
      ip,
    }, connection);
    return planId;
  }).catch(translateBindingConflict);

  await enqueue('push-plan', { planId: id }, syncJobOptions(`plan-${id}`));
  return { id, syncStatus: 'local' };
}

export async function updatePlan(
  user: AuthUser,
  id: string,
  patch: { landingUrl?: string; name?: string | null; dailyBudget?: number | null },
  ip?: string,
) {
  await getPlan(user, id);
  const fields: string[] = [];
  const bindings: unknown[] = [];
  if (patch.landingUrl !== undefined) { fields.push('landing_url = ?'); bindings.push(patch.landingUrl); }
  if (patch.name !== undefined) { fields.push('name = ?'); bindings.push(patch.name); }
  if (patch.dailyBudget !== undefined) { fields.push('daily_budget = ?'); bindings.push(patch.dailyBudget); }
  if (!fields.length) throw new AppError(422, 42200, '没有可修改的字段');

  await withTransaction(async (connection) => {
    await connection.query(
      `UPDATE plans SET ${fields.join(', ')}, sync_status = 'local' WHERE id = ?`,
      [...bindings, id],
    );
    await writeAudit({
      userId: user.sub,
      action: 'plan.update',
      resourceType: 'plan',
      resourceId: id,
      detail: patch,
      ip,
    }, connection);
  });
  await enqueue(
    'push-plan',
    { planId: id },
    syncJobOptions(`plan-update-${id}-${stableHash(patch)}`),
  );
  return getPlan(user, id);
}

export async function deletePlan(user: AuthUser, id: string, ip?: string) {
  await getPlan(user, id);
  await withTransaction(async (connection) => {
    await connection.query("UPDATE plans SET status = 'ended' WHERE id = ?", [id]);
    await writeAudit({
      userId: user.sub,
      action: 'plan.delete',
      resourceType: 'plan',
      resourceId: id,
      ip,
    }, connection);
  });
}

export async function retryPlan(user: AuthUser, id: string, ip?: string) {
  const plan = await getPlan(user, id);
  if (plan.sync_status !== 'failed') {
    throw new AppError(409, 40902, '只有同步失败的计划可以重试');
  }
  await db.query("UPDATE plans SET sync_status = 'local', sync_error = NULL WHERE id = ?", [id]);
  await writeAudit({
    userId: user.sub,
    action: 'plan.retry_sync',
    resourceType: 'plan',
    resourceId: id,
    ip,
  });
  await enqueue('push-plan', { planId: id }, syncJobOptions(`plan-retry-${id}`));
  return { id, syncStatus: 'local' };
}
