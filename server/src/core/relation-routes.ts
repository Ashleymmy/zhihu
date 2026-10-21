import { Router } from 'express';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { rows } from '../db';
import { AppError, asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { isStaffRole } from '../auth/roles';
import { requireDuty } from './duties';

/**
 * 成员关系只读接口（P1a）。
 * - /mine：达人、团长看自己的邀请人、所在团队、直接 / 间接邀请人数和直接邀请名单（昵称脱敏，不给手机号和任何金额）
 * - /members/:id、/tree：运营岗位看任一成员的三种关系、时间线和成员树
 */
const id = z.string().regex(/^[1-9]\d*$/);
const pagination = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
};
const SOURCE_TEXT: Record<string, string> = {
  registration: '注册',
  invitation_accept: '接受邀请加入',
  application: '入团申请通过',
  transfer: '管理员调整团队',
  promotion: '晋升',
  demotion: '降级',
  removal: '移出团队',
  closure: '账号注销',
  migration: '历史数据整理',
  manual: '管理员调整角色',
};
const ROLE_TEXT: Record<string, string> = {
  creator: '达人',
  leader: '团长',
  admin: '管理员',
  operator: '运营',
  developer: '开发者',
};
const CHANNEL_TEXT: Record<string, string> = {
  leader_invite: '团长邀请链接',
  creator_invite: '达人邀请链接',
  staff_invite: '平台邀请链接',
  leader_created: '团长直接创建',
  organic: '自行注册',
  admin_assign: '平台创建',
  migration: '历史账号',
};

/** 昵称脱敏：保留首字，三个字及以上再保留末字 */
export function maskName(name: string | null | undefined): string {
  const chars = [...String(name ?? '').trim()];
  if (!chars.length) return '未命名';
  if (chars.length === 1) return chars[0] + '*';
  if (chars.length === 2) return chars[0] + '*';
  return chars[0] + '*'.repeat(Math.min(chars.length - 2, 3)) + chars[chars.length - 1];
}
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

async function layerCounts(userId: string) {
  const [row] = await rows<RowDataPacket>(
    'SELECT COALESCE(SUM(depth=1),0) direct,COALESCE(SUM(depth>=2),0) indirect FROM member_referral_closure WHERE ancestor_id=?',
    [userId],
  );
  return { direct: Number(row?.direct ?? 0), indirect: Number(row?.indirect ?? 0) };
}

