import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { revocationStore } from '../auth/revocation';
import { incrRateLimit } from '../utils/rateLimit';
import { writeAudit } from './audit.service';
import type { AuthUser } from '../types';
import type { ModuleRuntime } from '../core/module-runtime';
import type { ModuleAccountLifecycle } from '../core/contracts';
import { lifecycleProviders } from '../core/account-lifecycle';

const select = async (c: PoolConnection, sql: string, params: unknown[] = []) =>
  (await c.query<RowDataPacket[]>(sql, params))[0];

// Retain business/financial evidence and foreign keys. Closing an account is
// irreversible and is not the staff "disable member" operation.
async function blockers(c: PoolConnection, user: RowDataPacket, providers: ModuleAccountLifecycle[]) {
  const id = String(user.id),
    reasons: string[] = [];
  const checks: Array<[string, string, unknown[]]> = [
    ['请先移交名下成员', 'SELECT id FROM users WHERE parent_id=? AND closed_at IS NULL LIMIT 1', [id]],
    [
      '请先移交负责的项目',
      "SELECT id FROM project_members WHERE user_id=? AND member_role IN ('owner','admin') AND left_at IS NULL LIMIT 1",
      [id],
    ],
    ['请先移交 MCN 账户', "SELECT id FROM mcn_accounts WHERE owner_user_id=? AND status<>'archived' LIMIT 1", [id]],
    [
      '请先处理提现申请',
      "SELECT id FROM opc_withdrawals WHERE user_id=? AND status IN ('pending','approved') LIMIT 1",
      [id],
    ],
  ];
  for (const [label, sql, params] of checks) if ((await select(c, sql, params)).length) reasons.push(label);
  for (const provider of providers) reasons.push(...(await provider.closureBlockers(c, id)));
  // Check each financial scope independently; different projects cannot offset.
  const unsettled = await select(
    c,
    `SELECT project_id,account_id FROM (
    SELECT s.project_id,s.account_id,e.amount FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE e.user_id=?
    UNION ALL SELECT project_id,account_id,-amount FROM opc_withdrawals WHERE user_id=? AND status='paid'
  ) balances GROUP BY project_id,account_id HAVING SUM(amount)<>0 LIMIT 1`,
    [id, id],
  );
  if (unsettled.length) reasons.push('请先结清待开放、可提现款项或待抵扣余额');
  if (user.role === 'developer') {
    const others = await select(c, "SELECT id FROM users WHERE role='developer' AND is_active=1 AND id<>? LIMIT 1", [
      id,
    ]);
    if (!others.length) reasons.push('当前是最后一个开发者账号，请先完成管理权限移交');
  }
  if (user.role === 'admin') {
    const others = await select(
      c,
      "SELECT id FROM users WHERE role IN ('admin','developer') AND is_active=1 AND id<>? LIMIT 1",
      [id],
    );
    if (!others.length) reasons.push('当前是最后一个平台管理员，请先完成管理权限移交');
  }
  return reasons;
}

export async function closureStatus(auth: AuthUser, runtime: ModuleRuntime) {
  return withTransaction(async (c) => {
    const [user] = await select(c, 'SELECT id,role,is_active,closed_at FROM users WHERE id=?', [auth.sub]);
    if (!user?.is_active || user.closed_at) throw new AppError(401, 40101, '账号已不可用');
    const reasons = await blockers(c, user, await lifecycleProviders(c, runtime));
    return { canClose: reasons.length === 0, blockers: reasons, supportEmail: 'cloudto@timoo.freeqiye.com' };
  });
}

export async function closeAccount(auth: AuthUser, password: string, runtime: ModuleRuntime) {
  if (!(await incrRateLimit(`account-close:${auth.sub}`, 5, 900)).allowed)
    throw new AppError(429, 42903, '验证次数过多，请 15 分钟后重试');
  const [before] = await rows<RowDataPacket>('SELECT password_hash,is_active,closed_at FROM users WHERE id=?', [
    auth.sub,
  ]);
  if (!before?.is_active || before.closed_at || !(await bcrypt.compare(password, before.password_hash)))
    throw new AppError(422, 42202, '账号密码不正确或账号已不可用');
  const unusablePassword = await bcrypt.hash(randomBytes(48).toString('hex'), 12);
  await withTransaction(async (c) => {
    // Finance mutations lock accounts first. Prevent a settlement or withdrawal
    // being committed between our checks and closing the account.
    await select(c, 'SELECT id FROM integration_accounts ORDER BY id FOR UPDATE');
    await select(c, "SELECT id FROM users WHERE role IN ('developer','admin') OR id=? ORDER BY id FOR UPDATE", [
      auth.sub,
    ]);
    const [current] = await select(c, 'SELECT * FROM users WHERE id=? FOR UPDATE', [auth.sub]);
    if (!current?.is_active || current.closed_at || current.password_hash !== before.password_hash)
      throw new AppError(409, 40900, '账号状态已变化，请刷新后重试');
    const providers = await lifecycleProviders(c, runtime);
    const reasons = await blockers(c, current, providers);
    if (reasons.length) throw new AppError(409, 40931, reasons.join('；'));
    for (const provider of providers) await provider.erasePersonalData(c, auth.sub);
    await c.query(
      `UPDATE users SET username=?,display_name='已注销用户',password_hash=?,email=NULL,
      phone=NULL,phone_verified_at=NULL,parent_id=NULL,mcn_account_id=NULL,
      is_active=0,must_change_pwd=0,last_login_at=NULL,closed_at=NOW(3) WHERE id=?`,
      ['closed_' + randomBytes(20).toString('hex'), unusablePassword, auth.sub],
    );
    for (const table of ['wechat_identities', 'wechat_profiles', 'mini_uploads', 'project_members'])
      await c.query(`DELETE FROM ${table} WHERE user_id=?`, [auth.sub]);
    await c.query('DELETE FROM token_sessions WHERE user_id=?', [auth.sub]);
    await c.query('DELETE FROM login_sessions WHERE user_id=?', [auth.sub]);
    await c.query('DELETE FROM team_applications WHERE creator_id=? OR leader_id=?', [auth.sub, auth.sub]);
    await c.query(
      'DELETE FROM mini_invitation_codes WHERE invitation_id IN (SELECT id FROM member_invitations WHERE owner_user_id=? OR team_leader_id=?)',
      [auth.sub, auth.sub],
    );
    await c.query(
      "UPDATE member_invitations SET label='已注销用户的邀请',token_cipher=NULL,revoked_at=NOW(3),deleted_at=NOW(3) WHERE owner_user_id=? OR team_leader_id=?",
      [auth.sub, auth.sub],
    );
    // Audit facts remain, but profile snapshots and IPs are no longer needed.
    await c.query(
      "UPDATE audit_logs SET detail_json=JSON_OBJECT('personalDataRemoved',TRUE),ip=NULL WHERE user_id=? OR (resource_type='user' AND resource_id=?)",
      [auth.sub, auth.sub],
    );
    await c.query('UPDATE mini_request_events SET user_id=NULL WHERE user_id=?', [auth.sub]);
    await writeAudit(
      {
        userId: auth.sub,
        action: 'auth.account_closed',
        resourceType: 'user',
        resourceId: auth.sub,
        detail: { profileErased: true, businessEvidenceRetained: true },
      },
      c,
    );
  });
  await revocationStore.revokeUser(auth.sub);
  return { closed: true };
}
