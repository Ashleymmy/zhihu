import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { rows } from '../db';
import { AppError } from '../middleware/errors';
import { requireSmsEnabled, smsSettings } from '../sms/config';
import { sendRegistrationCode, verifyRegistrationCode, consumeRegistrationCode } from '../sms/registration';
import { register } from './auth.service';
import { assignUserId } from '../auth/user-id';

export const smsSignupSchema = z
  .object({
    phone: z.string().regex(/^1\d{10}$/),
    smsCode: z.string().regex(/^\d{6}$/),

    displayName: z.string().trim().max(64).default(''),
  })
  .strict();

export function registrationPolicy(invitationToken?: string) {
  let smsEnabled = false;
  try {
    smsEnabled = smsSettings(invitationToken).enabled;
  } catch {
    /* Fail closed; existing users can still log in. */
  }
  return { registrationMode: 'sms', smsRequired: true, smsEnabled };
}

export async function sendSignupCode(phone: string, identity: string, invitationToken?: string) {
  requireSmsEnabled(invitationToken);
  const [existing] = await rows<RowDataPacket>('SELECT id FROM users WHERE username=? OR phone=? LIMIT 1', [
    phone,
    phone,
  ]);
  if (existing) throw new AppError(409, 40920, '该手机号已有账号，请登录原账号');
  return sendRegistrationCode(phone, identity, invitationToken);
}

export async function registerWithSms(
  input: z.infer<typeof smsSignupSchema>,
  identity: string,
  ip?: string,
  invitationToken?: string,
) {
  requireSmsEnabled(invitationToken);
  const proof = await verifyRegistrationCode(input.phone, identity, input.smsCode, invitationToken);
  let username = '';
  const result = await register(
    {
      username: 'pending_' + randomBytes(20).toString('hex'),
      phone: input.phone,
      password: randomBytes(48).toString('base64'),
      displayName: input.displayName || '用户' + input.phone.slice(-4),
      invitationToken,
    },
    ip,
    async (c, id) => {
      const [[other]] = await c.query<RowDataPacket[]>('SELECT id FROM users WHERE id<>? AND phone=? LIMIT 1', [
        id,
        input.phone,
      ]);
      if (other) throw new AppError(409, 40920, '该手机号已有账号，请登录原账号');
      username = await assignUserId(c, id);
      await c.query('UPDATE users SET username=?,password_set=0 WHERE id=?', [username, id]);
      await consumeRegistrationCode(c, proof, id);
    },
    identity,
  );
  return { ...result, username };
}