export function createRelationRouter() {
  const router = Router();

  router.get(
    '/mine',
    asyncHandler(async (req, res) => {
      const paging = z.object(pagination).strict().parse(req.query);
      if (!['creator', 'leader'].includes(req.user.role))
        throw new AppError(403, 40300, '请使用团长或达人账号查看邀请关系');
      const me = req.user.sub;
      const [referral] = await rows<RowDataPacket>(
        `SELECT r.channel,r.registered_at,i.display_name inviter_name,i.role inviter_role
         FROM member_referrals r LEFT JOIN users i ON i.id=r.inviter_id WHERE r.user_id=?`,
        [me],
      );
      const [team] = await rows<RowDataPacket>(
        `SELECT m.leader_id,l.display_name leader_name,m.effective_from
         FROM team_memberships m LEFT JOIN users l ON l.id=m.leader_id WHERE m.open_user=?`,
        [me],
      );
      const direct = await rows<RowDataPacket>(
        `SELECT u.display_name,u.closed_at,r.registered_at,r.channel
         FROM member_referrals r JOIN users u ON u.id=r.user_id WHERE r.inviter_id=?
         ORDER BY r.registered_at DESC,r.user_id DESC LIMIT ? OFFSET ?`,
        [me, paging.pageSize + 1, (paging.page - 1) * paging.pageSize],
      );
      ok(res, {
        inviter: referral?.inviter_name
          ? { name: isStaffRole(String(referral.inviter_role)) ? '平台工作人员' : maskName(referral.inviter_name) }
          : null,
        registeredAt: referral?.registered_at ?? null,
        channel: referral ? (CHANNEL_TEXT[String(referral.channel)] ?? '') : null,
        team: team
          ? { leaderName: team.leader_id ? String(team.leader_name) : null, since: team.effective_from }
          : null,
        counts: await layerCounts(me),
        page: paging.page,
        hasMore: direct.length > paging.pageSize,
        directList: direct.slice(0, paging.pageSize).map((row) => ({
          name: row.closed_at ? '已注销用户' : maskName(row.display_name),
          registeredAt: row.registered_at,
          channel: CHANNEL_TEXT[String(row.channel)] ?? '',
          active: !row.closed_at,
        })),
      });
    }),
  );

  router.get(
    '/members/:id',
    requireDuty('operations'),
    asyncHandler(async (req, res) => {
      const paging = z.object(pagination).strict().parse(req.query);
      const userId = id.parse(req.params.id);
      const [user] = await rows<RowDataPacket>(
        'SELECT id,display_name,role,is_active,closed_at FROM users WHERE id=?',
        [userId],
      );
      if (!user) throw new AppError(404, 40400, '成员不存在');
      const [referral] = await rows<RowDataPacket>(
        `SELECT r.inviter_id,r.channel,r.registered_at,i.display_name inviter_name
         FROM member_referrals r LEFT JOIN users i ON i.id=r.inviter_id WHERE r.user_id=?`,
        [userId],
      );
      const memberships = await rows<RowDataPacket>(
        `SELECT m.leader_id,m.source,m.reason,m.effective_from,m.effective_to,l.display_name leader_name,o.display_name operator_name
         FROM team_memberships m LEFT JOIN users l ON l.id=m.leader_id LEFT JOIN users o ON o.id=m.operator_id
         WHERE m.user_id=? ORDER BY m.effective_from DESC,m.id DESC LIMIT ? OFFSET ?`,
        [userId, paging.pageSize, (paging.page - 1) * paging.pageSize],
      );
      const roles = await rows<RowDataPacket>(
        `SELECT h.from_role,h.to_role,h.reason,h.effective_at,h.note,o.display_name operator_name
         FROM member_role_history h LEFT JOIN users o ON o.id=h.operator_id
         WHERE h.user_id=? ORDER BY h.effective_at DESC,h.id DESC LIMIT ? OFFSET ?`,
        [userId, paging.pageSize, (paging.page - 1) * paging.pageSize],
      );
      const [open] = await rows<RowDataPacket>(
        `SELECT m.leader_id,l.display_name leader_name,m.effective_from FROM team_memberships m LEFT JOIN users l ON l.id=m.leader_id WHERE m.open_user=?`,
        [userId],
      );
      const [count] = await rows<RowDataPacket>(
        `SELECT (SELECT COUNT(*) FROM team_memberships WHERE user_id=?) teams,(SELECT COUNT(*) FROM member_role_history WHERE user_id=?) roles`,
        [userId, userId],
      );
      const timeline = [
        ...memberships.map((m) => ({
          at: m.effective_from,
          kind: 'team' as const,
          title:
            m.source === 'migration'
              ? `整理时归属：${m.leader_id ? m.leader_name + '的团队' : '平台直管'}`
              : m.leader_id
                ? `加入 ${m.leader_name} 的团队`
                : '平台直管',
          detail: [SOURCE_TEXT[String(m.source)] ?? '', m.reason ?? ''].filter(Boolean).join(' · '),
          operator: str(m.operator_name),
        })),
        ...roles.map((h) => ({
          at: h.effective_at,
          kind: 'role' as const,
          title:
            h.reason === 'migration'
              ? `整理时角色：${ROLE_TEXT[String(h.to_role)] ?? h.to_role}`
              : h.from_role
                ? `${ROLE_TEXT[String(h.from_role)] ?? h.from_role} → ${ROLE_TEXT[String(h.to_role)] ?? h.to_role}`
                : `成为${ROLE_TEXT[String(h.to_role)] ?? h.to_role}`,
          detail:
            h.reason === 'migration'
              ? '历史角色基线；此前变更时间未核实'
              : [SOURCE_TEXT[String(h.reason)] ?? '', h.note ?? ''].filter(Boolean).join(' · '),
          operator: str(h.operator_name),
        })),
      ].sort((a, b) => new Date(b.at as string).getTime() - new Date(a.at as string).getTime());
      ok(res, {
        user: {
          id: String(user.id),
          name: String(user.display_name),
          role: String(user.role),
          active: !!user.is_active && !user.closed_at,
        },
        referral: referral
          ? {
              inviter: referral.inviter_id
                ? { id: String(referral.inviter_id), name: String(referral.inviter_name) }
                : null,
              channel: CHANNEL_TEXT[String(referral.channel)] ?? '',
              registeredAt: referral.registered_at,
            }
          : null,
        team: open
          ? {
              leader: open.leader_id ? { id: String(open.leader_id), name: String(open.leader_name) } : null,
              since: open.effective_from,
            }
          : null,
        counts: await layerCounts(userId),
        timeline,
        hasMore: Math.max(Number(count.teams), Number(count.roles)) > paging.page * paging.pageSize,
        total: Number(count.teams) + Number(count.roles),
        page: paging.page,
      });
    }),
  );

  router.get(
    '/tree',
    requireDuty('operations'),
    asyncHandler(async (req, res) => {
      const q = z
        .object({
          ...pagination,
          mode: z.enum(['team', 'invite']).default('team'),
          parent: z.union([id, z.literal('platform')]).optional(),
        })
        .strict()
        .parse(req.query);
      const node = (r: RowDataPacket) => ({
        id: String(r.id),
        name: String(r.display_name),
        role: String(r.role),
        active: !!r.is_active && !r.closed_at,
        children: Number(r.children ?? 0),
      });
      let list: RowDataPacket[];
      if (q.mode === 'team') {
        const memberCount = `(SELECT COUNT(*) FROM team_memberships c WHERE c.leader_id=u.id AND c.effective_to IS NULL)`;
        if (!q.parent) {
          list = await rows<RowDataPacket>(
            `SELECT u.id,u.display_name,u.role,u.is_active,u.closed_at,${memberCount} children
             FROM users u WHERE u.role='leader' AND u.closed_at IS NULL ORDER BY u.id LIMIT ? OFFSET ?`,
            [q.pageSize + 1, (q.page - 1) * q.pageSize],
          );
          const [platform] = await rows<RowDataPacket>(
            `SELECT COUNT(*) n FROM team_memberships m JOIN users u ON u.id=m.user_id
             WHERE m.effective_to IS NULL AND m.leader_id IS NULL AND u.role='creator' AND u.closed_at IS NULL`,
          );
          ok(res, {
            list: [
              ...(q.page === 1
                ? [
                    {
                      id: 'platform',
                      name: '平台直管',
                      role: 'platform',
                      active: true,
                      children: Number(platform?.n ?? 0),
                    },
                  ]
                : []),
              ...list.slice(0, q.pageSize).map(node),
            ],
            page: q.page,
            hasMore: list.length > q.pageSize,
          });
          return;
        }
        list = await rows<RowDataPacket>(
          `SELECT u.id,u.display_name,u.role,u.is_active,u.closed_at,0 children
           FROM team_memberships m JOIN users u ON u.id=m.user_id
           WHERE m.effective_to IS NULL AND ${q.parent === 'platform' ? "m.leader_id IS NULL AND u.role='creator'" : 'm.leader_id=?'}
           ORDER BY m.effective_from,u.id LIMIT ? OFFSET ?`,
          [...(q.parent === 'platform' ? [] : [q.parent]), q.pageSize + 1, (q.page - 1) * q.pageSize],
        );
      } else {
        const inviteCount = `(SELECT COUNT(*) FROM member_referral_closure c WHERE c.ancestor_id=u.id AND c.depth=1)`;
        // 邀请树的根：没有邀请人，或邀请人是平台员工
        list = await rows<RowDataPacket>(
          q.parent && q.parent !== 'platform'
            ? `SELECT u.id,u.display_name,u.role,u.is_active,u.closed_at,${inviteCount} children
               FROM member_referrals r JOIN users u ON u.id=r.user_id WHERE r.inviter_id=? ORDER BY r.registered_at,u.id LIMIT ? OFFSET ?`
            : `SELECT u.id,u.display_name,u.role,u.is_active,u.closed_at,${inviteCount} children
               FROM member_referrals r JOIN users u ON u.id=r.user_id LEFT JOIN users i ON i.id=r.inviter_id
               WHERE u.role IN ('creator','leader') AND (r.inviter_id IS NULL OR i.role NOT IN ('creator','leader'))
               ORDER BY u.id LIMIT ? OFFSET ?`,
          [...(q.parent && q.parent !== 'platform' ? [q.parent] : []), q.pageSize + 1, (q.page - 1) * q.pageSize],
        );
      }
      ok(res, { list: list.slice(0, q.pageSize).map(node), page: q.page, hasMore: list.length > q.pageSize });
    }),
  );

  return router;
}
