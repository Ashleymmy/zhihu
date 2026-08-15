import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { encryptSecret, generateCallbackSecret } from '../utils/secretCrypto';
import { pageOffset } from '../utils/pagination';
import { scopeFilter } from '../utils/scopeFilter';
import { writeAudit } from './audit.service';
import { config } from '../config';

interface CountRow extends RowDataPacket { total: number }
interface RuleRow extends RowDataPacket { id: string; owner_id: string; events_json: string | unknown[] }

export async function listRules(user: AuthUser, query: Record<string, unknown>) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  const scope = scopeFilter(user, 'r.owner_id');
  const [count] = await rows<CountRow>(
    `SELECT COUNT(*) total FROM callback_rules r WHERE ${scope.clause}`,
    scope.bindings,
  );
  const list = await rows<RuleRow>(
    `SELECT r.*, p.name plan_name
     FROM callback_rules r
     LEFT JOIN plans p ON p.id = r.plan_id
     WHERE ${scope.clause}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [...scope.bindings, pageSize, pageOffset(page, pageSize)],
  );
  return {
    list: list.map((item) => ({
      ...item,
      events_json: typeof item.events_json === 'string'
        ? JSON.parse(item.events_json)
        : item.events_json,
    })),
    total: Number(count?.total ?? 0),
    page,
    pageSize,
  };
}

export async function createRule(
  user: AuthUser,
  input: { planId: string; callbackUrl: string; events: string[]; status?: 'active' | 'inactive' },
  ip?: string,
) {
  const [plan] = await rows<RowDataPacket & { owner_id: string }>(
    'SELECT owner_id FROM plans WHERE id = ? LIMIT 1',
    [input.planId],
  );
  if (!plan) throw new AppError(404, 40401, '推广计划不存在');
  const id = await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO callback_rules
        (project_id, plan_id, owner_id, callback_url, events_json, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        config.defaultProjectId,
        input.planId,
        plan.owner_id,
        input.callbackUrl,
        JSON.stringify(input.events),
        input.status ?? 'active',
        user.sub,
      ],
    );
    const value = String(result.insertId);
    await writeAudit({
      userId: user.sub,
      action: 'callback.rule_create',
      resourceType: 'callback_rule',
      resourceId: value,
      ip,
    }, connection);
    return value;
  });
  return { id };
}

export async function updateRule(
  user: AuthUser,
  id: string,
  patch: { callbackUrl?: string; events?: string[]; status?: 'active' | 'inactive' },
  ip?: string,
) {
  const [rule] = await rows<RuleRow>('SELECT * FROM callback_rules WHERE id = ? LIMIT 1', [id]);
  if (!rule) throw new AppError(404, 40401, '回传规则不存在');
  const fields: string[] = [];
  const bindings: unknown[] = [];
  if (patch.callbackUrl !== undefined) { fields.push('callback_url = ?'); bindings.push(patch.callbackUrl); }
  if (patch.events !== undefined) { fields.push('events_json = ?'); bindings.push(JSON.stringify(patch.events)); }
  if (patch.status !== undefined) { fields.push('status = ?'); bindings.push(patch.status); }
  if (!fields.length) throw new AppError(422, 42200, '没有可修改的字段');
  await withTransaction(async (connection) => {
    await connection.query(`UPDATE callback_rules SET ${fields.join(', ')} WHERE id = ?`, [...bindings, id]);
    await writeAudit({
      userId: user.sub,
      action: 'callback.rule_update',
      resourceType: 'callback_rule',
      resourceId: id,
      detail: patch,
      ip,
    }, connection);
  });
  return { id };
}

export async function deleteRule(user: AuthUser, id: string, ip?: string) {
  const [rule] = await rows<RuleRow>('SELECT id FROM callback_rules WHERE id = ? LIMIT 1', [id]);
  if (!rule) throw new AppError(404, 40401, '回传规则不存在');
  await withTransaction(async (connection) => {
    await connection.query("UPDATE callback_rules SET status = 'inactive' WHERE id = ?", [id]);
    await writeAudit({
      userId: user.sub,
      action: 'callback.rule_delete',
      resourceType: 'callback_rule',
      resourceId: id,
      ip,
    }, connection);
  });
}

export async function getSecret() {
  const [secret] = await rows<RowDataPacket & { last_four: string }>(
    'SELECT last_four FROM callback_secrets WHERE project_id = ? LIMIT 1',
    [config.defaultProjectId],
  );
  if (!secret) throw new AppError(404, 40402, '尚未生成回传秘钥');
  return { signKey: `sk_live_****${secret.last_four}` };
}

export async function rotateSecret(user: AuthUser, ip?: string) {
  const secret = generateCallbackSecret();
  const value = encryptSecret(secret);
  await withTransaction(async (connection) => {
    await connection.query(
      `INSERT INTO callback_secrets
        (project_id, secret_ciphertext, secret_iv, secret_auth_tag, last_four, rotated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        secret_ciphertext = VALUES(secret_ciphertext),
        secret_iv = VALUES(secret_iv),
        secret_auth_tag = VALUES(secret_auth_tag),
        last_four = VALUES(last_four),
        rotated_by = VALUES(rotated_by),
        rotated_at = NOW()`,
      [config.defaultProjectId, value.ciphertext, value.iv, value.authTag, value.lastFour, user.sub],
    );
    await writeAudit({
      userId: user.sub,
      action: 'callback.secret_rotate',
      resourceType: 'project',
      resourceId: String(config.defaultProjectId),
      ip,
    }, connection);
  });
  return { signKey: `sk_live_****${value.lastFour}` };
}

export async function listLogs(user: AuthUser, query: Record<string, unknown>) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  const scope = scopeFilter(user, 'l.owner_id');
  const where = [scope.clause];
  const bindings: unknown[] = [...scope.bindings];
  if (query.status) { where.push('l.status = ?'); bindings.push(query.status); }
  const clause = where.join(' AND ');
  const [count] = await rows<CountRow>(
    `SELECT COUNT(*) total FROM callback_logs l WHERE ${clause}`,
    bindings,
  );
  const list = await rows(
    `SELECT l.* FROM callback_logs l
     WHERE ${clause}
     ORDER BY l.created_at DESC
     LIMIT ? OFFSET ?`,
    [...bindings, pageSize, pageOffset(page, pageSize)],
  );
  return { list, total: Number(count?.total ?? 0), page, pageSize };
}
