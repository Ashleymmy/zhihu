import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { requireDuty } from './duties';
import { rows, withTransaction } from '../db';
import { asyncHandler, AppError } from '../middleware/errors';
import { ok } from '../utils/response';
import { writeAudit } from '../services/audit.service';
import { revocationStore } from '../auth/revocation';
import { canManageRole, effectiveDuty, normalizeRole } from '../auth/roles';
import type { AuthUser, Role } from '../types';

const staffRole = z.enum(['developer', 'admin', 'operator']);
const duty = z.enum(['all', 'operations', 'finance']);
const allowed = (actor: AuthUser, role: Role) => actor.role === 'developer' || canManageRole(actor.role, role);
function assertAllowed(actor: AuthUser, role: Role) {
  if (!allowed(actor, role)) throw new AppError(403, 40301, '不能创建或修改同级及更高权限的管理账号');
}
export const staffRouter = Router();
staffRouter.use(requireDuty('staff'));
staffRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const list = await rows<RowDataPacket>(
      "SELECT CAST(id AS CHAR) id,username,display_name,role,admin_duty,is_active FROM users WHERE role IN ('developer','admin','operator') ORDER BY id",
    );
    ok(
      res,
      list.map((u) => ({
        ...u,
        canManage: String(u.id) !== req.user.sub && allowed(req.user, normalizeRole(u.role)!),
      })),
    );
  }),
);
staffRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        username: z
          .string()
          .trim()
          .min(2)
          .max(64)
          .regex(/^[a-zA-Z0-9_-]+$/),
        displayName: z.string().trim().min(1).max(64),
        role: staffRole.optional(),
        duty: duty.default('operations'),
      })
      .strict()
      .parse(req.body);
    const role = input.role ?? (input.duty === 'operations' ? 'operator' : 'admin');
    assertAllowed(req.user, role);
    const password = randomBytes(12).toString('base64url'),
      hash = await bcrypt.hash(password, 12);
    const id = await withTransaction(async (c) => {
      const [[actor]] = await c.query<RowDataPacket[]>(
        'SELECT role,admin_duty,is_active FROM users WHERE id=? FOR UPDATE',
        [req.user.sub],
      );
      if (!actor?.is_active || effectiveDuty({ role: actor.role, adminDuty: actor.admin_duty }) !== 'all')
        throw new AppError(403, 40301, '管理权限已变化');
      assertAllowed({ ...req.user, role: actor.role }, role);
      const [[existing]] = await c.query<RowDataPacket[]>('SELECT id FROM users WHERE username=?', [input.username]);
      if (existing) throw new AppError(409, 40900, '账号已存在');
      const assignedDuty = role === 'operator' ? 'operations' : role === 'developer' ? 'all' : input.duty;
      const [r] = await c.query<ResultSetHeader>(
        'INSERT INTO users(username,password_hash,role,role_id,display_name,admin_duty,must_change_pwd,created_by) VALUES(?,?,?,(SELECT id FROM roles WHERE role_key=?),?,?,1,?)',
        [input.username, hash, role, role, input.displayName, assignedDuty, req.user.sub],
      );
      await writeAudit(
        {
          userId: req.user.sub,
          action: 'staff.create',
          resourceType: 'user',
          resourceId: String(r.insertId),
          detail: { role, duty: assignedDuty },
        },
        c,
      );
      return String(r.insertId);
    });
    ok(res, { id, username: input.username, temporaryPassword: password }, 201);
  }),
);
staffRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = z.string().regex(/^\d+$/).parse(req.params.id);
    const input = z
      .object({ role: staffRole.optional(), duty: duty.optional(), isActive: z.boolean().optional() })
      .strict()
      .refine((v) => Object.keys(v).length > 0)
      .parse(req.body);
    if (id === req.user.sub) throw new AppError(409, 40900, '请由其他开发者调整当前账号的角色或状态');
    await withTransaction(async (c) => {
      const [staff] = await c.query<RowDataPacket[]>(
        "SELECT id,role,admin_duty,is_active FROM users WHERE role IN ('developer','admin','operator') ORDER BY id FOR UPDATE",
      );
      const actor = staff.find((u) => String(u.id) === req.user.sub),
        target = staff.find((u) => String(u.id) === id);
      if (!actor?.is_active || effectiveDuty({ role: actor.role, adminDuty: actor.admin_duty }) !== 'all')
        throw new AppError(403, 40301, '管理权限已变化');
      if (!target) throw new AppError(404, 40400, '管理账号不存在');
      const currentActor = { ...req.user, role: actor.role as Role };
      assertAllowed(currentActor, target.role);
      const role = input.role ?? target.role;
      assertAllowed(currentActor, role);
      const active = input.isActive ?? Boolean(target.is_active);
      if (
        target.role === 'developer' &&
        (role !== 'developer' || !active) &&
        target.is_active &&
        staff.filter((u) => u.role === 'developer' && u.is_active).length <= 1
      )
        throw new AppError(409, 40900, '至少需要保留一位有效开发者');
      const assignedDuty =
        role === 'operator'
          ? 'operations'
          : role === 'developer'
            ? 'all'
            : (input.duty ?? (role !== target.role ? 'all' : target.admin_duty));
      await c.query(
        'UPDATE users SET role=?,role_id=(SELECT id FROM roles WHERE role_key=?),admin_duty=?,is_active=? WHERE id=?',
        [role, role, assignedDuty, active ? 1 : 0, id],
      );
      await c.query(
        "UPDATE login_sessions SET revoked_at=NOW(3),revoke_reason='role_changed' WHERE user_id=? AND revoked_at IS NULL",
        [id],
      );
      await c.query(
        "UPDATE token_sessions SET revoked_at=NOW(3),revoke_reason='role_changed' WHERE user_id=? AND revoked_at IS NULL",
        [id],
      );
      await writeAudit(
        {
          userId: req.user.sub,
          action: 'staff.role',
          resourceType: 'user',
          resourceId: id,
          detail: { from: target.role, to: role, duty: assignedDuty, isActive: active },
        },
        c,
      );
    });
    await revocationStore.revokeUser(id);
    ok(res, null);
  }),
);
