import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { revocationStore } from '../auth/revocation';
import { AppError } from '../middleware/errors';
import { AuthUser, Role } from '../types';
import { normalizeRole } from '../auth/roles';
import { writeAudit } from './audit.service';

interface MemberRow extends RowDataPacket {
  id: string;
  role: Role;
  parent_id: string | null;
  is_active: number;
  username?: string;
}

async function resolveParentId(user: AuthUser, role: Role, requestedParentId?: string | null) {
  if (user.role === 'leader') return user.sub;
  if (role === 'leader') return user.sub;

  // admin 创建达人且未显式指定归属时，达人保持“未入团”，由达人通过入团申请选择团长
  if (user.role === 'admin' && role === 'creator' && !requestedParentId) return null;

  const parentId = requestedParentId ?? user.sub;
  const [parent] = await rows<MemberRow>('SELECT id, role, parent_id, is_active FROM users WHERE id = ? LIMIT 1', [
    parentId,
  ]);
  if (!parent || !parent.is_active || !['admin', 'leader'].includes(normalizeRole(parent.role) ?? '')) {
    throw new AppError(422, 42205, '成员必须归属于有效的管理员或团长账号');
  }
  return String(parent.id);
}

const target = async (user: AuthUser, id: string) => {
  const [member] = await rows<MemberRow>('SELECT id, role, parent_id, is_active, username FROM users WHERE id = ? LIMIT 1', [id]);
  if (!member) throw new AppError(404, 40401, '成员不存在');
  if (user.role === 'leader' && String(member.parent_id) !== user.sub) throw new AppError(403, 40301, '无权访问该成员');
  return member;
};

export async function listMembers(user: AuthUser) {
  if (user.role === 'admin')
    return rows(
      'SELECT id, username, role, parent_id, display_name, phone, is_active, must_change_pwd, last_login_at, created_at FROM users ORDER BY created_at DESC',
    );
  return rows(
    'SELECT id, username, role, parent_id, display_name, phone, is_active, must_change_pwd, last_login_at, created_at FROM users WHERE parent_id = ? OR id = ? ORDER BY created_at DESC',
    [user.sub, user.sub],
  );
}

