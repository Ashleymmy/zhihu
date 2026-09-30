import { createHash, randomBytes } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { effectiveDuty, isStaffRole, normalizeRole } from '../auth/roles';
import type { AuthUser } from '../types';
import { writeAudit } from './audit.service';
import { openInvitationToken, sealInvitationToken } from '../utils/invitationToken';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const unavailable = () => new AppError(422, 42220, '邀请链接已失效、已用完或已停用，请联系邀请人');
function canInvite(user: RowDataPacket) {
  const role = normalizeRole(user.role);
  return (
    user.is_active &&
    role &&
    (role === 'leader' || (isStaffRole(role) && effectiveDuty({ role, adminDuty: user.admin_duty }) !== 'finance'))
  );
}
export async function invitationPreview(token: string) {
  const [r] = await rows<RowDataPacket>(
    `SELECT i.*,u.display_name,u.role,u.admin_duty,u.is_active,l.display_name team_name,l.is_active leader_active,l.role leader_role
     FROM member_invitations i JOIN users u ON u.id=i.owner_user_id LEFT JOIN users l ON l.id=i.team_leader_id
     WHERE i.token_hash=? AND i.deleted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>NOW(3) AND i.used_count<i.max_uses`,
    [hash(token)],
  );
  if (!r || !canInvite(r) || (r.team_leader_id && (!r.leader_active || r.leader_role !== 'leader')))
    throw unavailable();
  return { inviterName: r.display_name, teamName: r.team_name ?? null, role: 'creator', expiresAt: r.expires_at };
}
/** Actor rows are locked before the invitation row, matching create/revoke/member changes. */
export async function lockInvitation(c: PoolConnection, token: string) {
  const [[lookup]] = await c.query<RowDataPacket[]>(
    'SELECT owner_user_id,team_leader_id FROM member_invitations WHERE token_hash=?',
    [hash(token)],
  );
  if (!lookup) throw unavailable();
  const [users] = await c.query<RowDataPacket[]>(
    'SELECT id,role,is_active,admin_duty FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE',
    [lookup.owner_user_id, lookup.team_leader_id],
  );
  const owner = users.find((u) => String(u.id) === String(lookup.owner_user_id));
  const leader = users.find((u) => String(u.id) === String(lookup.team_leader_id));
  const [[invite]] = await c.query<RowDataPacket[]>(
    'SELECT *,expires_at>NOW(3) unexpired FROM member_invitations WHERE token_hash=? FOR UPDATE',
    [hash(token)],
  );
  if (
    !owner ||
    !canInvite(owner) ||
    !invite ||
    invite.deleted_at ||
    invite.revoked_at ||
    Number(invite.unexpired) !== 1 ||
    invite.used_count >= invite.max_uses ||
    (invite.team_leader_id && (!leader?.is_active || leader.role !== 'leader'))
  )
    throw unavailable();
  return invite;
}
export async function consumeInvitation(c: PoolConnection, invite: RowDataPacket, userId: string) {
  await c.query('UPDATE member_invitations SET used_count=used_count+1 WHERE id=?', [invite.id]);
  await c.query('INSERT INTO member_invitation_uses(user_id,invitation_id) VALUES(?,?)', [userId, invite.id]);
  await writeAudit(
    {
      userId: String(invite.owner_user_id),
      action: 'team.invitation_registered',
      resourceType: 'user',
      resourceId: userId,
      detail: {
        invitationId: String(invite.id),
        leaderId: invite.team_leader_id ? String(invite.team_leader_id) : null,
      },
    },
    c,
  );
}
export async function createInvitation(auth: AuthUser, input: { label: string; validDays: number; maxUses: number }) {
  const token = randomBytes(32).toString('base64url');
  const id = await withTransaction(async (c) => {
    const [[owner]] = await c.query<RowDataPacket[]>(
      'SELECT role,admin_duty,is_active FROM users WHERE id=? FOR UPDATE',
      [auth.sub],
    );
    if (!owner || !canInvite(owner)) throw new AppError(403, 40301, '当前账号不能邀请成员');
    const [r] = await c.query<ResultSetHeader>(
      'INSERT INTO member_invitations(owner_user_id,team_leader_id,token_hash,token_cipher,label,max_uses,expires_at) VALUES(?,?,?,?,?,?,TIMESTAMPADD(DAY,?,NOW(3)))',
      [
        auth.sub,
        owner.role === 'leader' ? auth.sub : null,
        hash(token),
        sealInvitationToken(token),
        input.label,
        input.maxUses,
        input.validDays,
      ],
    );
    await writeAudit(
      {
        userId: auth.sub,
        action: 'team.invitation_create',
        resourceType: 'invitation',
        resourceId: String(r.insertId),
        detail: input,
      },
      c,
    );
    return String(r.insertId);
  });
  return { id, token };
}
export async function listInvitations(auth: AuthUser) {
  return rows(
    `SELECT CAST(i.id AS CHAR) id,i.label,CAST(i.owner_user_id AS CHAR) owner_id,u.display_name owner_name,l.display_name team_name,i.max_uses,i.used_count,i.expires_at,i.revoked_at,i.created_at,(i.token_cipher IS NOT NULL) can_copy,
    CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked' WHEN i.expires_at<=NOW(3) THEN 'expired' WHEN i.used_count>=i.max_uses THEN 'used' ELSE 'active' END status
    FROM member_invitations i JOIN users u ON u.id=i.owner_user_id LEFT JOIN users l ON l.id=i.team_leader_id
    WHERE i.owner_user_id=? AND i.deleted_at IS NULL ORDER BY i.id DESC`,
    [auth.sub],
  );
}
export async function revokeInvitation(auth: AuthUser, id: string) {
  await withTransaction(async (c) => {
    const [[actor]] = await c.query<RowDataPacket[]>(
      'SELECT role,admin_duty,is_active FROM users WHERE id=? FOR UPDATE',
      [auth.sub],
    );
    if (!actor || !canInvite(actor)) throw new AppError(403, 40301, '当前账号不能管理邀请');
    const [[invite]] = await c.query<RowDataPacket[]>('SELECT * FROM member_invitations WHERE id=? FOR UPDATE', [id]);
    if (!invite || invite.deleted_at || String(invite.owner_user_id) !== auth.sub)
      throw new AppError(403, 40301, '只能停用自己创建的邀请');
    await c.query('UPDATE member_invitations SET revoked_at=COALESCE(revoked_at,NOW(3)) WHERE id=?', [id]);
    await writeAudit(
      { userId: auth.sub, action: 'team.invitation_revoke', resourceType: 'invitation', resourceId: id },
      c,
    );
  });
}

