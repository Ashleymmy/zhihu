import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { revocationStore } from '../auth/revocation';
import { AppError } from '../middleware/errors';
import { AuthUser, Role } from '../types';
import { writeAudit } from './audit.service';

interface MemberRow extends RowDataPacket { id: string; role: Role; parent_id: string | null; is_active: number }

async function resolveParentId(
  user: AuthUser,
  role: Role,
  requestedParentId?: string | null,
) {
  if (user.role === 'leader') return user.sub;
  if (role === 'leader') return user.sub;

  const parentId = requestedParentId ?? user.sub;
  const [parent] = await rows<MemberRow>(
    'SELECT id, role, parent_id, is_active FROM users WHERE id = ? LIMIT 1',
    [parentId],
  );
  if (!parent || !parent.is_active || !['boss', 'leader'].includes(parent.role)) {
    throw new AppError(422, 42205, '成员必须归属于有效的管理员或团长账号');
  }
  return String(parent.id);
}

const target = async (user: AuthUser, id: string) => {
  const [member] = await rows<MemberRow>('SELECT id, role, parent_id, is_active FROM users WHERE id = ? LIMIT 1', [id]);
  if (!member) throw new AppError(404, 40401, '成员不存在');
  if (user.role === 'leader' && String(member.parent_id) !== user.sub) throw new AppError(403, 40301, '无权访问该成员');
  return member;
};

export async function listMembers(user: AuthUser) {
  if (user.role === 'boss') return rows('SELECT id, username, role, parent_id, display_name, phone, is_active, must_change_pwd, last_login_at, created_at FROM users ORDER BY created_at DESC');
  return rows('SELECT id, username, role, parent_id, display_name, phone, is_active, must_change_pwd, last_login_at, created_at FROM users WHERE parent_id = ? OR id = ? ORDER BY created_at DESC', [user.sub, user.sub]);
}

export async function createMember(user: AuthUser, input: { username: string; displayName: string; phone?: string | null; role?: Role; parentId?: string | null }, ip?: string) {
  const role: Role = user.role === 'boss' ? (input.role ?? 'member') : 'member';
  const parentId = await resolveParentId(user, role, input.parentId);
  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  const hash = await bcrypt.hash(temporaryPassword, 12);
  const id = await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO users (username, password_hash, role, parent_id, display_name, phone, is_active, must_change_pwd, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`, [input.username, hash, role, parentId, input.displayName, input.phone ?? null, user.sub],
    );
    const memberId = String(result.insertId);
    await writeAudit({ userId: user.sub, action: 'user.create', resourceType: 'user', resourceId: memberId, detail: { role, parentId }, ip }, connection);
    return memberId;
  });
  return { id, username: input.username, temporaryPassword, mustChangePwd: true };
}

export async function updateMember(user: AuthUser, id: string, patch: { displayName?: string; phone?: string | null }, ip?: string) {
  await target(user, id); const fields: string[] = []; const bindings: unknown[] = [];
  if (patch.displayName !== undefined) { fields.push('display_name = ?'); bindings.push(patch.displayName); }
  if (patch.phone !== undefined) { fields.push('phone = ?'); bindings.push(patch.phone); }
  if (!fields.length) throw new AppError(422, 42200, '没有可修改的字段');
  await withTransaction(async (connection) => {
    await connection.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...bindings, id]);
    await writeAudit({ userId: user.sub, action: 'user.update', resourceType: 'user', resourceId: id, detail: patch, ip }, connection);
  });
}

export async function resetPassword(user: AuthUser, id: string, ip?: string) {
  await target(user, id); const temporaryPassword = crypto.randomBytes(9).toString('base64url'); const hash = await bcrypt.hash(temporaryPassword, 12);
  await withTransaction(async (connection) => {
    await connection.query('UPDATE users SET password_hash = ?, must_change_pwd = 1 WHERE id = ?', [hash, id]);
    await writeAudit({ userId: user.sub, action: 'user.reset_pwd', resourceType: 'user', resourceId: id, ip }, connection);
  });
  await revocationStore.revokeUser(id);
  return { temporaryPassword, mustChangePwd: true };
}

export async function disableMember(user: AuthUser, id: string, ip?: string) {
  if (id === user.sub) throw new AppError(422, 42204, '不能停用当前账号');
  await target(user, id);
  await withTransaction(async (connection) => {
    await connection.query('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
    await writeAudit({ userId: user.sub, action: 'user.disable', resourceType: 'user', resourceId: id, ip }, connection);
  });
  await revocationStore.revokeUser(id);
}
