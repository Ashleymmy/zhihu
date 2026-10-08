import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Role } from '../types';
import { writeAudit } from './audit.service';

/** Initial access is ordinary membership. Explicit removals and existing roles are preserved. */
export async function openMemberProjects(
  c: PoolConnection,
  userId: string,
  role: Role,
  leaderId: string | null,
  actorId = userId,
) {
  if (!['leader', 'creator'].includes(role)) return;
  const [projects] = await c.query<RowDataPacket[]>(
    `SELECT p.id FROM projects p WHERE p.is_enabled=1 AND
      (p.slug='zhihu' OR EXISTS (
        SELECT 1 FROM project_members pm JOIN users u ON u.id=pm.user_id
        WHERE pm.project_id=p.id AND pm.user_id=? AND pm.left_at IS NULL
          AND u.role='leader' AND u.is_active=1
      )) ORDER BY p.id FOR SHARE`,
    [role === 'creator' ? leaderId : null],
  );
  for (const p of projects) {
    const [[existing]] = await c.query<RowDataPacket[]>(
      'SELECT id FROM project_members WHERE project_id=? AND user_id=? FOR UPDATE', [p.id, userId],
    );
    if (existing) continue;
    await c.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES(?,?,'member')", [p.id, userId]);
    await writeAudit({ userId: actorId, action: 'project.member_add', resourceType: 'project', resourceId: String(p.id),
      detail: { userId, memberRole: 'member', source: 'member.onboarding', leaderId } }, c);
  }
}
