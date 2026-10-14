import { AppError } from '../middleware/errors';

/** Keep the existing account identity; never truncate or wrap the six-digit number. */
export function formatUserId(id: string | number): string {
  const digits = String(id);
  if (!/^[1-9]\d{0,5}$/.test(digits))
    throw new AppError(503, 50300, '用户 ID 暂时无法分配，请稍后重试');
  return 'timo' + digits.padStart(6, '0');
}

export function parseUserId(identifier: string): string | undefined {
  const current = /^timo(\d{6})$/i.exec(identifier);
  if (current && Number(current[1]) > 0) return String(Number(current[1]));
  // Retain the previous alias so a copied ID remains usable for login.
  return /^TIMO-([1-9]\d*)$/i.exec(identifier)?.[1];
}

export function isReservedUserId(identifier: string): boolean {
  return /^(?:timo\d{6}$|TIMO-)/i.test(identifier);
}
