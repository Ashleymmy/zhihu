import crypto from 'node:crypto';
import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import type { AuthUser } from '../types';
import { asyncHandler, AppError } from '../middleware/errors';
import { requireAuth } from '../auth/middleware';
import { requireWechatContext } from './context';
import { createInvitation, invitationPreview } from '../services/invitations.service';
import { openInvitationToken } from '../utils/invitationToken';
import { ok } from '../utils/response';

export async function resolveInvitationCode(code: string) {
  const [invite] = await rows<RowDataPacket>(
    `SELECT i.token_cipher FROM mini_invitation_codes c JOIN member_invitations i ON i.id=c.invitation_id AND BINARY i.token_hash=BINARY c.token_hash WHERE c.code=?`,
    [code],
  );
  if (!invite?.token_cipher) throw new AppError(422, 42220, '邀请码无效，请联系邀请人获取新的邀请码');
  const token = openInvitationToken(invite.token_cipher);
  await invitationPreview(token);
  return token;
}
async function codeFor(auth: AuthUser) {
  const [existing] = await rows<RowDataPacket>(
    `SELECT c.code,i.used_count,i.expires_at FROM mini_invitation_codes c JOIN member_invitations i ON i.id=c.invitation_id AND BINARY i.token_hash=BINARY c.token_hash WHERE i.owner_user_id=? AND i.revoked_at IS NULL AND i.deleted_at IS NULL AND i.expires_at>NOW(3) AND i.used_count<i.max_uses ORDER BY i.id DESC LIMIT 1`,
    [auth.sub],
  );
  if (existing) {
    try {
      await resolveInvitationCode(existing.code);
      return existing;
    } catch (error) {
      if (!(error instanceof AppError) || error.httpStatus !== 422) throw error;
    }
  }
  const invitation = await createInvitation(auth, { label: '小程序邀请码', validDays: 30, maxUses: 1000 }, 'mini');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(crypto.randomBytes(8), (n) => alphabet[n % alphabet.length]).join('');
  await withTransaction(async (c) => {
    await c.query(
      'INSERT INTO mini_invitation_codes(invitation_id,code,token_hash) SELECT id,?,token_hash FROM member_invitations WHERE id=?',
      [code, invitation.id],
    );
  });
  return { code };
}
export const miniInvitationsRouter = Router();
miniInvitationsRouter.use((req, _res, next) => {
  try {
    requireWechatContext(req);
    next();
  } catch (e) {
    next(e);
  }
});
miniInvitationsRouter.use(requireAuth);
miniInvitationsRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const code = await codeFor(req.user);
    const [count] = await rows<RowDataPacket>(
      'SELECT COUNT(*) total FROM member_invitation_uses u JOIN member_invitations i ON i.id=u.invitation_id WHERE i.owner_user_id=?',
      [req.user.sub],
    );
    ok(res, {
      code: code.code,
      usageCount: Number(count.total),
      rewardsEnabled: false,
      total: '0.00',
      rewardAmount: '0.00',
    });
  }),
);
miniInvitationsRouter.get(
  '/rewards',
  asyncHandler(async (req, res) => {
    const records = await rows<RowDataPacket>(
      `SELECT CAST(u.id AS CHAR) id,u.display_name name,iu.registered_at time,'0.00' amount FROM member_invitation_uses iu JOIN users u ON u.id=iu.user_id JOIN member_invitations i ON i.id=iu.invitation_id WHERE i.owner_user_id=? ORDER BY iu.registered_at DESC LIMIT 100`,
      [req.user.sub],
    );
    ok(res, { records, total: '0.00', rewardsEnabled: false });
  }),
);
miniInvitationsRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const [used] = await rows('SELECT user_id FROM member_invitation_uses WHERE user_id=?', [req.user.sub]);
    ok(res, { used: !!used, registrationOnly: true });
  }),
);
miniInvitationsRouter.post(
  '/use',
  asyncHandler(async () => {
    throw new AppError(409, 40920, '邀请码仅在注册时绑定；已有账号如需调整归属，请联系管理员');
  }),
);
