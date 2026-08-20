import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { pageOffset } from '../utils/pagination';
import { writeAudit } from './audit.service';

/* ===== 操作日志（audit_logs 只读查询）===== */

export async function listAuditLogs(query: Record<string, unknown>) {
  const page = Number(query.page ?? 1);
  const pageSize = Math.min(Number(query.pageSize ?? 20), 100);
  const where: string[] = ['1=1'];
  const bindings: unknown[] = [];
  if (query.action) { where.push('a.action = ?'); bindings.push(query.action); }
  if (query.username) { where.push('u.username LIKE ?'); bindings.push(`%${query.username}%`); }
  if (query.from) { where.push('a.created_at >= ?'); bindings.push(`${query.from} 00:00:00`); }
  if (query.to) { where.push('a.created_at <= ?'); bindings.push(`${query.to} 23:59:59`); }
  const clause = where.join(' AND ');
  const [count] = await rows<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) total FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE ${clause}`,
    bindings,
  );
  const list = await rows(
    `SELECT a.id, a.action, a.resource_type, a.resource_id, a.detail_json, a.ip, a.created_at,
            u.username AS operator_username, u.display_name AS operator_name
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE ${clause} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [...bindings, pageSize, pageOffset(page, pageSize)],
  );
  return { list, total: Number(count?.total ?? 0), page, pageSize };
}

export async function listAuditActions() {
  return rows<RowDataPacket & { action: string }>(
    'SELECT DISTINCT action FROM audit_logs ORDER BY action',
  );
}

/* ===== 子账号监控：按账号聚合登录与操作行为 ===== */

export async function accountMonitor() {
  return rows(
    `SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.last_login_at,
            s.action_count_7d, s.last_action, s.last_action_at
     FROM users u
     LEFT JOIN (
       SELECT user_id,
              COUNT(*) AS action_count_7d,
              MAX(created_at) AS last_action_at,
              SUBSTRING_INDEX(GROUP_CONCAT(action ORDER BY created_at DESC), ',', 1) AS last_action
       FROM audit_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY user_id
     ) s ON s.user_id = u.id
     ORDER BY u.is_active DESC, u.last_login_at DESC`,
  );
}

/* ===== 系统公告 ===== */

export async function listAnnouncements() {
  return rows(
    `SELECT a.id, a.title, a.content, a.status, a.created_at, a.updated_at, u.display_name AS created_by_name
     FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.created_at DESC`,
  );
}

export async function activeAnnouncements() {
  return rows(
    "SELECT id, title, content, created_at FROM announcements WHERE status = 'published' ORDER BY created_at DESC LIMIT 5",
  );
}

export async function createAnnouncement(user: AuthUser, input: { title: string; content: string }, ip?: string) {
  return withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      "INSERT INTO announcements (title, content, status, created_by) VALUES (?, ?, 'published', ?)",
      [input.title, input.content, user.sub],
    );
    await writeAudit(
      { userId: user.sub, action: 'announcement.create', resourceType: 'announcement', resourceId: String(result.insertId), detail: { title: input.title }, ip },
      connection,
    );
    return { id: String(result.insertId) };
  });
}

export async function setAnnouncementStatus(user: AuthUser, id: string, status: 'published' | 'offline', ip?: string) {
  await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      'UPDATE announcements SET status = ? WHERE id = ?',
      [status, id],
    );
    if (result.affectedRows === 0) throw new AppError(404, 40401, '公告不存在');
    await writeAudit(
      { userId: user.sub, action: 'announcement.status', resourceType: 'announcement', resourceId: id, detail: { status }, ip },
      connection,
    );
  });
}

/* ===== 数据库维护 ===== */

export async function dbStats() {
  const tables = await rows<RowDataPacket & { table_name: string; table_rows: number; data_mb: number }>(
    `SELECT table_name, table_rows, ROUND((data_length + index_length) / 1024 / 1024, 2) AS data_mb
     FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY data_length DESC`,
  );
  return tables;
}

/** 清理 N 天前的操作日志 */
export async function cleanupAuditLogs(user: AuthUser, days: number, ip?: string) {
  if (!Number.isInteger(days) || days < 7 || days > 365) throw new AppError(422, 42200, '保留天数必须在 7 到 365 天之间');
  return withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      'DELETE FROM audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
      [days],
    );
    await writeAudit(
      { userId: user.sub, action: 'admin.audit_cleanup', resourceType: 'audit_logs', detail: { days, deleted: result.affectedRows }, ip },
      connection,
    );
    return { deleted: result.affectedRows };
  });
}

/* ===== 站点信息与同步状态 ===== */

export async function siteInfo() {
  const [channelSync] = await rows<RowDataPacket & { latest: string | null }>('SELECT MAX(synced_at) AS latest FROM channels');
  const [taskSync] = await rows<RowDataPacket & { latest: string | null }>('SELECT MAX(synced_at) AS latest FROM tasks');
  const [metricSync] = await rows<RowDataPacket & { latest: string | null }>('SELECT MAX(fetched_at) AS latest FROM daily_metrics');
  return {
    node: process.version,
    uptimeSec: Math.floor(process.uptime()),
    zhihuApiBase: process.env.ZHIHU_API_BASE ?? '',
    zhihuCredentialMode: process.env.ZHIHU_ACCESS_TOKEN && !process.env.ZHIHU_ACCESS_TOKEN.startsWith('mock') ? 'real' : 'mock',
    sync: {
      channels: channelSync?.latest ?? null,
      tasks: taskSync?.latest ?? null,
      metrics: metricSync?.latest ?? null,
    },
  };
}
