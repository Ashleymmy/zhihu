import { z } from 'zod';
import { randomInt } from 'node:crypto';
export const newPasswordSchema = z
  .string()
  .regex(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,16}$/, '密码须为 8–16 位，包含字母和数字，不支持空格或符号');

export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value: string;
  do {
    value = Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join('');
  } while (!newPasswordSchema.safeParse(value).success);
  return value;
}
