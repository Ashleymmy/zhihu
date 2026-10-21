import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

/**
 * 成员关系底座（P0）。三种关系分开存：
 * - 邀请关系 member_referrals（注册时写一次，之后不变）+ 闭包 member_referral_closure（分层人数用）
 * - 团队归属 team_memberships（关旧开新，同一时刻每人一条有效记录）
 * - 角色变更 member_role_history
 * users.parent_id 继续作为「当前团长」缓存：调用方改 parent_id 时，在同一事务里调用这里写历史。
 * 所有函数都使用调用方传入的事务连接，不自己开事务。
 */

type Id = string | number;
type Conn = Pick<PoolConnection, 'query'>;
export type ReferralChannel =
  'leader_invite' | 'creator_invite' | 'staff_invite' | 'leader_created' | 'organic' | 'admin_assign' | 'migration';
export type MembershipSource =
  | 'registration'
  | 'invitation_accept'
  | 'application'
  | 'transfer'
  | 'promotion'
  | 'demotion'
  | 'removal'
  | 'closure'
  | 'migration';

const text = (v: Id | null | undefined) => (v === null || v === undefined || v === '' ? null : String(v));

/** parent_id 只有指向团长时才算团队；员工名下或空都视为平台直管（leader_id 为 NULL） */
async function teamLeaderOf(c: Conn, parentId: Id | null | undefined): Promise<string | null> {
  const id = text(parentId);
  if (!id) return null;
  const [[parent]] = await c.query<RowDataPacket[]>('SELECT role FROM users WHERE id=?', [id]);
  return parent?.role === 'leader' ? id : null;
}

/** 注册来源：有邀请链接时按链接所有人的角色区分 */
async function channelFor(c: Conn, inviterId: string | null, invitationId: string | null, fallback: ReferralChannel) {
  if (!inviterId || !invitationId) return fallback;
  const [[owner]] = await c.query<RowDataPacket[]>('SELECT role FROM users WHERE id=?', [inviterId]);
  return owner?.role === 'leader' ? 'leader_invite' : owner?.role === 'creator' ? 'creator_invite' : 'staff_invite';
}

/**
 * 新账号创建后调用：写邀请关系与闭包、第一条团队归属、第一条角色记录。
 * 重复调用不会重复写入（邀请关系以 user_id 为主键）。
 */
