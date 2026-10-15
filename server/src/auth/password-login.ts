import { z } from 'zod';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../middleware/errors';

export type PasswordLoginMethod = 'phone' | 'username';
export const passwordLoginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
  loginMethod: z.enum(['phone', 'username']).optional(),
}).refine((v) => v.loginMethod !== 'phone' || /^1\d{10}$/.test(v.username), {
  message: '请输入正确的 11 位手机号', path: ['username'],
});

/** Recheck the verified phone under the session issuer's user lock. */
export function passwordLoginProof(userId: string, identifier: string, method?: PasswordLoginMethod) {
  if (method !== 'phone') return undefined;
  return async (c: PoolConnection) => {
    const [[user]] = await c.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE id=? AND phone=? AND phone_verified_at IS NOT NULL AND password_set=1',
      [userId, identifier],
    );
    if (!user) throw new AppError(401, 40102, '手机号或密码错误');
  };
}
