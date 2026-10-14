import { describe, expect, it } from 'vitest';
import { formatUserId, isReservedUserId, parseUserId } from '../../src/auth/user-id';

describe('fixed six-digit user IDs', () => {
  it.each([[1, 'timo000001'], [123, 'timo000123'], [123456, 'timo123456'], [999999, 'timo999999']])(
    'formats %s without changing its account identity', (id, expected) => {
      expect(formatUserId(id)).toBe(expected);
      expect(parseUserId(String(expected))).toBe(String(id));
      expect(parseUserId(String(expected).toUpperCase())).toBe(String(id));
    },
  );
  it.each(['0', '-1', '1000000', '9007199254740993', '001', '1.5', ''])('rejects %s instead of truncating or wrapping', (id) => {
    expect(() => formatUserId(id)).toThrow();
  });
  it('keeps the previous ID alias and does not reinterpret ordinary usernames', () => {
    expect(parseUserId('TIMO-123')).toBe('123');
    for (const name of ['timo123', 'timo1234567', 'timo000000', 'creator_li', '13800000001'])
      expect(parseUserId(name)).toBeUndefined();
  });
  it('reserves every canonical ID and previous alias case-insensitively', () => {
    for (const name of ['timo000123', 'TIMO123456', 'timo000000', 'TIMO-123'])
      expect(isReservedUserId(name)).toBe(true);
    for (const name of ['timo123', 'creator_li', '13800000001'])
      expect(isReservedUserId(name)).toBe(false);
  });
});
