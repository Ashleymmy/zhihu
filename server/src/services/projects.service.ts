import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { writeAudit } from './audit.service';

interface ProjectRow extends RowDataPacket {
  id: string;
  name: string;
  slug: string;
  api_base_url: string;
  sign_method: 'hmac_sha256' | 'oauth2';
  is_enabled: number;
  config_json: Record<string, unknown> | null;
  created_at: Date;
}

const publicProject = (row: ProjectRow) => ({
  id: String(row.id),
  name: row.name,
  slug: row.slug,
  apiBaseUrl: row.api_base_url,
  signMethod: row.sign_method,
  isEnabled: Boolean(row.is_enabled),
  configJson: row.config_json,
  createdAt: row.created_at,
});

export async function createProject(
  user: AuthUser,
  input: {
    name: string;
    slug: string;
    apiBaseUrl: string;
    signMethod?: 'hmac_sha256' | 'oauth2';
    configJson?: Record<string, unknown>;
  },
  ip?: string,
) {
  const existing = await rows<RowDataPacket>('SELECT id FROM projects WHERE slug = ? LIMIT 1', [input.slug]);
  if (existing.length) throw new AppError(409, 40901, 'slug 已被占用');

  const id = await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      'INSERT INTO projects (name, slug, api_base_url, sign_method, config_json) VALUES (?, ?, ?, ?, ?)',
      [
        input.name,
        input.slug,
        input.apiBaseUrl,
        input.signMethod ?? 'hmac_sha256',
        input.configJson != null ? JSON.stringify(input.configJson) : null,
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

  const [created] = await rows<ProjectRow>('SELECT * FROM projects WHERE id = ? LIMIT 1', [id]);
  return publicProject(created);
}

export async function updateProject(
  user: AuthUser,
  projectId: string,
  input: {
    name?: string;
    apiBaseUrl?: string;
    signMethod?: 'hmac_sha256' | 'oauth2';
    isEnabled?: boolean;
    configJson?: Record<string, unknown> | null;
  },
  ip?: string,
) {
  const [project] = await rows<ProjectRow>('SELECT * FROM projects WHERE id = ? LIMIT 1', [projectId]);
  if (!project) throw new AppError(404, 40402, '项目不存在');

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push('name = ?');
    params.push(input.name);
  }
  if (input.apiBaseUrl !== undefined) {
    sets.push('api_base_url = ?');
    params.push(input.apiBaseUrl);
  }
  if (input.signMethod !== undefined) {
    sets.push('sign_method = ?');
    params.push(input.signMethod);
  }
  if (input.isEnabled !== undefined) {
    sets.push('is_enabled = ?');
    params.push(input.isEnabled ? 1 : 0);
  }
  if ('configJson' in input) {
    sets.push('config_json = ?');
    params.push(input.configJson != null ? JSON.stringify(input.configJson) : null);
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

  const [updated] = await rows<ProjectRow>('SELECT * FROM projects WHERE id = ? LIMIT 1', [projectId]);
  return publicProject(updated);
}

/** 软删除：禁用项目（is_enabled=0）。projects 被多张表引用，不做硬删除。 */
export async function disableProject(user: AuthUser, projectId: string, ip?: string) {
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
