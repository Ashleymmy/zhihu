import { randomInt } from 'node:crypto';
import type { PoolConnection, Connection, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../middleware/errors';

type ConnectionLike = PoolConnection | Connection;
export function isReservedUserId(identifier: string): boolean {
  return /^(?:timo\d{6}$|TIMO-)/i.test(identifier);
}

/** Only migration may derive a legacy alias from an internal key. */
export function legacyUserId(id: string | number): string {
  const digits = String(id);
  if (!/^[1-9]\d{0,5}$/.test(digits)) throw new Error('Legacy user ID exceeds the former six-digit namespace');
  return 'timo' + digits.padStart(6, '0');
}
export function randomUserId(): string {
  return 'timo' + String(randomInt(1, 1000000)).padStart(6, '0');
}

async function reserveAlias(c: ConnectionLike, id: string, identifier: string) {
  const [[other]] = await c.query<RowDataPacket[]>('SELECT id FROM users WHERE username=? AND id<>? LIMIT 1', [identifier,id]);
  if (other) throw new Error('Legacy username conflicts with an existing user ID; migration stopped');
  await c.query("INSERT INTO user_identifiers(identifier,user_id,kind) VALUES(?,?,'legacy') ON DUPLICATE KEY UPDATE identifier=identifier", [identifier, id]);
  const [[row]] = await c.query<RowDataPacket[]>('SELECT user_id FROM user_identifiers WHERE identifier=?', [identifier]);
  if (String(row.user_id) !== id) throw new Error('User identifier namespace conflict; migration stopped');
}

/** Caller owns a transaction. The user lock and both unique keys serialize allocation. */
export async function assignUserId(c: ConnectionLike, id: string, candidate = randomUserId): Promise<string> {
  const [[user]] = await c.query<RowDataPacket[]>('SELECT id FROM users WHERE id=? FOR UPDATE', [id]);
  if (!user) throw new AppError(404, 40401, '账号不存在');
  const [[existing]] = await c.query<RowDataPacket[]>('SELECT identifier FROM user_identifiers WHERE public_user=?', [id]);
  if (existing) return String(existing.identifier);
  for (let attempt = 0; attempt < 64; attempt++) {
    const identifier = candidate();
    if (!/^timo\d{6}$/.test(identifier) || identifier === 'timo000000') throw new Error('Invalid public user ID candidate');
    const [[username]] = await c.query<RowDataPacket[]>('SELECT id FROM users WHERE username=? LIMIT 1', [identifier]);
    if (username) continue;
    try {
      await c.query("INSERT INTO user_identifiers(identifier,user_id,kind) VALUES(?,?,'public')", [identifier, id]);
      return identifier;
    } catch (error) {
      if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
    }
  }
  throw new AppError(503, 50300, '用户 ID 暂时无法分配，请稍后重试');
}

/** Backfill old/out-of-band accounts. Reserve ALL old aliases before drawing any new IDs. */
export async function backfillUserIds(c: ConnectionLike, ids?: string[]) {
  if (ids && !ids.length) return [];
  const [users] = await c.query<RowDataPacket[]>(
    `SELECT CAST(u.id AS CHAR) id,u.username FROM users u
     WHERE NOT EXISTS(SELECT 1 FROM user_identifiers i WHERE i.public_user=u.id)
     ${ids ? 'AND u.id IN (?)' : ''} ORDER BY u.id FOR UPDATE`, ids ? [ids] : [],
  );
  for (const user of users) {
    const id = String(user.id);
    await reserveAlias(c, id, legacyUserId(id));
    await reserveAlias(c, id, 'timo-' + id);
  }
  const changes: { id: string; oldId: string; userId: string; usernameChanged: boolean }[] = [];
  for (const user of users) {
    const id = String(user.id), oldId = legacyUserId(id), userId = await assignUserId(c, id);
    const usernameChanged = [oldId, 'timo-' + id].includes(String(user.username).toLowerCase());
    if (usernameChanged) await c.query('UPDATE users SET username=? WHERE id=?', [userId, id]);
    changes.push({ id, oldId, userId, usernameChanged });
  }
  return changes;
}

export async function userIdMap(c: ConnectionLike, rawIds: unknown[]): Promise<Map<string, string>> {
  const ids = [...new Set(rawIds.filter(v => v != null && v !== '').map(String))];
  if (!ids.length) return new Map();
  let [found] = await c.query<RowDataPacket[]>('SELECT CAST(user_id AS CHAR) id,identifier FROM user_identifiers WHERE public_user IN (?)', [ids]);
  const foundIds = new Set(found.map(r => String(r.id)));
  const missing = ids.filter(id => !foundIds.has(id));
  if (missing.length) {
    // Existing provisioning scripts and staged deployments may still insert old-style accounts.
    await backfillUserIds(c, missing);
    [found] = await c.query<RowDataPacket[]>('SELECT CAST(user_id AS CHAR) id,identifier FROM user_identifiers WHERE public_user IN (?)', [ids]);
  }
  if (found.length !== ids.length) throw new AppError(409, 40900, '成员资料已变化，请刷新后重试');
  return new Map(found.map(r => [String(r.id), String(r.identifier)]));
}

/** Never decode the digits of a public ID as a database key. */
export async function resolveUserIdentifier(c: ConnectionLike, identifier: string): Promise<string | undefined> {
  const [found] = await c.query<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) id FROM users WHERE username=?
     UNION SELECT CAST(user_id AS CHAR) id FROM user_identifiers WHERE identifier=? AND user_id IS NOT NULL`,
    [identifier, identifier],
  );
  if (found.length > 1) throw new AppError(409, 40900, '账号标识有冲突，请使用已验证手机号登录');
  return found[0] ? String(found[0].id) : undefined;
}
