import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { writeAudit } from './audit.service';
import { isDevDemoAuthUser } from '../core/demo';

interface ProjectRow extends RowDataPacket {
  id: string;
  name: string;
  slug: string;
  is_enabled: number;
  created_at: Date;
}

const publicProject = (row: ProjectRow) => ({
  id: String(row.id),
  name: row.name,
  slug: row.slug,
  isEnabled: Boolean(row.is_enabled),
  createdAt: row.created_at,
});

export async function createProject(
  user: AuthUser,
  input: {
    name: string;
    slug: string;
  },
  ip?: string,
) {
  if (isDevDemoAuthUser(user)) {
    return {
      id: `demo-project-${Date.now()}`,
      name: input.name,
      slug: input.slug,
          isEnabled: true,
        createdAt: new Date().toISOString(),
    };
  }

  const existing = await rows<RowDataPacket>('SELECT id FROM projects WHERE slug = ? LIMIT 1', [input.slug]);
  if (existing.length) throw new AppError(409, 40901, 'slug 已被占用');

  const id = await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      'INSERT INTO projects (name, slug) VALUES (?, ?)',
      [
        input.name,
        input.slug,
      ],
    );
    const projectId = String(result.insertId);
    await writeAudit(
      {
        userId: user.sub,
        action: 'project.create',
        resourceType: 'project',
        resourceId: projectId,
        detail: { name: input.name, slug: input.slug },
        ip,
      },
      connection,
    );
    return projectId;
  });

  const [created] = await rows<ProjectRow>('SELECT id,name,slug,is_enabled,created_at FROM projects WHERE id = ? LIMIT 1', [id]);
  return publicProject(created);
}

export async function updateProject(
  user: AuthUser,
  projectId: string,
  input: {
    name?: string;
    isEnabled?: boolean;
  },
  ip?: string,
) {
  if (isDevDemoAuthUser(user)) {
    return {
      id: projectId,
      name: input.name ?? 'OPC 演示项目',
      slug: 'opc-demo',
          isEnabled: input.isEnabled ?? true,
        createdAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
    };
  }

  const [project] = await rows<ProjectRow>('SELECT id,name,slug,is_enabled,created_at FROM projects WHERE id = ? LIMIT 1', [projectId]);
  if (!project) throw new AppError(404, 40402, '项目不存在');

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push('name = ?');
    params.push(input.name);
  }
  if (input.isEnabled !== undefined) {
    sets.push('is_enabled = ?');
    params.push(input.isEnabled ? 1 : 0);
  }

  if (!sets.length) return publicProject(project);

  await withTransaction(async (connection) => {
    params.push(projectId);
    await connection.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, params);
    await writeAudit(
      {
        userId: user.sub,
        action: 'project.update',
        resourceType: 'project',
        resourceId: projectId,
        detail: input,
        ip,
      },
      connection,
    );
  });

  const [updated] = await rows<ProjectRow>('SELECT id,name,slug,is_enabled,created_at FROM projects WHERE id = ? LIMIT 1', [projectId]);
  return publicProject(updated);
}

/** 软删除：禁用项目（is_enabled=0）。projects 被多张表引用，不做硬删除。 */
export async function disableProject(user: AuthUser, projectId: string, ip?: string) {
  if (isDevDemoAuthUser(user)) return;

  const [project] = await rows<ProjectRow>(
    'SELECT id, is_enabled FROM projects WHERE id = ? LIMIT 1',
    [projectId],
  );
  if (!project) throw new AppError(404, 40402, '项目不存在');
  if (!project.is_enabled) throw new AppError(409, 40902, '项目已禁用');

  await withTransaction(async (connection) => {
    await connection.query('UPDATE projects SET is_enabled = 0 WHERE id = ?', [projectId]);
    await writeAudit(
      {
        userId: user.sub,
        action: 'project.disable',
        resourceType: 'project',
        resourceId: projectId,
        ip,
      },
      connection,
    );
  });
}
