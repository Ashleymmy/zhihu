import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { db, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { sendRegistrationSms } from './aliyun';
import { requireSmsEnabled, SMS_MAX_ATTEMPTS, SMS_RETRY_SECONDS, SMS_TTL_SECONDS } from './config';

const mac = (secret: string, ...values: string[]) =>
  createHmac('sha256', secret).update(JSON.stringify(values)).digest('hex');
const invalid = () => new AppError(422, 42220, '验证码错误、已过期或已使用，请检查后重试');
type Proof = { phoneHash: string; identityHash: string; challengeId: string; codeHash: string };

async function reserveLimit(c: PoolConnection, key: string, window: number, limit: number, now: number) {
  const bucket = Math.floor((now + (window === 86400 ? 28800 : 0)) / window);
  // One counter shared by all processes; database failure must never fall back to unlimited sends.
  await c.query(
    `INSERT INTO sms_registration_limits(limit_key,bucket,count,expires_at)
    VALUES(?,?,1,TIMESTAMPADD(SECOND,?,NOW(3)))
    ON DUPLICATE KEY UPDATE count=count+1`,
    [key, bucket, window * 2],
  );
  const [[row]] = await c.query<RowDataPacket[]>(
    'SELECT count FROM sms_registration_limits WHERE limit_key=? AND bucket=? FOR UPDATE',
    [key, bucket],
  );
  if (Number(row.count) > limit) throw new AppError(429, 42920, '验证码发送过于频繁或今日额度已用完，请稍后再试');
}

export async function sendRegistrationCode(phone: string, identityHash: string, invitationToken?: string) {
  const { secret, dailyLimit } = requireSmsEnabled(invitationToken);
  const phoneHash = mac(secret, 'phone', phone),
    challengeId = randomBytes(16).toString('hex');
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const codeHash = mac(secret, 'registration', challengeId, phoneHash, identityHash, code);
  await withTransaction(async (c) => {
    const [[clock]] = await c.query<RowDataPacket[]>('SELECT UNIX_TIMESTAMP(NOW(3)) stamp');
    const now = Number(clock.stamp);
    // A consistent global→identity→phone lock order prevents concurrent quota overspending.
    await reserveLimit(c, mac(secret, 'global-day'), 86400, dailyLimit, now);
    await reserveLimit(c, mac(secret, 'identity-day', identityHash), 86400, 10, now);
    await reserveLimit(c, mac(secret, 'identity-minute', identityHash), 60, 1, now);
    await reserveLimit(c, mac(secret, 'phone-day', phoneHash), 86400, 5, now);
    const [[previous]] = await c.query<RowDataPacket[]>(
      'SELECT TIMESTAMPDIFF(SECOND,created_at,NOW(3)) age FROM sms_registration_challenges WHERE phone_hash=? FOR UPDATE',
      [phoneHash],
    );
    if (previous && Number(previous.age) < SMS_RETRY_SECONDS)
      throw new AppError(429, 42920, '请在上次发送 60 秒后重试');
    await c.query(
      `INSERT INTO sms_registration_challenges(phone_hash,challenge_id,identity_hash,code_hash,state,attempts,expires_at)
      VALUES(?,?,?,?,'pending',0,TIMESTAMPADD(SECOND,?,NOW(3)))
      ON DUPLICATE KEY UPDATE challenge_id=VALUES(challenge_id),identity_hash=VALUES(identity_hash),code_hash=VALUES(code_hash),
        state='pending',attempts=0,expires_at=VALUES(expires_at),created_at=NOW(3)`,
      [phoneHash, challengeId, identityHash, codeHash, SMS_TTL_SECONDS],
    );
  });
  try {
    await sendRegistrationSms(phone, code, invitationToken);
    const [result] = await db.query<ResultSetHeader>(
      "UPDATE sms_registration_challenges SET state='sent' WHERE phone_hash=? AND challenge_id=? AND state='pending' AND expires_at>NOW(3)",
      [phoneHash, challengeId],
    );
    if (result.affectedRows !== 1) throw new AppError(503, 50321, '验证码发送状态已变化，请稍后重试');
  } catch (error) {
    await db.query("UPDATE sms_registration_challenges SET state='failed' WHERE phone_hash=? AND challenge_id=?", [
      phoneHash,
      challengeId,
    ]);
    throw error;
  }
  // Retain neither expired challenges nor unbounded rate-limit history.
  await db.query('DELETE FROM sms_registration_challenges WHERE expires_at<DATE_SUB(NOW(3),INTERVAL 1 DAY) LIMIT 100');
  await db.query('DELETE FROM sms_registration_limits WHERE expires_at<NOW(3) LIMIT 100');
  return { retryAfterSeconds: SMS_RETRY_SECONDS, expiresInSeconds: SMS_TTL_SECONDS };
}

export async function verifyRegistrationCode(
  phone: string,
  identityHash: string,
  code: string,
  invitationToken?: string,
): Promise<Proof> {
  const { secret } = requireSmsEnabled(invitationToken);
  const phoneHash = mac(secret, 'phone', phone);
  const proof = await withTransaction(async (c) => {
    const [[row]] = await c.query<RowDataPacket[]>(
      'SELECT *,expires_at>NOW(3) fresh FROM sms_registration_challenges WHERE phone_hash=? FOR UPDATE',
      [phoneHash],
    );
    if (
      !row ||
      row.state !== 'sent' ||
      !row.fresh ||
      row.identity_hash !== identityHash ||
      row.attempts >= SMS_MAX_ATTEMPTS
    )
      return null;
    const codeHash = mac(secret, 'registration', row.challenge_id, phoneHash, identityHash, code);
    if (!timingSafeEqual(Buffer.from(codeHash, 'hex'), Buffer.from(row.code_hash, 'hex'))) {
      // Commit failed attempts even though the HTTP request fails.
      await c.query('UPDATE sms_registration_challenges SET attempts=attempts+1 WHERE phone_hash=?', [phoneHash]);
      return null;
    }
    return { phoneHash, identityHash, challengeId: String(row.challenge_id), codeHash };
  });
  if (!proof) throw invalid();
  return proof;
}

export async function consumeRegistrationCode(c: PoolConnection, proof: Proof, userId: string) {
  // Same transaction as user creation, invitation use and WeChat binding. Resends/expiry/races rechecked here.
  const [used] = await c.query<ResultSetHeader>(
    `UPDATE sms_registration_challenges SET state='consumed'
    WHERE phone_hash=? AND challenge_id=? AND identity_hash=? AND code_hash=? AND state='sent' AND attempts<? AND expires_at>NOW(3)`,
    [proof.phoneHash, proof.challengeId, proof.identityHash, proof.codeHash, SMS_MAX_ATTEMPTS],
  );
  if (used.affectedRows !== 1) throw invalid();
  await c.query('UPDATE users SET phone_verified_at=NOW(3) WHERE id=?', [userId]);
}
