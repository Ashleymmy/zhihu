import { Role } from '../types';

/** 旧库角色值 → 目标角色值映射（03-前端架构设计 §5.3）。 */
const LEGACY_ROLE_MAP: Record<string, Role> = {
  boss: 'admin',
  admin: 'admin',
  developer: 'developer',
  operator: 'operator',
  opreater: 'operator',
  leader: 'leader',
  member: 'creator',
  creator: 'creator',
};

export const isRole = (value: unknown): value is Role =>
  value === 'developer' || value === 'admin' || value === 'operator' || value === 'leader' || value === 'creator';

export const isStaffRole = (role: unknown): boolean => role === 'developer' || role === 'admin' || role === 'operator';
export const roleLevel: Record<Role, number> = { developer: 50, admin: 40, operator: 30, leader: 20, creator: 10 };
export const effectiveDuty = (user: { role: Role; adminDuty?: string }) =>
  user.role === 'developer' ? 'all' : user.role === 'operator' ? 'operations' : (user.adminDuty ?? 'all');
export const canManageRole = (actor: Role, target: Role) => isStaffRole(actor) && roleLevel[actor] > roleLevel[target];
export const businessRole = (role: Role): 'admin' | 'leader' | 'creator' =>
  isStaffRole(role) ? 'admin' : (role as 'leader' | 'creator');

/** 读取数据库或旧 Token 中的角色值并归一化；未知值返回 null，调用方必须拒绝。 */
export function normalizeRole(value: unknown): Role | null {
  if (typeof value !== 'string') return null;
  return LEGACY_ROLE_MAP[value] ?? null;
}
