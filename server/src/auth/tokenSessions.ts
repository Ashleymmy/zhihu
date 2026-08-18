import crypto from 'node:crypto';
import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { config } from '../config';

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

const hashToken = (plain: string) => crypto.createHash('sha256').update(plain, 'utf8').digest();

const refreshTtlMs = () => config.auth.refreshTtlDays * 24 * 60 * 60 * 1000;

async function insertSession(
  connection: PoolConnection,
  userId: string,
  familyId: string,
  rotatedFromId: string | null,
): Promise<RefreshSession> {
  const tokenId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  const refreshToken = `${tokenId}.${secret}`;
  const expiresAt = new Date(Date.now() + refreshTtlMs());
  await connection.query<ResultSetHeader>(
    `INSERT INTO token_sessions (user_id, family_id, token_id, refresh_token_hash, rotated_from_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, familyId, tokenId, hashToken(refreshToken), rotatedFromId, expiresAt],
  );
  return { userId, familyId, refreshToken, expiresAt };
}

/** 登录成功后签发新的 Refresh Token family。 */
export async function issueRefreshSession(userId: string): Promise<RefreshSession> {
  const familyId = crypto.randomUUID();
  return withTransaction((connection) => insertSession(connection, userId, familyId, null));
}

async function revokeFamilyWithConnection(connection: PoolConnection, familyId: string, reason: string) {
  await connection.query(
    `UPDATE token_sessions SET revoked_at = NOW(3), revoke_reason = ? WHERE family_id = ? AND revoked_at IS NULL`,
    [reason, familyId],
  );
}

/**
 * 单次轮换：旧 Token 必须有效且未使用过。
 * 检测到已撤销 Token 复用时，撤销整个 family 并拒绝。
 */
export async function rotateRefreshSession(plainToken: string): Promise<RefreshSession> {
  const separator = plainToken.indexOf('.');
  const tokenId = separator > 0 ? plainToken.slice(0, separator) : '';
  if (!/^[0-9a-f-]{36}$/.test(tokenId)) throw new AppError(401, 40104, '登录已过期，请重新登录');

  return withTransaction(async (connection) => {
    const [found] = await connection.query<SessionRow[]>(
      'SELECT * FROM token_sessions WHERE token_id = ? LIMIT 1 FOR UPDATE',
      [tokenId],
    );
    const session = found[0];
    if (!session || !hashToken(plainToken).equals(session.refresh_token_hash)) {
      throw new AppError(401, 40104, '登录已过期，请重新登录');
    }
    if (session.revoked_at) {
      // 已轮换/已撤销的 Token 再次出现即视为泄露，撤销整个 family。
      await revokeFamilyWithConnection(connection, session.family_id, 'reuse_detected');
      await connection.query('UPDATE token_sessions SET reuse_detected_at = NOW(3) WHERE id = ?', [session.id]);
      throw new AppError(401, 40105, '会话安全异常，请重新登录');
    }
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      throw new AppError(401, 40104, '登录已过期，请重新登录');
    }
    await connection.query(
      `UPDATE token_sessions SET revoked_at = NOW(3), revoke_reason = 'rotated', last_used_at = NOW(3) WHERE id = ?`,
      [session.id],
    );
    return insertSession(connection, String(session.user_id), session.family_id, String(session.id));
  });
}

/** 根据 Refresh Token 撤销其所属 family（logout）。找不到时静默成功。 */
export async function revokeRefreshFamily(plainToken: string, reason = 'logout'): Promise<void> {
  const separator = plainToken.indexOf('.');
  const tokenId = separator > 0 ? plainToken.slice(0, separator) : '';
  if (!/^[0-9a-f-]{36}$/.test(tokenId)) return;
  const found = await rows<SessionRow>('SELECT family_id FROM token_sessions WHERE token_id = ? LIMIT 1', [tokenId]);
  if (!found[0]) return;
  await withTransaction((connection) => revokeFamilyWithConnection(connection, found[0].family_id, reason));
}

/** 撤销用户全部会话（改密、封禁）。 */
export async function revokeUserSessions(userId: string, reason: string): Promise<void> {
  await withTransaction(async (connection) => {
    await connection.query(
      'UPDATE token_sessions SET revoked_at = NOW(3), revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL',
      [reason, userId],
    );
  });
}
