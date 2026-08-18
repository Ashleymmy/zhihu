import { RowDataPacket } from 'mysql2/promise';
import { db, rows, withTransaction } from '../db';
import { enqueue } from '../queue';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { pageOffset } from '../utils/pagination';
import { scopeFilter } from '../utils/scopeFilter';
import { writeAudit } from './audit.service';
interface CountRow extends RowDataPacket {
  total: number;
}
export function channelVisibility(user: AuthUser) {
  if (user.role === 'creator') {
    return {
      clause:
        "(c.owner_id=? OR c.owner_id=? OR EXISTS (SELECT 1 FROM plans p WHERE p.channel_id=c.zhihu_channel_id AND p.owner_id=? AND p.status<>'ended'))",
      bindings: [user.sub, user.parentId, user.sub],
    };
  }
  if (user.role === 'leader') {
    const scope = scopeFilter(user, 'p.owner_id');
    return {
      clause: `(c.owner_id IN (SELECT id FROM users WHERE parent_id=? OR id=?) OR EXISTS (SELECT 1 FROM plans p WHERE p.channel_id=c.zhihu_channel_id AND ${scope.clause} AND p.status<>'ended'))`,
      bindings: [user.sub, user.sub, ...scope.bindings],
    };
  }
  return { clause: '1=1', bindings: [] };
}
export async function listChannels(user: AuthUser, query: Record<string, unknown>) {
  const page = Number(query.page ?? 1),
    pageSize = Number(query.pageSize ?? 20);
  const visibility = channelVisibility(user);
  const [count] = await rows<CountRow>(
    `SELECT COUNT(*) total FROM channels c WHERE ${visibility.clause}`,
    visibility.bindings,
  );
  const list = await rows(
    `SELECT c.* FROM channels c WHERE ${visibility.clause} ORDER BY c.generation,c.name LIMIT ? OFFSET ?`,
    [...visibility.bindings, pageSize, pageOffset(page, pageSize)],
  );
  return { list, total: Number(count?.total ?? 0), page, pageSize };
}
export async function assignChannel(user: AuthUser, id: string, ownerId: string | null, ip?: string) {
  const [channel] = await rows<RowDataPacket>('SELECT id FROM channels WHERE id=? LIMIT 1', [id]);
  if (!channel) throw new AppError(404, 40401, '渠道不存在');
  await withTransaction(async (connection) => {
    await connection.query('UPDATE channels SET owner_id=? WHERE id=?', [ownerId, id]);
    await writeAudit(
      {
        userId: user.sub,
        action: 'channel.assign_owner',
        resourceType: 'channel',
        resourceId: id,
        detail: { ownerId },
        ip,
      },
      connection,
    );
  });
  return { id, ownerId };
}
export async function requestChannelSync(user: AuthUser) {
  const job = await enqueue(
    'sync-channels',
    { requestedBy: user.sub },
    { jobId: `channels-${Math.floor(Date.now() / 60000)}` },
  );
  return { jobId: String(job.id), status: 'queued' };
}
export async function listTasks(query: Record<string, unknown>) {
  const page = Number(query.page ?? 1),
    pageSize = Number(query.pageSize ?? 20);
  const where = ['1=1'];
  const bindings: unknown[] = [];
  if (query.status) {
    where.push('status=?');
    bindings.push(query.status);
  }
  if (query.keyword) {
    where.push('name LIKE ?');
    bindings.push(`%${String(query.keyword)}%`);
  }
  const clause = where.join(' AND ');
  const [count] = await rows<CountRow>(`SELECT COUNT(*) total FROM tasks WHERE ${clause}`, bindings);
  const list = await rows(`SELECT * FROM tasks WHERE ${clause} ORDER BY start_time DESC LIMIT ? OFFSET ?`, [
    ...bindings,
    pageSize,
    pageOffset(page, pageSize),
  ]);
  return { list, total: Number(count?.total ?? 0), page, pageSize };
}
export async function getTask(id: string) {
  const [task] = await rows<RowDataPacket>('SELECT * FROM tasks WHERE id=? OR zhihu_task_id=? LIMIT 1', [id, id]);
  if (!task) throw new AppError(404, 40401, '推广任务不存在');
  return task;
}
export async function requestTaskSync(user: AuthUser, channelId?: string) {
  const scope = channelId ?? 'all';
  const job = await enqueue(
    'sync-tasks',
    { requestedBy: user.sub, channelId },
    { jobId: `tasks-${scope}-${Math.floor(Date.now() / 60000)}` },
  );
  return { jobId: String(job.id), status: 'queued' };
}
