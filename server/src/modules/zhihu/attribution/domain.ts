import { createHash } from 'node:crypto';
import { AppError } from '../../../middleware/errors';

export interface Scope {
  projectId: string;
  accountId: string;
}
export type PathType = 'reserved' | 'team_creator' | 'direct_creator' | 'leader_self';
export function fail(message: string, status = 422): never {
  throw new AppError(status, status * 100, message);
}
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function businessDay(value = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(value);
}
export function day(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail('业务日期不合法');
  return value;
}
export function keywordText(value: string): string {
  const text = value.trim();
  if (!text || text.length > 128 || /[\s,，、;；]/u.test(text)) fail('请输入不超过 128 字符的单个关键词');
  return text;
}
export function money(value: string, signed = false): bigint {
  if (!(signed ? /^-?\d{1,16}(\.\d{1,4})?$/ : /^\d{1,16}(\.\d{1,4})?$/).test(value))
    fail('金额必须是最多四位小数的十进制字符串');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return (BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))) * (negative ? -1n : 1n);
}
export function moneyText(value: bigint): string {
  const n = value < 0n ? -value : value;
  if (n >= 10n ** 20n) fail('金额超出存储范围');
  return `${value < 0n ? '-' : ''}${n / 10000n}.${String(n % 10000n).padStart(4, '0')}`;
}
export function count(value: string): bigint {
  if (!/^\d{1,16}$/.test(value)) fail('数量必须是非负整数字符串');
  return BigInt(value);
}
