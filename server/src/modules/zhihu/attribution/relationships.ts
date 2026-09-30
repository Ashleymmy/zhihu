import type { PoolConnection } from 'mysql2/promise';
import { isStaffRole } from '../../../auth/roles';
import { fail, type Scope } from './domain';
import { select, type RecordRow } from './store';

// A staff parent is platform management, never a commission-bearing team leader.
export async function teamLeader(c: PoolConnection, scope: Scope, actor: RecordRow): Promise<string | null> {
  if (actor.parent_id == null) return null;
  const [parent] = await select(c, 'SELECT id,role,is_active FROM users WHERE id=? FOR SHARE', [actor.parent_id]);
  if (parent && isStaffRole(String(parent.role))) return null;
  if (!parent || parent.role !== 'leader' || !parent.is_active) fail('所属团队不可用，请联系管理员', 409);
  const members = await select(
    c,
    'SELECT user_id FROM project_members WHERE project_id=? AND user_id=? AND left_at IS NULL FOR SHARE',
    [scope.projectId, parent.id],
  );
  if (!members.length) fail('请先将该达人的团长加入项目');
  return String(parent.id);
}

export function independentCreatorSql(alias: string, lock = '') {
  return `(${alias}.parent_id IS NULL OR EXISTS(SELECT 1 FROM users platform_parent WHERE platform_parent.id=${alias}.parent_id AND platform_parent.role IN ('developer','admin','operator')${lock}))`;
}
