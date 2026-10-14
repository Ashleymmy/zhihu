import { createHash } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { incrRateLimit } from '../utils/rateLimit';
import { writeAudit } from './audit.service';

export const AVATAR_MAX_BYTES = 256 * 1024;
const invalid = () => new AppError(422, 42200, '请选择完整的 JPG 或 PNG 头像，大小不超过 256 KB');
// Accept only bounded raster images, never SVG/HTML, external URLs or client file paths.
export function avatarImage(base64: string) {
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > AVATAR_MAX_BYTES || buffer.toString('base64') !== base64) throw invalid();
  const dimensions = (w: number, h: number) => w > 0 && h > 0 && w <= 2048 && h <= 2048;
  if (
    buffer.length >= 45 &&
    buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    buffer.toString('ascii', 12, 16) === 'IHDR' &&
    buffer.toString('ascii', buffer.length - 8, buffer.length - 4) === 'IEND' &&
    dimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20))
  )
    return { buffer, mime: 'image/png' };
  if (buffer.length > 12 && buffer.readUInt16BE(0) === 0xffd8 && buffer.readUInt16BE(buffer.length - 2) === 0xffd9) {
    let offset = 2;
    while (offset + 4 < buffer.length && buffer[offset] === 0xff) {
      const marker = buffer[offset + 1],
        size = buffer.readUInt16BE(offset + 2);
      if (size < 2 || offset + 2 + size > buffer.length || marker === 0xda) break;
      if (
        [0xc0, 0xc1, 0xc2].includes(marker) &&
        size >= 8 &&
        dimensions(buffer.readUInt16BE(offset + 7), buffer.readUInt16BE(offset + 5))
      )
        return { buffer, mime: 'image/jpeg' };
      offset += 2 + size;
    }
  }
  throw invalid();
}

export async function saveAvatar(userId: string, base64: string) {
  const { buffer, mime } = avatarImage(base64);
  if (!(await incrRateLimit(`profile-avatar:${userId}`, 20, 3600)).allowed)
    throw new AppError(429, 42900, '头像修改过于频繁，请稍后再试');
  const version = createHash('sha256').update(buffer).digest('hex');
  await withTransaction(async (c) => {
    const [[user]] = await c.query<RowDataPacket[]>('SELECT is_active,closed_at FROM users WHERE id=? FOR UPDATE', [
      userId,
    ]);
    if (!user?.is_active || user.closed_at) throw new AppError(401, 40101, '账号已不可用');
    await c.query(
      `INSERT INTO user_avatars(user_id,mime_type,content,content_hash) VALUES(?,?,?,?)
      ON DUPLICATE KEY UPDATE mime_type=VALUES(mime_type),content=VALUES(content),content_hash=VALUES(content_hash)`,
      [userId, mime, buffer, version],
    );
    await c.query('UPDATE users SET avatar_version=? WHERE id=?', [version, userId]);
    await writeAudit(
      { userId, action: 'auth.avatar_update', resourceType: 'user', resourceId: userId, detail: { version } },
      c,
    );
  });
  return { avatarVersion: version };
}

export async function ownAvatar(userId: string) {
  const [file] = await rows<RowDataPacket>(
    'SELECT a.* FROM user_avatars a JOIN users u ON u.id=a.user_id WHERE a.user_id=? AND u.is_active=1 AND u.closed_at IS NULL',
    [userId],
  );
  return file
    ? {
        base64: (file.content as Buffer).toString('base64'),
        mimeType: file.mime_type,
        avatarVersion: file.content_hash,
      }
    : null;
}
