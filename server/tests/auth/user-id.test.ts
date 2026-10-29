import { describe, expect, it, vi } from 'vitest';
import { randomInt } from 'node:crypto';
import { legacyUserId, isReservedUserId, randomUserId } from '../../src/auth/user-id';
vi.mock('node:crypto', () => ({ randomInt: vi.fn(() => 123456) }));

describe('fixed six-digit user IDs', () => {
  it.each([[1, 'timo000001'], [123, 'timo000123'], [123456, 'timo123456'], [999999, 'timo999999']])(
    'formats %s without changing its account identity', (id, expected) => {
      expect(legacyUserId(id)).toBe(expected);
    },
  );
  it.each(['0', '-1', '1000000', '9007199254740993', '001', '1.5', ''])('rejects %s instead of truncating or wrapping', (id) => {
    expect(() => legacyUserId(id)).toThrow();
  });
  it('uses cryptographic random allocation, with a fixed six-digit format', () => {
    (randomInt as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(7).mockReturnValueOnce(983514);
    expect(randomUserId()).toBe('timo000007');
    expect(randomUserId()).toBe('timo983514');
    expect(randomInt).toHaveBeenCalledWith(1,1000000);
  });
  it('reserves every canonical ID and previous alias case-insensitively', () => {
    for (const name of ['timo000123', 'TIMO123456', 'timo000000', 'TIMO-123'])
      expect(isReservedUserId(name)).toBe(true);
    for (const name of ['timo123', 'creator_li', '13800000001'])
      expect(isReservedUserId(name)).toBe(false);
  });
});
