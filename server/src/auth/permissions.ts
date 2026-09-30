import type { RequestHandler } from 'express';
import { AppError } from '../middleware/errors';
import type { Role } from '../types';
import type { ModuleManifest } from '../core/contracts';
import { businessRole, effectiveDuty, isStaffRole } from './roles';
export const ALL_PERMISSIONS = [
  'team.view',
  'team.create_member',
  'team.reset_pwd',
  'team.disable',
  'team.apply',
  'team.review',
  'team.delete',
  'project.manage',
  'audit.view',
  'module.manage',
  'staff.manage',
  'system.develop',
] as const;
export type Permission = string;
const roles: Record<Role, readonly string[]> = {
  developer: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((p) => p !== 'system.develop'),
  operator: ['team.view', 'team.create_member', 'team.reset_pwd', 'team.disable', 'team.review'],
  leader: ['team.view', 'team.create_member', 'team.reset_pwd', 'team.disable', 'team.review', 'team.delete'],
  creator: ['team.apply'],
};
let modules: ModuleManifest[] = [];
export function setModulePermissions(manifests: ModuleManifest[]) {
  modules = manifests;
}
export function permissionsFor(role: Role): string[] {
  return [
    ...roles[role],
    ...modules.flatMap((m) =>
      (m.permissions[role] ?? m.permissions[businessRole(role)] ?? [])
        .filter(
          (p) =>
            role !== 'operator' ||
            !/^(callback\.|withdraw\.|finance\.|data\.import|statement\.confirm|engine\.configure)/.test(p),
        )
        .map((p) => m.id + '.' + p),
    ),
  ];
}
export function hasPermission(role: Role, permission: Permission) {
  return permissionsFor(role).includes(permission);
}
export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (
      (isStaffRole(req.user.role) && effectiveDuty(req.user) === 'finance' && permission !== 'audit.view') ||
      !hasPermission(req.user.role, permission)
    )
      return next(new AppError(403, 40301, '无权执行此操作'));
    next();
  };
