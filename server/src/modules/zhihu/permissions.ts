import type { RequestHandler } from 'express';
import { AppError } from '../../middleware/errors';
import { hasPermission as hasCorePermission } from '../../auth/permissions';
import type { Role } from '../../types';
import { zhihuManifest } from './manifest';
export function hasPermission(role: Role, permission: string) {
  return hasCorePermission(role, permission) || (zhihuManifest.permissions[role] ?? []).includes(permission);
}
export const requirePermission =
  (permission: string): RequestHandler =>
  (req, _res, next) => {
    const duty=req.user.adminDuty;
    const reading=['GET','HEAD'].includes(req.method);
    if(req.user.role==='admin'&&duty==='finance'&&permission!=='attribution.read'&&(!reading||['callback.secret','callback.config'].includes(permission)))return next(new AppError(403,40301,'此操作需要运营权限'));
    if(req.user.role==='admin'&&duty==='operations'&&/^(withdraw\.|finance\.|data\.import|statement\.confirm)/.test(permission))return next(new AppError(403,40301,'此操作需要财务权限'));
    if (!hasPermission(req.user.role, permission)) return next(new AppError(403, 40301, '无权执行此操作'));
    next();
  };

const LEGACY_PERMISSIONS = [
  'plan.create',
  'catalog.sync',
  'plan.edit',
  'plan.delete',
  'keyword.bind',
  'callback.config',
  'callback.secret',
  'composition.create',
  'composition.edit',
  'team.view',
  'team.create_member',
  'team.reset_pwd',
  'team.disable',
  'team.apply',
  'team.review',
  'team.delete',
  'story.read',
  'earning.view_self',
  'earning.view_team',
  'earning.view_all',
  'withdraw.apply',
  'withdraw.review',
  'withdraw.approve',
  'project.manage',
  'finance.relay',
  'data.import',
  'audit.view',
] as const;
export type Permission = (typeof LEGACY_PERMISSIONS)[number];
export const permissionsFor = (role: Role) => (zhihuManifest.permissions[role] ?? []).map((p) => 'zhihu.' + p);