async function ownedInvitation(c: PoolConnection, auth: AuthUser, id: string) {
  const [[actor]] = await c.query<RowDataPacket[]>(
    'SELECT role,admin_duty,is_active FROM users WHERE id=? FOR UPDATE',
    [auth.sub],
  );
  if (!actor || !canInvite(actor)) throw new AppError(403, 40301, '当前账号不能管理邀请');
  const [[invite]] = await c.query<RowDataPacket[]>('SELECT * FROM member_invitations WHERE id=? FOR UPDATE', [id]);
  if (!invite || invite.deleted_at || String(invite.owner_user_id) !== auth.sub)
    throw new AppError(403, 40301, '只能管理自己创建的邀请链接');
  return invite;
}

export async function invitationLink(auth: AuthUser, id: string) {
  return withTransaction(async (c) => {
    const invite = await ownedInvitation(c, auth, id);
    if (!invite.token_cipher) throw new AppError(409, 40920, '此历史链接无法再次复制，请重新生成链接');
    try {
      return { token: openInvitationToken(invite.token_cipher) };
    } catch {
      throw new AppError(409, 40920, '链接密钥已更新，请重新生成链接');
    }
  });
}

export async function updateInvitation(
  auth: AuthUser,
  id: string,
  input: { label?: string; maxUses?: number; expiresAt?: string; enabled?: boolean },
) {
  await withTransaction(async (c) => {
    const invite = await ownedInvitation(c, auth, id);
    if (input.maxUses !== undefined && input.maxUses < Number(invite.used_count))
      throw new AppError(422, 42220, '人数上限不能少于已注册人数');
    if (
      input.expiresAt &&
      (Date.parse(input.expiresAt) <= Date.now() || Date.parse(input.expiresAt) > Date.now() + 30 * 86400000)
    )
      throw new AppError(422, 42220, '新的有效期须在未来 30 天内');
    await c.query('UPDATE member_invitations SET label=?,max_uses=?,expires_at=?,revoked_at=? WHERE id=?', [
      input.label ?? invite.label,
      input.maxUses ?? invite.max_uses,
      input.expiresAt ? new Date(input.expiresAt) : invite.expires_at,
      input.enabled === undefined ? invite.revoked_at : input.enabled ? null : (invite.revoked_at ?? new Date()),
      id,
    ]);
    await writeAudit(
      { userId: auth.sub, action: 'team.invitation_update', resourceType: 'invitation', resourceId: id, detail: input },
      c,
    );
  });
}

export async function regenerateInvitation(auth: AuthUser, id: string) {
  return withTransaction(async (c) => {
    await ownedInvitation(c, auth, id);
    const token = randomBytes(32).toString('base64url');
    await c.query('UPDATE member_invitations SET token_hash=?,token_cipher=? WHERE id=?', [
      hash(token),
      sealInvitationToken(token),
      id,
    ]);
    await writeAudit(
      { userId: auth.sub, action: 'team.invitation_regenerate', resourceType: 'invitation', resourceId: id },
      c,
    );
    return { token };
  });
}

export async function deleteInvitation(auth: AuthUser, id: string) {
  await withTransaction(async (c) => {
    await ownedInvitation(c, auth, id);
    // Retain the invitation and usage history for attribution; invalidate the shared link immediately.
    await c.query(
      'UPDATE member_invitations SET deleted_at=NOW(3),revoked_at=COALESCE(revoked_at,NOW(3)),token_cipher=NULL WHERE id=?',
      [id],
    );
    await writeAudit(
      { userId: auth.sub, action: 'team.invitation_delete', resourceType: 'invitation', resourceId: id },
      c,
    );
  });
}
