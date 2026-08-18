import { describe, expect, it } from 'vitest';
import { isRole, normalizeRole } from '../../src/auth/roles';

describe('角色归一化（03 §5.3）', () => {
  it('旧值映射到目标值', () => {
    expect(normalizeRole('boss')).toBe('admin');
    expect(normalizeRole('member')).toBe('creator');
    expect(normalizeRole('leader')).toBe('leader');
  });

  it('目标值保持不变', () => {
    expect(normalizeRole('admin')).toBe('admin');
    expect(normalizeRole('creator')).toBe('creator');
  });

  it('未知值返回 null，不得默认提升权限', () => {
    expect(normalizeRole('superuser')).toBeNull();
    expect(normalizeRole('')).toBeNull();
    expect(normalizeRole(undefined)).toBeNull();
    expect(normalizeRole(42)).toBeNull();
  });

  it('isRole 只认目标值', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('boss')).toBe(false);
    expect(isRole('member')).toBe(false);
  });
});