export async function createMember(
  user: AuthUser,
  input: { username: string; displayName: string; phone?: string | null; role?: Role; parentId?: string | null },
  ip?: string,
) {
  const role: Role = user.role === 'admin' ? (input.role ?? 'creator') : 'creator';
  const parentId = await resolveParentId(user, role, input.parentId);
  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  const hash = await bcrypt.hash(temporaryPassword, 12);
  const id = await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO users (username, password_hash, role, parent_id, display_name, phone, is_active, must_change_pwd, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`,
      [input.username, hash, role, parentId, input.displayName, input.phone ?? null, user.sub],
    );
    const memberId = String(result.insertId);
    await writeAudit(
      {
        userId: user.sub,
        action: 'user.create',
        resourceType: 'user',
        resourceId: memberId,
        detail: { role, parentId },
        ip,
      },
      connection,
    );
    return memberId;
  });
  return { id, username: input.username, temporaryPassword, mustChangePwd: true };
}

export async function updateMember(
  user: AuthUser,
  id: string,
  patch: { displayName?: string; phone?: string | null },
  ip?: string,
) {
  await target(user, id);
  const fields: string[] = [];
  const bindings: unknown[] = [];
  if (patch.displayName !== undefined) {
    fields.push('display_name = ?');
    bindings.push(patch.displayName);
  }
  if (patch.phone !== undefined) {
    fields.push('phone = ?');
    bindings.push(patch.phone);
  }
  if (!fields.length) throw new AppError(422, 42200, '没有可修改的字段');
  await withTransaction(async (connection) => {
    await connection.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...bindings, id]);
    await writeAudit(
      { userId: user.sub, action: 'user.update', resourceType: 'user', resourceId: id, detail: patch, ip },
      connection,
    );
  });
}

export async function resetPassword(user: AuthUser, id: string, ip?: string, customPassword?: string) {
  await target(user, id);
  // 自定义密码时不再强制下次登录修改；留空则生成临时密码并强制修改
  const temporaryPassword = customPassword ?? crypto.randomBytes(9).toString('base64url');
  const hash = await bcrypt.hash(temporaryPassword, 12);
  const mustChangePwd = customPassword ? 0 : 1;
  await withTransaction(async (connection) => {
    await connection.query('UPDATE users SET password_hash = ?, must_change_pwd = ? WHERE id = ?', [hash, mustChangePwd, id]);
    await writeAudit(
      { userId: user.sub, action: 'user.reset_pwd', resourceType: 'user', resourceId: id, detail: { custom: Boolean(customPassword) }, ip },
      connection,
    );
  });
  await revocationStore.revokeUser(id);
  return { temporaryPassword: customPassword ? null : temporaryPassword, mustChangePwd: Boolean(mustChangePwd) };
}

/** 物理删除成员：仅允许删除无业务数据的账号（如测试号）；有历史数据的账号只能禁用。 */
export async function deleteMember(user: AuthUser, id: string, ip?: string) {
  if (id === user.sub) throw new AppError(422, 42204, '不能删除当前登录账号');
  const member = await target(user, id);
  if (normalizeRole(member.role) === 'admin') throw new AppError(422, 42212, '管理员账号不可删除');

  // 依赖检查：任何业务数据存在都拒绝删除，避免外键断裂与审计链丢失
  const checks: Array<{ label: string; sql: string }> = [
    { label: '名下成员', sql: 'SELECT COUNT(*) AS n FROM users WHERE parent_id = ?' },
    { label: '渠道', sql: 'SELECT COUNT(*) AS n FROM channels WHERE owner_id = ?' },
    { label: '推广计划', sql: 'SELECT COUNT(*) AS n FROM plans WHERE owner_id = ?' },
    { label: '收益记录', sql: 'SELECT COUNT(*) AS n FROM earnings WHERE user_id = ?' },
    { label: '提现记录', sql: 'SELECT COUNT(*) AS n FROM withdrawal_requests WHERE user_id = ?' },
    { label: '回传规则', sql: 'SELECT COUNT(*) AS n FROM callback_rules WHERE owner_id = ?' },
    { label: 'MCN 账户', sql: 'SELECT COUNT(*) AS n FROM mcn_accounts WHERE owner_user_id = ?' },
  ];
  const blockers: string[] = [];
  for (const check of checks) {
    const [row] = await rows<RowDataPacket & { n: number }>(check.sql, [id]);
    if (Number(row?.n ?? 0) > 0) blockers.push(check.label);
  }
  if (blockers.length) {
    throw new AppError(422, 42213, `该账号存在关联数据（${blockers.join('、')}），不可删除；如不再使用请改为禁用`);
  }

  await withTransaction(async (connection) => {
    // 入团申请是低价值流程记录，随账号一并清除（其他业务数据已在上方拦截）
    await connection.query('DELETE FROM team_applications WHERE creator_id = ? OR leader_id = ?', [id, id]);
    await connection.query('DELETE FROM users WHERE id = ?', [id]);
    await writeAudit(
      { userId: user.sub, action: 'user.delete', resourceType: 'user', resourceId: id, detail: { username: member.username }, ip },
      connection,
    );
  });
  await revocationStore.revokeUser(id);
}

export async function disableMember(user: AuthUser, id: string, ip?: string) {
  if (id === user.sub) throw new AppError(422, 42204, '不能停用当前账号');
  await target(user, id);
  await withTransaction(async (connection) => {
    await connection.query('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
    await writeAudit(
      { userId: user.sub, action: 'user.disable', resourceType: 'user', resourceId: id, ip },
      connection,
    );
  });
  await revocationStore.revokeUser(id);
}

/* ===== 入团申请 ===== */

/** 达人可见的可申请团长列表（仅活跃团长）。 */
export async function listLeaders() {
  return rows<RowDataPacket & { id: string; username: string; display_name: string; member_count: number }>(
    `SELECT u.id, u.username, u.display_name,
            (SELECT COUNT(*) FROM users m WHERE m.parent_id = u.id AND m.is_active = 1) AS member_count
     FROM users u
     WHERE u.role = 'leader' AND u.is_active = 1
     ORDER BY member_count DESC, u.created_at ASC`,
  );
}

/** 达人当前所属团队；未入团返回 null。 */
export async function myTeam(user: AuthUser) {
  const [meRow] = await rows<MemberRow>('SELECT id, role, parent_id, is_active FROM users WHERE id = ? LIMIT 1', [user.sub]);
  if (!meRow?.parent_id) return null;
  const [leader] = await rows<RowDataPacket & { id: string; username: string; display_name: string; is_active: number }>(
    'SELECT id, username, display_name, is_active FROM users WHERE id = ? LIMIT 1',
    [meRow.parent_id],
  );
  if (!leader) return null;
  const [count] = await rows<RowDataPacket & { member_count: number }>(
    'SELECT COUNT(*) AS member_count FROM users WHERE parent_id = ? AND is_active = 1',
    [leader.id],
  );
  return {
    leaderId: String(leader.id),
    leaderUsername: leader.username,
    leaderName: leader.display_name,
    leaderActive: Boolean(leader.is_active),
    memberCount: Number(count?.member_count ?? 0),
  };
}

interface ApplicationRow extends RowDataPacket {
  id: string;
  creator_id: string;
  leader_id: string;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
  creator_name: string;
  creator_username: string;
  leader_name: string;
}

const applicationSelect = `
  SELECT a.id, a.creator_id, a.leader_id, a.message, a.status, a.handled_by, a.handled_at, a.created_at,
         c.display_name AS creator_name, c.username AS creator_username, l.display_name AS leader_name
  FROM team_applications a
  JOIN users c ON c.id = a.creator_id
  JOIN users l ON l.id = a.leader_id`;

export async function applyToTeam(user: AuthUser, leaderUsername: string, message: string | undefined, ip?: string) {
  if (user.role !== 'creator') throw new AppError(422, 42206, '只有达人账号可以申请入团');
  const [meRow] = await rows<MemberRow>('SELECT id, role, parent_id, is_active FROM users WHERE id = ? LIMIT 1', [user.sub]);
  if (meRow?.parent_id) throw new AppError(422, 42207, '你已在团队内，如需变更请联系管理员');

  const [leader] = await rows<MemberRow & { username: string }>(
    'SELECT id, role, parent_id, is_active, username FROM users WHERE username = ? LIMIT 1',
    [leaderUsername],
  );
  if (!leader || !leader.is_active || normalizeRole(leader.role) !== 'leader') {
    throw new AppError(422, 42208, '目标团长不存在或暂不可加入');
  }

  const [pending] = await rows<ApplicationRow>(
    "SELECT id FROM team_applications WHERE creator_id = ? AND status = 'pending' LIMIT 1",
    [user.sub],
  );
  if (pending) throw new AppError(422, 42209, '你已有一条待审批的申请，请耐心等待');

  return withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      'INSERT INTO team_applications (creator_id, leader_id, message) VALUES (?, ?, ?)',
      [user.sub, String(leader.id), message ?? null],
    );
    const applicationId = String(result.insertId);
    await writeAudit(
      {
        userId: user.sub,
        action: 'team.apply',
        resourceType: 'team_application',
        resourceId: applicationId,
        detail: { leaderId: String(leader.id), leaderUsername },
        ip,
      },
      connection,
    );
    return { id: applicationId };
  });
}

export async function listMyApplications(user: AuthUser) {
  return rows<ApplicationRow>(`${applicationSelect} WHERE a.creator_id = ? ORDER BY a.created_at DESC`, [user.sub]);
}

export async function listApplications(user: AuthUser) {
  if (user.role === 'admin') return rows<ApplicationRow>(`${applicationSelect} ORDER BY a.created_at DESC`);
  return rows<ApplicationRow>(`${applicationSelect} WHERE a.leader_id = ? ORDER BY a.created_at DESC`, [user.sub]);
}

/** 达人撤回自己的待审批申请 */
export async function cancelMyApplication(user: AuthUser, applicationId: string, ip?: string) {
  const [application] = await rows<ApplicationRow>(`${applicationSelect} WHERE a.id = ? LIMIT 1`, [applicationId]);
  if (!application) throw new AppError(404, 40401, '申请不存在');
  if (String(application.creator_id) !== user.sub) throw new AppError(403, 40301, '无权撤回该申请');
  if (application.status !== 'pending') throw new AppError(422, 42210, '该申请已处理过，无法撤回');

  await withTransaction(async (connection) => {
    await connection.query("UPDATE team_applications SET status = 'cancelled', handled_at = NOW() WHERE id = ?", [applicationId]);
    await writeAudit(
      {
        userId: user.sub,
        action: 'team.application_cancel',
        resourceType: 'team_application',
        resourceId: applicationId,
        detail: { leaderId: application.leader_id },
        ip,
      },
      connection,
    );
  });
}

export async function reviewApplication(user: AuthUser, applicationId: string, action: 'approve' | 'reject', ip?: string) {  const [application] = await rows<ApplicationRow>(`${applicationSelect} WHERE a.id = ? LIMIT 1`, [applicationId]);
  if (!application) throw new AppError(404, 40401, '申请不存在');
  if (user.role !== 'admin' && String(application.leader_id) !== user.sub) {
    throw new AppError(403, 40301, '无权审批该申请');
  }
  if (application.status !== 'pending') throw new AppError(422, 42210, '该申请已处理过');

  await withTransaction(async (connection) => {
    if (action === 'approve') {
      // 审批通过 = 建立 parent_id 归属；已有归属的申请不再覆盖
      const [update] = await connection.query<ResultSetHeader>(
        'UPDATE users SET parent_id = ? WHERE id = ? AND parent_id IS NULL',
        [application.leader_id, application.creator_id],
      );
      if (update.affectedRows === 0) throw new AppError(422, 42211, '该达人已在团队内，无法重复入团');
    }
    await connection.query(
      'UPDATE team_applications SET status = ?, handled_by = ?, handled_at = NOW() WHERE id = ?',
      [action === 'approve' ? 'approved' : 'rejected', user.sub, applicationId],
    );
    await writeAudit(
      {
        userId: user.sub,
        action: `team.application_${action}`,
        resourceType: 'team_application',
        resourceId: applicationId,
        detail: { creatorId: application.creator_id, leaderId: application.leader_id },
        ip,
      },
      connection,
    );
  });
}
