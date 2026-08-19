import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { writeAudit } from './audit.service';

interface MemberRow extends RowDataPacket {
  id: string;
  project_id: string;
  user_id: string;
  member_role: 'owner' | 'admin' | 'member' | 'viewer';
  joined_at: Date;
  left_at: Date | null;
  username?: string;
  display_name?: string;
}

const publicMember = (row: MemberRow) => ({
  projectId: String(row.project_id),
  userId: String(row.user_id),
  memberRole: row.member_role,
  joinedAt: row.joined_at,
  username: row.username ?? null,
  displayName: row.display_name ?? null,
});

async function assertProjectExists(projectId: string) {
  const found = await rows<RowDataPacket>('SELECT id FROM projects WHERE id = ? LIMIT 1', [projectId]);
  if (!found.length) throw new AppError(404, 40402, '项目不存在');
}

/**
 * 行级隔离约束（01 §3.1）：非 admin 访问项目数据前必须先解析
 * project_members(project_id, user_id)；无成员记录时 fail closed。
 */
export async function assertProjectMembership(user: AuthUser, projectId: string): Promise<void> {
  if (user.role === 'admin') return;
  const found = await rows<RowDataPacket>(
    'SELECT id FROM project_members WHERE project_id = ? AND user_id = ? AND left_at IS NULL LIMIT 1',
    [projectId, user.sub],
  );
  if (!found.length) throw new AppError(403, 40304, '无权访问该项目');
}

interface ProjectRow extends RowDataPacket {
  id: string;
  name: string;
  slug: string;
  is_enabled: number;
  created_at: Date;
  member_role: 'owner' | 'admin' | 'member' | 'viewer' | null;
}

/** 项目列表：admin 看全部；其余角色只看自己在 project_members 里的项目（行级过滤在 SQL 内绑定）。 */
export async function listProjects(user: AuthUser) {
  const projects =
    user.role === 'admin'
      ? await rows<ProjectRow>(
          'SELECT p.id, p.name, p.slug, p.is_enabled, p.created_at, NULL AS member_role FROM projects p ORDER BY p.id',
        )
      : await rows<ProjectRow>(
          `SELECT p.id, p.name, p.slug, p.is_enabled, p.created_at, pm.member_role
           FROM projects p JOIN project_members pm ON pm.project_id = p.id
           WHERE pm.user_id = ? AND pm.left_at IS NULL
           ORDER BY p.id`,
          [user.sub],
        );
  return projects.map((row) => ({
    id: String(row.id),
    name: row.name,
    slug: row.slug,
    isEnabled: Boolean(row.is_enabled),
    createdAt: row.created_at,
    memberRole: row.member_role,
  }));
}

export async function listProjectMembers(user: AuthUser, projectId: string) {
  await assertProjectExists(projectId);
  await assertProjectMembership(user, projectId);
  const members = await rows<MemberRow>(
    `SELECT pm.*, u.username, u.display_name
     FROM project_members pm JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ? AND pm.left_at IS NULL
     ORDER BY pm.joined_at, pm.id`,
    [projectId],
  );
  return members.map(publicMember);
}

export async function addProjectMember(
  user: AuthUser,
  projectId: string,
  input: { userId: string; memberRole?: 'owner' | 'admin' | 'member' | 'viewer' },
  ip?: string,
) {
  await assertProjectExists(projectId);
  const [target] = await rows<RowDataPacket & { is_active: number }>(
    'SELECT id, is_active FROM users WHERE id = ? LIMIT 1',
    [input.userId],
  );
  if (!target || !target.is_active) throw new AppError(422, 42207, '成员用户不存在或已停用');
  const memberRole = input.memberRole ?? 'member';

  await withTransaction(async (connection) => {
    const [existing] = await connection.query<MemberRow[]>(
      'SELECT * FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1 FOR UPDATE',
      [projectId, input.userId],
    );
    if (existing[0] && existing[0].left_at === null) throw new AppError(409, 40903, '该用户已是项目成员');
    if (existing[0]) {
      await connection.query(
        'UPDATE project_members SET member_role = ?, joined_at = NOW(3), left_at = NULL WHERE id = ?',
        [memberRole, existing[0].id],
      );
    } else {
      await connection.query<ResultSetHeader>(
        'INSERT INTO project_members (project_id, user_id, member_role) VALUES (?, ?, ?)',
        [projectId, input.userId, memberRole],
      );
    }
    await writeAudit(
      {
        userId: user.sub,
        action: 'project.member_add',
        resourceType: 'project',
        resourceId: projectId,
        detail: { userId: input.userId, memberRole },
        ip,
      },
      connection,
    );
  });
  const members = await listProjectMembers(user, projectId);
  return members.find((member) => member.userId === String(input.userId)) ?? null;
}

export async function removeProjectMember(user: AuthUser, projectId: string, userId: string, ip?: string) {
  await assertProjectExists(projectId);
  await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      'UPDATE project_members SET left_at = NOW(3) WHERE project_id = ? AND user_id = ? AND left_at IS NULL',
      [projectId, userId],
    );
    if (result.affectedRows !== 1) throw new AppError(404, 40403, '该用户不是项目成员');
    await writeAudit(
      {
        userId: user.sub,
        action: 'project.member_remove',
        resourceType: 'project',
        resourceId: projectId,
        detail: { userId },
        ip,
      },
      connection,
    );
  });
}
