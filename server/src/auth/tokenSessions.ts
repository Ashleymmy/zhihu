import crypto from 'node:crypto';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { config } from '../config';
import { clientIdHash, type ClientIdentity } from './clientIdentity';

export interface RefreshSession {
  userId: string;
  familyId: string;
  refreshToken: string;
  expiresAt: Date;
}
interface SessionRow extends RowDataPacket {
  id: string;
  user_id: string;
  family_id: string;
  token_id: string;
  refresh_token_hash: Buffer;
  expires_at: Date;
  revoked_at: Date | null;
}
const hashToken = (plain: string) => crypto.createHash('sha256').update(plain).digest();
const expires = () => new Date(Date.now() + config.auth.refreshTtlDays * 86400000);
const expired = () => new AppError(401, 40104, '登录已过期或已在其他设备登录，请重新登录');
const tokenIdOf = (plain: string) => plain.split('.')[0];

async function insertSession(
  c: PoolConnection,
  userId: string,
  familyId: string,
  rotatedFromId: string | null,
): Promise<RefreshSession> {
  const tokenId = crypto.randomUUID(),
    refreshToken = `${tokenId}.${crypto.randomBytes(32).toString('base64url')}`,
    expiresAt = expires();
  await c.query(
    `INSERT INTO token_sessions (user_id,family_id,token_id,refresh_token_hash,rotated_from_id,expires_at) VALUES (?,?,?,?,?,?)`,
    [userId, familyId, tokenId, hashToken(refreshToken), rotatedFromId, expiresAt],
  );
  await c.query('UPDATE login_sessions SET expires_at=? WHERE id=?', [expiresAt, familyId]);
  return { userId, familyId, refreshToken, expiresAt };
}

/** Serialize logins and refreshes on the user row so concurrent requests cannot exceed a slot. */
export async function issueRefreshSession(
  userId: string,
  client: ClientIdentity = { type: 'web', id: crypto.randomUUID() },
  expectedPasswordHash?: string,
): Promise<RefreshSession> {
  return withTransaction(async (c) => {
    const [[user]] = await c.query<RowDataPacket[]>(
      'SELECT role,is_active,password_hash FROM users WHERE id=? FOR UPDATE',
      [userId],
    );
    if (!user?.is_active || (expectedPasswordHash && user.password_hash !== expectedPasswordHash)) throw expired();
    if (user.role !== 'developer') {
      await c.query(
        `UPDATE token_sessions t JOIN login_sessions s ON s.id=t.family_id SET t.revoked_at=NOW(3),t.revoke_reason='device_replaced' WHERE s.user_id=? AND s.client_type=? AND t.revoked_at IS NULL`,
        [userId, client.type],
      );
      await c.query(
        "UPDATE login_sessions SET revoked_at=NOW(3),revoke_reason='device_replaced' WHERE user_id=? AND client_type=? AND revoked_at IS NULL",
        [userId, client.type],
      );
    }
    const familyId = crypto.randomUUID();
    await c.query('INSERT INTO login_sessions(id,user_id,client_type,client_id_hash,expires_at) VALUES(?,?,?,?,?)', [
      familyId,
      userId,
      client.type,
      clientIdHash(client.id),
      expires(),
    ]);
    return insertSession(c, userId, familyId, null);
  });
}

async function revokeFamily(c: PoolConnection, familyId: string, reason: string) {
  await c.query(
    'UPDATE token_sessions SET revoked_at=NOW(3),revoke_reason=? WHERE family_id=? AND revoked_at IS NULL',
    [reason, familyId],
  );
  await c.query('UPDATE login_sessions SET revoked_at=NOW(3),revoke_reason=? WHERE id=? AND revoked_at IS NULL', [
    reason,
    familyId,
  ]);
}

