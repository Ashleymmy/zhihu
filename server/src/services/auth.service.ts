import bcrypt from 'bcryptjs';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { db, rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser, Role } from '../types';
import { signToken, tokenTtl } from '../auth/jwt';
import { permissionsFor } from '../auth/permissions';
import { revocationStore } from '../auth/revocation';
import { writeAudit } from './audit.service';
import { incrRateLimit, deleteRateLimit } from '../utils/rateLimit';

interface UserRow extends RowDataPacket {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  parent_id: string | null;
  display_name: string;
  phone: string | null;
  is_active: number;
  must_change_pwd: number;
}

const publicUser = (user: UserRow) => ({
  id: String(user.id),
  username: user.username,
  displayName: user.display_name,
  role: user.role,
  parentId: user.parent_id ? String(user.parent_id) : null,
  phone: user.phone,
});

export async function login(username: string, password: string, ip?: string) {
  const ipKey = `login:ip:${ip ?? 'unknown'}`;
  const ipCheck = await incrRateLimit(ipKey, 20, 300);
  if (!ipCheck.allowed) throw new AppError(429, 42903, '登录请求过于频繁，请 5 分钟后再试');

  const [user] = await rows<UserRow>('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    const userKey = `login:user:${username}`;
    const userCheck = await incrRateLimit(userKey, 5, 900);
    if (!userCheck.allowed) throw new AppError(429, 42903, '登录失败次数过多，请 15 分钟后再试');
    throw new AppError(401, 40102, '用户名或密码错误');
  }
  if (!user.is_active) throw new AppError(403, 40302, '账号已停用');

  const userKey = `login:user:${username}`;
  await deleteRateLimit(userKey);

  const token = await signToken({
    id: String(user.id),
    role: user.role,
    parentId: user.parent_id ? String(user.parent_id) : null,
    username: user.username,
    displayName: user.display_name,
  });
  await withTransaction(async (connection) => {
    await connection.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    await writeAudit(
      { userId: String(user.id), action: 'auth.login', resourceType: 'user', resourceId: String(user.id), ip },
      connection,
    );
  });
  return { token, user: publicUser(user), mustChangePwd: Boolean(user.must_change_pwd) };
}

export async function me(auth: AuthUser) {
  const [user] = await rows<UserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [auth.sub]);
  if (!user || !user.is_active) throw new AppError(401, 40101, '登录已过期，请重新登录');
  return { ...publicUser(user), permissions: permissionsFor(user.role), mustChangePwd: Boolean(user.must_change_pwd) };
}

export async function logout(auth: AuthUser, ip?: string) {
  await revocationStore.revoke(auth.jti, tokenTtl(auth));
  await writeAudit({ userId: auth.sub, action: 'auth.logout', resourceType: 'user', resourceId: auth.sub, ip });
}

export async function changePassword(auth: AuthUser, oldPassword: string, newPassword: string, ip?: string) {
  const [user] = await rows<UserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [auth.sub]);
  if (!user || !(await bcrypt.compare(oldPassword, user.password_hash))) throw new AppError(422, 42202, '原密码不正确');
  if (await bcrypt.compare(newPassword, user.password_hash)) throw new AppError(422, 42203, '新密码不能与原密码相同');
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      'UPDATE users SET password_hash = ?, must_change_pwd = 0 WHERE id = ?',
      [passwordHash, auth.sub],
    );
    if (result.affectedRows !== 1) throw new AppError(404, 40401, '用户不存在');
    await writeAudit(
      { userId: auth.sub, action: 'auth.change_password', resourceType: 'user', resourceId: auth.sub, ip },
      connection,
    );
  });
  await revocationStore.revokeUser(auth.sub);
}
