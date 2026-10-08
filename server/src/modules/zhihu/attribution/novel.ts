import { z } from 'zod';
import { isStaffRole } from '../../../auth/roles';
import type { AuthUser } from '../../../types';

export const novelSchema = z.object({
  title: z.string().trim().max(128).default(''),
  url: z.string().trim().max(1024).default('').refine(value => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }, '请填写有效的小说原文链接'),
});
export type NovelInput = z.input<typeof novelSchema>;

export function canEditNovel(user: AuthUser, row: Record<string, unknown>) {
  if (row.lifecycle_status === 'archived') return false;
  if (isStaffRole(user.role)) return true;
  if (!['leader', 'creator'].includes(user.role)) return false;
  if (row.binding_id) return !row.released_at && [row.leader_id, row.executor_id].some(id => id != null && String(id) === user.sub);
  return String(row.created_by) === user.sub || (!row.keyword_id && String(row.owner_id) === user.sub);
}