export async function assertLoginSession(userId: string, sessionId: string | undefined, client: ClientIdentity) {
  if (!sessionId) throw expired();
  const [found] = await rows<RowDataPacket>(
    'SELECT id FROM login_sessions WHERE id=? AND user_id=? AND client_type=? AND client_id_hash=? AND revoked_at IS NULL AND expires_at>NOW(3)',
    [sessionId, userId, client.type, clientIdHash(client.id)],
  );
  if (!found) throw expired();
}

export async function rotateRefreshSession(plainToken: string, client?: ClientIdentity): Promise<RefreshSession> {
  const tokenId = tokenIdOf(plainToken);
  if (!/^[0-9a-f-]{36}$/.test(tokenId) || !client) throw expired();
  const [lookup] = await rows<SessionRow>('SELECT user_id FROM token_sessions WHERE token_id=? LIMIT 1', [tokenId]);
  if (!lookup) throw expired();
  const result = await withTransaction(async (c) => {
    const [[user]] = await c.query<RowDataPacket[]>('SELECT is_active FROM users WHERE id=? FOR UPDATE', [
      lookup.user_id,
    ]);
    if (!user?.is_active) return { error: expired() };
    const [[session]] = await c.query<SessionRow[]>(
      'SELECT * FROM token_sessions WHERE token_id=? LIMIT 1 FOR UPDATE',
      [tokenId],
    );
    if (!session || !hashToken(plainToken).equals(session.refresh_token_hash)) return { error: expired() };
    const [[login]] = await c.query<RowDataPacket[]>(
      'SELECT * FROM login_sessions WHERE id=? AND user_id=? FOR UPDATE',
      [session.family_id, session.user_id],
    );
    if (!login || login.client_type !== client.type || login.client_id_hash !== clientIdHash(client.id))
      return { error: expired() };
    if (session.revoked_at) {
      await revokeFamily(c, session.family_id, 'reuse_detected');
      await c.query('UPDATE token_sessions SET reuse_detected_at=NOW(3) WHERE id=?', [session.id]);
      // Return the error; throwing inside the transaction would roll back revocation.
      return { error: new AppError(401, 40105, '会话安全异常，请重新登录') };
    }
    if (
      login.revoked_at ||
      new Date(session.expires_at).getTime() <= Date.now() ||
      new Date(login.expires_at).getTime() <= Date.now()
    )
      return { error: expired() };
    await c.query(
      "UPDATE token_sessions SET revoked_at=NOW(3),revoke_reason='rotated',last_used_at=NOW(3) WHERE id=?",
      [session.id],
    );
    return { session: await insertSession(c, String(session.user_id), session.family_id, String(session.id)) };
  });
  if (result.error) throw result.error;
  return result.session!;
}

export async function revokeLoginSession(userId: string, familyId: string, reason = 'logout') {
  await withTransaction(async (c) => {
    await c.query('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
    const [[session]] = await c.query<RowDataPacket[]>('SELECT id FROM login_sessions WHERE id=? AND user_id=?', [
      familyId,
      userId,
    ]);
    if (session) await revokeFamily(c, familyId, reason);
  });
}

export async function revokeRefreshFamily(plainToken: string, reason = 'logout'): Promise<void> {
  const [session] = await rows<SessionRow>('SELECT * FROM token_sessions WHERE token_id=? LIMIT 1', [
    tokenIdOf(plainToken),
  ]);
  if (session && hashToken(plainToken).equals(session.refresh_token_hash))
    await revokeLoginSession(String(session.user_id), session.family_id, reason);
}

export async function revokeUserSessions(userId: string, reason: string): Promise<void> {
  await withTransaction(async (c) => {
    await c.query('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
    await c.query(
      'UPDATE token_sessions SET revoked_at=NOW(3),revoke_reason=? WHERE user_id=? AND revoked_at IS NULL',
      [reason, userId],
    );
    await c.query(
      'UPDATE login_sessions SET revoked_at=NOW(3),revoke_reason=? WHERE user_id=? AND revoked_at IS NULL',
      [reason, userId],
    );
  });
}