export async function recordRegistration(
  c: Conn,
  input: {
    userId: Id;
    role: string;
    parentId?: Id | null;
    inviterId?: Id | null;
    invitationId?: Id | null;
    channel: ReferralChannel;
    operatorId?: Id | null;
  },
) {
  const userId = String(input.userId),
    inviterId = text(input.inviterId),
    invitationId = text(input.invitationId);
  await c.query('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
  const channel = await channelFor(c, inviterId, invitationId, input.channel);
  // 已有邀请关系就不再写（邀请关系不可变）；不依赖 affectedRows，驱动可能把重复键也计为受影响
  const [[existing]] = await c.query<RowDataPacket[]>(
    'SELECT user_id FROM member_referrals WHERE user_id=? FOR UPDATE',
    [userId],
  );
  if (existing) return;
  if (!existing) {
    const inviter = inviterId === userId ? null : inviterId;
    await c.query(
      'INSERT INTO member_referrals(user_id,inviter_id,invitation_id,channel,registered_at) VALUES(?,?,?,?,NOW(3))',
      [userId, inviter, invitationId, channel],
    );
    if (inviter)
      await c.query(
        `INSERT INTO member_referral_closure(ancestor_id,descendant_id,depth)
         SELECT ancestor_id,?,depth+1 FROM member_referral_closure WHERE descendant_id=? AND ancestor_id<>?
         UNION ALL SELECT ?,?,1`,
        [userId, inviter, userId, inviter, userId],
      );
  }
  await setTeamLeader(c, { userId, parentId: input.parentId, source: 'registration', operatorId: input.operatorId });
  await recordRoleChange(c, {
    userId,
    fromRole: null,
    toRole: input.role,
    reason: 'registration',
    operatorId: input.operatorId,
  });
}

/**
 * 团队归属变更：关掉当前有效记录、开一条新记录；团长没变时不写。
 * 新记录从旧记录结束的同一时刻开始，保证按业绩日期查团长时没有空档。
 */
export async function setTeamLeader(
  c: Conn,
  input: {
    userId: Id;
    parentId: Id | null | undefined;
    source: MembershipSource;
    refType?: string | null;
    refId?: Id | null;
    reason?: string | null;
    operatorId?: Id | null;
  },
) {
  const userId = String(input.userId);
  await c.query('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
  const leaderId = await teamLeaderOf(c, input.parentId);
  const [[open]] = await c.query<RowDataPacket[]>(
    'SELECT id,leader_id FROM team_memberships WHERE open_user=? FOR UPDATE',
    [userId],
  );
  if (open && text(open.leader_id) === leaderId) return;
  let from: unknown = null;
  if (open) {
    // 同一毫秒内连续变更时，结束时间至少比开始晚 1 毫秒，满足 effective_to > effective_from
    await c.query(
      'UPDATE team_memberships SET effective_to=GREATEST(NOW(3),effective_from + INTERVAL 1000 MICROSECOND) WHERE id=?',
      [open.id],
    );
    const [closed] = await c.query<RowDataPacket[]>('SELECT effective_to FROM team_memberships WHERE id=?', [open.id]);
    from = closed[0]?.effective_to ?? null;
  }
  await c.query(
    `INSERT INTO team_memberships(user_id,leader_id,source,effective_from,ref_type,ref_id,reason,operator_id)
     VALUES(?,?,?,COALESCE(?,NOW(3)),?,?,?,?)`,
    [
      userId,
      leaderId,
      input.source,
      from,
      input.refType ?? null,
      text(input.refId),
      input.reason ?? null,
      text(input.operatorId),
    ],
  );
}

/** 注销等场景：结束当前团队归属，不再开新记录 */
export async function closeTeamMembership(
  c: Conn,
  input: { userId: Id; reason?: string | null; operatorId?: Id | null },
) {
  await c.query(
    `UPDATE team_memberships SET effective_to=GREATEST(NOW(3),effective_from + INTERVAL 1000 MICROSECOND),
       reason=COALESCE(?,reason),operator_id=COALESCE(?,operator_id) WHERE open_user=?`,
    [input.reason ?? null, text(input.operatorId), String(input.userId)],
  );
}

export async function recordRoleChange(
  c: Conn,
  input: {
    userId: Id;
    fromRole: string | null;
    toRole: string;
    reason: 'registration' | 'promotion' | 'demotion' | 'manual' | 'migration';
    operatorId?: Id | null;
    note?: string | null;
  },
) {
  if (input.fromRole === input.toRole) return;
  await c.query(
    'INSERT INTO member_role_history(user_id,from_role,to_role,reason,operator_id,effective_at,note) VALUES(?,?,?,?,?,NOW(3),?)',
    [String(input.userId), input.fromRole, input.toRole, input.reason, text(input.operatorId), input.note ?? null],
  );
}

/* ------------------------------------------------------------------ */
/* 回填：每一步都可以重复执行，只补缺失的记录                           */
/* ------------------------------------------------------------------ */

export interface BackfillCounts {
  referralsFromInvitations: number;
  referralsLeaderCreated: number;
  referralsUntraceable: number;
  closureRows: number;
  memberships: number;
  roleRows: number;
}

export async function backfillMemberRelations(c: Conn): Promise<BackfillCounts> {
  const run = async (sql: string, args: unknown[] = []) => (await c.query<ResultSetHeader>(sql, args))[0].affectedRows;
  // ① 通过邀请链接注册：邀请人 = 链接所有人
  const referralsFromInvitations = await run(
    `INSERT INTO member_referrals(user_id,inviter_id,invitation_id,channel,registered_at)
     SELECT iu.user_id,i.owner_user_id,i.id,
       'migration',
       iu.registered_at
     FROM member_invitation_uses iu
     JOIN member_invitations i ON i.id=iu.invitation_id
     JOIN users o ON o.id=i.owner_user_id
     LEFT JOIN member_referrals r ON r.user_id=iu.user_id
     WHERE r.user_id IS NULL AND iu.user_id<>i.owner_user_id`,
  );
  // ② 团长直接创建的账号：邀请人 = 创建人
  const referralsLeaderCreated = await run(
    `INSERT INTO member_referrals(user_id,inviter_id,channel,registered_at)
     SELECT u.id,u.created_by,'migration',u.created_at
     FROM users u JOIN users c ON c.id=u.created_by AND c.role='leader'
     LEFT JOIN member_referrals r ON r.user_id=u.id
     WHERE r.user_id IS NULL AND u.created_by<>u.id`,
  );
  // ③ 没有证据的历史账号只标整理基线，不据空 created_by 推断自然注册。
  const referralsUntraceable = await run(
    `INSERT INTO member_referrals(user_id,inviter_id,channel,registered_at)
     SELECT u.id,NULL,'migration',u.created_at
     FROM users u LEFT JOIN member_referrals r ON r.user_id=u.id
     WHERE r.user_id IS NULL`,
  );
  // ④ 闭包：递归展开邀请链，深度上限 64 防止脏数据成环
  const closureRows = await run(
    `INSERT INTO member_referral_closure(ancestor_id,descendant_id,depth)
     WITH RECURSIVE t(ancestor_id,descendant_id,depth) AS (
       SELECT inviter_id,user_id,1 FROM member_referrals WHERE inviter_id IS NOT NULL
       UNION ALL
       SELECT r.inviter_id,t.descendant_id,t.depth+1
       FROM t JOIN member_referrals r ON r.user_id=t.ancestor_id
       WHERE r.inviter_id IS NOT NULL AND t.depth<64 AND r.inviter_id<>t.descendant_id
     )
     SELECT t.ancestor_id,t.descendant_id,MIN(t.depth) FROM t
     LEFT JOIN member_referral_closure e ON e.ancestor_id=t.ancestor_id AND e.descendant_id=t.descendant_id
     WHERE e.ancestor_id IS NULL
     GROUP BY t.ancestor_id,t.descendant_id`,
  );
  // Historical current state has no reliable start time. Record a baseline at migration time.
  const memberships = await run(
    `INSERT INTO team_memberships(user_id,leader_id,source,effective_from,reason)
     SELECT u.id,IF(p.role='leader',u.parent_id,NULL),'migration',NOW(3),'历史关系基线；此前归属时间未核实'
     FROM users u LEFT JOIN users p ON p.id=u.parent_id
     LEFT JOIN team_memberships m ON m.user_id=u.id
     WHERE u.closed_at IS NULL AND m.id IS NULL`,
  );
  // ⑥ 角色历史：每人补一条初始记录
  const roleRows = await run(
    `INSERT INTO member_role_history(user_id,from_role,to_role,reason,effective_at)
     SELECT u.id,NULL,u.role,'migration',NOW(3)
     FROM users u LEFT JOIN member_role_history h ON h.user_id=u.id
     WHERE h.id IS NULL`,
  );
  return { referralsFromInvitations, referralsLeaderCreated, referralsUntraceable, closureRows, memberships, roleRows };
}

/* ------------------------------------------------------------------ */
/* 一致性巡检：只报告，不自动改                                         */
/* ------------------------------------------------------------------ */

export interface RelationCheck {
  users: number;
  referrals: number;
  missingReferrals: number;
  selfClosureRows: number;
  deepChains: number;
  activeUsers: number;
  openMemberships: number;
  missingMemberships: number;
  closedButOpen: number;
  mismatches: { userId: string; parentId: string | null; leaderId: string | null }[];
  ok: boolean;
}

export async function checkMemberRelations(c: Conn, sampleLimit = 50): Promise<RelationCheck> {
  const one = async (sql: string) => Number(((await c.query<RowDataPacket[]>(sql))[0][0] ?? {}).n ?? 0);
  const users = await one('SELECT COUNT(*) n FROM users');
  const referrals = await one('SELECT COUNT(*) n FROM member_referrals');
  const missingReferrals = await one(
    'SELECT COUNT(*) n FROM users u LEFT JOIN member_referrals r ON r.user_id=u.id WHERE r.user_id IS NULL',
  );
  const selfClosureRows = await one('SELECT COUNT(*) n FROM member_referral_closure WHERE ancestor_id=descendant_id');
  const deepChains = await one('SELECT COUNT(*) n FROM member_referral_closure WHERE depth>=64');
  const activeUsers = await one('SELECT COUNT(*) n FROM users WHERE closed_at IS NULL');
  const openMemberships = await one('SELECT COUNT(*) n FROM team_memberships WHERE effective_to IS NULL');
  const missingMemberships = await one(
    `SELECT COUNT(*) n FROM users u LEFT JOIN team_memberships m ON m.open_user=u.id
     WHERE u.closed_at IS NULL AND m.id IS NULL`,
  );
  const closedButOpen = await one(
    `SELECT COUNT(*) n FROM users u JOIN team_memberships m ON m.open_user=u.id WHERE u.closed_at IS NOT NULL`,
  );
  // parent_id 指向团长时必须等于有效归属的团长；指向员工或为空时，有效归属应为平台直管
  const [rows] = await c.query<RowDataPacket[]>(
    `SELECT CAST(u.id AS CHAR) user_id,CAST(u.parent_id AS CHAR) parent_id,CAST(m.leader_id AS CHAR) leader_id
     FROM users u JOIN team_memberships m ON m.open_user=u.id LEFT JOIN users p ON p.id=u.parent_id
     WHERE NOT (m.leader_id <=> IF(p.role='leader',u.parent_id,NULL))
     ORDER BY u.id LIMIT ?`,
    [sampleLimit],
  );
  const mismatches = rows.map((r) => ({
    userId: String(r.user_id),
    parentId: r.parent_id == null ? null : String(r.parent_id),
    leaderId: r.leader_id == null ? null : String(r.leader_id),
  }));
  return {
    users,
    referrals,
    missingReferrals,
    selfClosureRows,
    deepChains,
    activeUsers,
    openMemberships,
    missingMemberships,
    closedButOpen,
    mismatches,
    ok:
      !missingReferrals &&
      !selfClosureRows &&
      !deepChains &&
      !missingMemberships &&
      !closedButOpen &&
      !mismatches.length,
  };
}
