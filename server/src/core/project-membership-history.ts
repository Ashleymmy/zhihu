import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

/** Call in the transaction that owns the user and project_members row lock. */
export async function captureProjectMembership(
  c: PoolConnection,
  userId: string,
  projectId: string,
  sourceKind: string,
  actorId: string | null = null,
) {
  const [[current]] = await c.query<RowDataPacket[]>(
    'SELECT * FROM project_members WHERE user_id=? AND project_id=? FOR UPDATE',
    [userId, projectId],
  );
  if (!current) return;
  const [[open]] = await c.query<RowDataPacket[]>(
    'SELECT * FROM project_membership_history WHERE user_id=? AND project_id=? AND effective_to IS NULL FOR UPDATE',
    [userId, projectId],
  );
  if (open) {
    if (current.left_at != null)
      await c.query(
        'UPDATE project_membership_history SET effective_to=GREATEST(effective_from,?),closed_by=?,close_source_kind=?,version=version+1 WHERE id=?',
        [current.left_at, actorId, sourceKind, open.id],
      );
    return;
  }
  const [[same]] = await c.query<RowDataPacket[]>(
    'SELECT id FROM project_membership_history WHERE user_id=? AND project_id=? AND effective_from=? LIMIT 1',
    [userId, projectId, current.joined_at],
  );
  if (same) return;
  await c.query(
    `INSERT INTO project_membership_history
    (user_id,project_id,member_role,effective_from,effective_to,source_kind,source_ref,actor_id,prior_history_unknown)
    VALUES(?,?,?,?,?,?,CONCAT(?,':',DATE_FORMAT(?,'%Y-%m-%d %H:%i:%s.%f')),?,?)`,
    [
      userId,
      projectId,
      current.member_role,
      current.joined_at,
      current.left_at,
      sourceKind,
      current.id,
      current.joined_at,
      actorId,
      sourceKind === 'migration',
    ],
  );
}

/** Preserve a pre-upgrade row before an entry point overwrites its last join. */
export async function preserveProjectMembership(c: PoolConnection, userId: string, projectId: string) {
  await captureProjectMembership(c, userId, projectId, 'migration');
}

export async function closeProjectMemberships(c: PoolConnection, userId: string, actorId: string) {
  const [memberships] = await c.query<RowDataPacket[]>(
    'SELECT project_id FROM project_members WHERE user_id=? ORDER BY project_id FOR UPDATE',
    [userId],
  );
  for (const member of memberships) {
    await preserveProjectMembership(c, userId, String(member.project_id));
    await c.query(
      'UPDATE project_members SET left_at=COALESCE(left_at,GREATEST(NOW(3),joined_at)) WHERE user_id=? AND project_id=?',
      [userId, member.project_id],
    );
    await captureProjectMembership(c, userId, String(member.project_id), 'closure', actorId);
  }
}
