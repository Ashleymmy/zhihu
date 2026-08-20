import { RequestHandler } from 'express';
import { AppError } from '../middleware/errors';
import { Role } from '../types';

export const ALL_PERMISSIONS = [
  'plan.create',
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
  'withdraw.approve',
  'project.manage',
  'audit.view',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

const rolePermissions: Record<Role, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,
  leader: [
    'plan.create',
    'plan.edit',
    'plan.delete',
    'keyword.bind',
    'composition.create',
    'composition.edit',
    'team.view',
    'team.create_member',
    'team.reset_pwd',
    'team.disable',
    'team.review',
    'team.delete',
    'story.read',
    'earning.view_self',
    'earning.view_team',
    'withdraw.apply',
  ],
  creator: [
    'plan.create',
    'plan.edit',
    'plan.delete',
    'keyword.bind',
    'composition.create',
    'composition.edit',
    'team.apply',
    'story.read',
    'earning.view_self',
    'withdraw.apply',
  ],
};

export const permissionsFor = (role: Role) => [...rolePermissions[role]];
export const hasPermission = (role: Role, permission: Permission) => rolePermissions[role].includes(permission);

export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!hasPermission(req.user.role, permission)) return next(new AppError(403, 40301, '无权执行此操作'));
    next();
  };
