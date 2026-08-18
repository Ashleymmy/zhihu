import { Role } from '../types';

/** 旧库角色值 → 目标角色值映射（03-前端架构设计 §5.3）。 */
const LEGACY_ROLE_MAP: Record<string, Role> = {
  boss: 'admin',
  admin: 'admin',
  leader: 'leader',
  member: 'creator',
  creator: 'creator',
};

export const isRole = (value: unknown): value is Role =>
  value === 'admin' || value === 'leader' || value === 'creator';

/** 读取数据库或旧 Token 中的角色值并归一化；未知值返回 null，调用方必须拒绝。 */
export function normalizeRole(value: unknown): Role | null {
  if (typeof value !== 'string') return null;
  return LEGACY_ROLE_MAP[value] ?? null;
}
