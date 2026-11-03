import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { AuthUser } from '../types';
import { db, rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { writeAudit } from '../services/audit.service';
import { openMemberProjects } from '../services/member-onboarding.service';
import { lifecycleProviders } from './account-lifecycle';
import type { ModuleRuntime } from './module-runtime';
import { recordRoleChange, setTeamLeader } from './member-relations';

/**
 * 晋升（P1b）：运营提名 → 另一位运营或完整管理员审核。
 * 审核通过时在同一事务里：达人改为团长并转为平台直管；其直接邀请的成员按审核时的选择跟随或留下；
 * 写角色历史、团队归属历史，改写邀请链接的所属团队，并让相关账号重新登录以拿到新角色。
 * 原团长此后不再从晋升者及跟随成员获得团队收益（决策 3）。本阶段不改动任何金额计算。
 */
export interface PromotionMetrics {
  from: string;
  to: string;
  activeDays: number;
  records: number;
  quantities: { label: string; unit: string; quantity: string }[];
  memberDays: number;
}
export interface PlanMember {
  id: string;
  name: string;
  active: boolean;
  leaderId: string | null;
  leaderName: string | null;
  defaultAction: 'follow' | 'stay';
}

type Queryable = Pick<PoolConnection, 'query'> | typeof db;
const WINDOW_DAYS = 30;
const OPEN = ['candidate', 'proposed'];

function window30() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const to = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(today) - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  return { from, to };
}
const idText = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** 近 30 天（截至昨天）本人完成的业绩：有业绩的天数、业绩条数、各类数量；不含金额和邀请人数 */
export async function promotionMetrics(c: Queryable, userId: string, visibleModules?: string[]): Promise<PromotionMetrics> {
  const { from, to } = window30();
  // 成员首页只展示当前可见项目；运营提名仍使用完整的历史业绩作为人工审核参考。
  const visibility = visibleModules === undefined ? '' : `
      AND EXISTS(SELECT 1 FROM projects p
        JOIN project_integrations pi ON pi.project_id=p.id AND pi.account_id=s.account_id
        JOIN integration_accounts a ON a.id=pi.account_id AND a.module_id=s.module_id
        WHERE p.id=s.project_id AND p.is_enabled=1 AND a.status='active' AND a.module_id IN (?)
          AND EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=? AND pm.left_at IS NULL))`;
  const args = [userId, from, to, ...(visibleModules === undefined ? [] : [visibleModules.length ? visibleModules : [''], userId])];
  const base = `FROM opc_earning_lines l JOIN opc_earning_sources s ON s.id=l.source_id
    WHERE l.performer_id=? AND l.payee_id=l.performer_id AND l.source_version=s.current_version AND l.is_internal=0
      AND s.business_date BETWEEN ? AND ?${visibility}`;
  const [[summary]] = await c.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT s.business_date) active_days,COUNT(DISTINCT s.id) records ${base}`,
    args,
  );
  const [byMetric] = await c.query<RowDataPacket[]>(
    `SELECT s.metric_label label,s.quantity_unit unit,SUM(l.quantity) quantity ${base}
     GROUP BY s.metric_type,s.metric_label,s.quantity_unit ORDER BY s.metric_type LIMIT 8`,
    args,
  );
  const [[user]] = await c.query<RowDataPacket[]>(
    'SELECT GREATEST(DATEDIFF(NOW(),COALESCE(r.registered_at,u.created_at)),0) days FROM users u LEFT JOIN member_referrals r ON r.user_id=u.id WHERE u.id=?',
    [userId],
  );
  return {
    from,
    to,
    activeDays: Number(summary?.active_days ?? 0),
    records: Number(summary?.records ?? 0),
    quantities: byMetric.map((m) => ({ label: String(m.label), unit: String(m.unit), quantity: String(m.quantity ?? 0) })),
    memberDays: Number(user?.days ?? 0),
  };
}

/** 直接邀请的有效达人；和被提名人同在一个团队（含同为平台直管）的默认跟随 */
export async function planMembers(c: Queryable, userId: string, lock = false): Promise<PlanMember[]> {
  const [[me]] = await c.query<RowDataPacket[]>('SELECT leader_id FROM team_memberships WHERE open_user=?', [userId]);
  const myLeader = idText(me?.leader_id);
  const [list] = await c.query<RowDataPacket[]>(
    `SELECT u.id,u.display_name,u.is_active,u.closed_at,m.leader_id,l.display_name leader_name
     FROM member_referrals r JOIN users u ON u.id=r.user_id
     LEFT JOIN team_memberships m ON m.open_user=u.id LEFT JOIN users l ON l.id=m.leader_id
     WHERE r.inviter_id=? AND u.role='creator' AND u.closed_at IS NULL
     ORDER BY r.registered_at,u.id LIMIT 500${lock ? ' FOR UPDATE OF u' : ''}`,
    [userId],
  );
  return list.map((u) => ({
    id: String(u.id),
    name: String(u.display_name),
    active: !!u.is_active,
    leaderId: idText(u.leader_id),
    leaderName: u.leader_name == null ? null : String(u.leader_name),
    defaultAction: u.is_active && idText(u.leader_id) === myLeader ? 'follow' : 'stay',
  }));
}

async function lockedUser(c: PoolConnection, userId: string) {
  const [[user]] = await c.query<RowDataPacket[]>(
    'SELECT id,role,is_active,closed_at,parent_id,display_name FROM users WHERE id=? FOR UPDATE',
    [userId],
  );
  return user;
}
const nominable = (u: RowDataPacket | undefined) => !!u && u.role === 'creator' && !!u.is_active && !u.closed_at;

export async function nominate(auth: AuthUser, input: { userId: string; note: string }) {
  return withTransaction(async (c) => {
    const user = await lockedUser(c, input.userId);
    if (!user) throw new AppError(404, 40400, '成员不存在');
    if (!nominable(user)) throw new AppError(409, 40900, '只能提名在用的达人账号');
    const metrics = await promotionMetrics(c, input.userId);
    const [[team]] = await c.query<RowDataPacket[]>('SELECT leader_id FROM team_memberships WHERE open_user=?', [input.userId]);
    try {
      const [r] = await c.query<ResultSetHeader>(
        `INSERT INTO member_promotions(user_id,status,trigger_type,metrics_snapshot,from_leader_id,note,proposed_by)
         VALUES(?,'proposed','manual',?,?,?,?)`,
        [input.userId, JSON.stringify(metrics), idText(team?.leader_id), input.note, auth.sub],
      );
      await writeAudit(
        { userId: auth.sub, action: 'member.promotion_propose', resourceType: 'user', resourceId: input.userId, detail: { promotionId: String(r.insertId) } },
        c,
      );
      return { id: String(r.insertId) };
    } catch (e) {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw new AppError(409, 40900, '该成员已有一张审核中的晋升提名');
      throw e;
    }
  });
}

async function lockedPromotion(c: PoolConnection, id: string) {
  const [[p]] = await c.query<RowDataPacket[]>('SELECT * FROM member_promotions WHERE id=? FOR UPDATE', [id]);
  if (!p) throw new AppError(404, 40400, '晋升提名不存在');
  if (!OPEN.includes(String(p.status))) throw new AppError(409, 40900, '这张提名已经处理过了');
  return p;
}
function assertReviewer(auth: AuthUser, p: RowDataPacket) {
  if (idText(p.proposed_by) === auth.sub) throw new AppError(403, 40301, '提名人不能审核自己的提名，请让另一位同事审核');
}

export async function approve(auth: AuthUser, id: string, input: { follow: string[]; note?: string }, runtime: ModuleRuntime) {
  return withTransaction(async (c) => {
    const p = await lockedPromotion(c, id);
    assertReviewer(auth, p);
    const userId = String(p.user_id);
    const user = await lockedUser(c, userId);
    if (!nominable(user)) throw new AppError(409, 40900, '该成员的账号状态已经变化，请退回这张提名');
    const members = await planMembers(c, userId, true);
    const byId = new Map(members.map((m) => [m.id, m]));
    const follow = [...new Set(input.follow)];
    for (const memberId of follow) {
      const m = byId.get(memberId);
      if (!m) throw new AppError(422, 42200, '跟随成员只能是被提名人直接邀请的在用达人');
      if (!m.active) throw new AppError(409, 40900, `${m.name} 的账号已停用，不能跟随`);
    }
    const providers = await lifecycleProviders(c, runtime);
    for (const [who, name] of [[userId, String(user!.display_name)], ...follow.map((f) => [f, byId.get(f)!.name])] as [string, string][]) {
      for (const provider of providers) {
        const reasons = await provider.accessChangeBlockers?.(c, who);
        if (reasons?.length) throw new AppError(409, 40900, `${name}：${reasons.join('；')}`);
      }
    }
    const fromLeader = idText(user!.parent_id);
    const ref = { source: 'promotion' as const, refType: 'promotion', refId: id, operatorId: auth.sub };
    // 先改角色，跟随成员才能挂到新团长名下
    await c.query(
      "UPDATE users SET role='leader',role_id=(SELECT id FROM roles WHERE role_key='leader'),parent_id=NULL WHERE id=?",
      [userId],
    );
    await recordRoleChange(c, { userId, fromRole: 'creator', toRole: 'leader', reason: 'promotion', promotionId: id, operatorId: auth.sub, note: input.note ?? null });
    await setTeamLeader(c, { userId, parentId: null, reason: '晋升为团长', ...ref });
    await openMemberProjects(c, userId, 'leader', null, auth.sub);
    for (const memberId of follow) {
      await c.query('UPDATE users SET parent_id=? WHERE id=?', [userId, memberId]);
      await setTeamLeader(c, { userId: memberId, parentId: userId, reason: '跟随邀请人加入新团队', ...ref });
      await openMemberProjects(c, memberId, 'creator', userId, auth.sub);
    }
    // 邀请链接按新身份改写所属团队，与此刻新建链接的结果一致：本人的链接邀请进自己的团队；跟随成员的小程序链接跟到新团队
    await c.query(
      'UPDATE member_invitations SET team_leader_id=? WHERE owner_user_id=? AND revoked_at IS NULL AND deleted_at IS NULL',
      [userId, userId],
    );
    if (follow.length)
      await c.query(
        "UPDATE member_invitations SET team_leader_id=? WHERE owner_user_id IN (?) AND source='mini' AND revoked_at IS NULL AND deleted_at IS NULL",
        [userId, follow],
      );
    const changed = [userId, ...follow];
    await c.query(
      "UPDATE login_sessions SET revoked_at=NOW(3),revoke_reason='member_access_changed' WHERE user_id IN (?) AND revoked_at IS NULL",
      [changed],
    );
    await c.query(
      "UPDATE token_sessions SET revoked_at=NOW(3),revoke_reason='member_access_changed' WHERE user_id IN (?) AND revoked_at IS NULL",
      [changed],
    );
    const plan = members.map((m) => ({ userId: m.id, name: m.name, action: follow.includes(m.id) ? 'follow' : 'stay', fromLeaderId: m.leaderId }));
    await c.query(
      "UPDATE member_promotions SET status='approved',reviewed_by=?,decided_at=NOW(3),member_plan=?,review_note=? WHERE id=?",
      [auth.sub, JSON.stringify(plan), input.note ?? null, id],
    );
    await writeAudit(
      { userId: auth.sub, action: 'member.promotion_approve', resourceType: 'user', resourceId: userId, detail: { promotionId: id, fromLeader, follow } },
      c,
    );
    return { followed: follow.length, stayed: members.length - follow.length };
  });
}

export async function decline(auth: AuthUser, id: string, status: 'rejected' | 'cancelled', reason: string) {
  return withTransaction(async (c) => {
    const p = await lockedPromotion(c, id);
    if (status === 'rejected') assertReviewer(auth, p);
    await c.query('UPDATE member_promotions SET status=?,reviewed_by=?,decided_at=NOW(3),review_note=? WHERE id=?', [
      status, auth.sub, reason, id,
    ]);
    await writeAudit(
      { userId: auth.sub, action: 'member.promotion_' + (status === 'rejected' ? 'reject' : 'cancel'), resourceType: 'user', resourceId: String(p.user_id), detail: { promotionId: id, reason } },
      c,
    );
  });
}

const LIST_SQL = `SELECT p.*,u.display_name user_name,u.role user_role,l.display_name leader_name,
    pb.display_name proposer_name,rb.display_name reviewer_name
  FROM member_promotions p JOIN users u ON u.id=p.user_id LEFT JOIN users l ON l.id=p.from_leader_id
  LEFT JOIN users pb ON pb.id=p.proposed_by LEFT JOIN users rb ON rb.id=p.reviewed_by`;
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
function shape(p: RowDataPacket, viewer: AuthUser) {
  const plan = json(p.member_plan) as { action: string }[] | null;
  return {
    id: String(p.id),
    status: String(p.status),
    trigger: String(p.trigger_type),
    user: { id: String(p.user_id), name: String(p.user_name), role: String(p.user_role) },
    fromLeader: p.from_leader_id ? { id: String(p.from_leader_id), name: String(p.leader_name) } : null,
    metrics: json(p.metrics_snapshot) as PromotionMetrics,
    note: String(p.note),
    proposer: p.proposed_by ? { id: String(p.proposed_by), name: String(p.proposer_name) } : null,
    proposedAt: p.proposed_at,
    reviewer: p.reviewed_by ? { id: String(p.reviewed_by), name: String(p.reviewer_name) } : null,
    decidedAt: p.decided_at,
    reviewNote: p.review_note == null ? null : String(p.review_note),
    followed: plan ? plan.filter((m) => m.action === 'follow').length : null,
    canReview: OPEN.includes(String(p.status)) && idText(p.proposed_by) !== viewer.sub,
  };
}

export async function listPromotions(viewer: AuthUser, view: 'open' | 'done') {
  const list = await rows<RowDataPacket>(
    view === 'open'
      ? `${LIST_SQL} WHERE p.status IN ('candidate','proposed') ORDER BY p.proposed_at,p.id LIMIT 200`
      : `${LIST_SQL} WHERE p.status IN ('approved','rejected','cancelled') ORDER BY p.decided_at DESC,p.id DESC LIMIT 100`,
  );
  return list.map((p) => shape(p, viewer));
}

export async function promotionDetail(viewer: AuthUser, id: string) {
  const [p] = await rows<RowDataPacket>(`${LIST_SQL} WHERE p.id=?`, [id]);
  if (!p) throw new AppError(404, 40400, '晋升提名不存在');
  const item = shape(p, viewer);
  const plan = json(p.member_plan) as { userId: string; name: string; action: 'follow' | 'stay'; fromLeaderId: string | null }[] | null;
  // 已处理的提名展示当时的去向；审核中的提名展示此刻的直接邀请成员和默认去向
  const members = plan
    ? plan.map((m) => ({ id: m.userId, name: m.name, active: true, leaderId: m.fromLeaderId, leaderName: null, defaultAction: m.action }))
    : await planMembers(db, item.user.id);
  return { ...item, members };
}

/** 成员关系图的「提名晋升」：先看指标，再决定是否提名 */
export async function nomineePreview(userId: string) {
  const [user] = await rows<RowDataPacket>('SELECT id,display_name,role,is_active,closed_at FROM users WHERE id=?', [userId]);
  if (!user) throw new AppError(404, 40400, '成员不存在');
  const [open] = await rows<RowDataPacket>('SELECT id FROM member_promotions WHERE open_user=?', [userId]);
  return {
    user: { id: String(user.id), name: String(user.display_name), role: String(user.role) },
    nominable: nominable(user),
    openPromotionId: open ? String(open.id) : null,
    metrics: await promotionMetrics(db, userId),
    members: await planMembers(db, userId),
  };
}
