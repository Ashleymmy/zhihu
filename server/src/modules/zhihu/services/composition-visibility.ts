import type { AuthUser } from '../../../types';
import { scopeFilter } from '../../../utils/scopeFilter';

/** Current team membership never transfers access to another team's old work. */
export function compositionVisibility(user: AuthUser, alias = 'c') {
  if (user.role !== 'leader') return scopeFilter(user, `${alias}.owner_id`);
  return {
    clause: `(${alias}.owner_id=? OR EXISTS(SELECT 1 FROM zh_keyword_bindings vb JOIN zh_keywords vk ON vk.id=vb.keyword_id
      WHERE vk.plan_id=${alias}.plan_id AND vb.executor_id=${alias}.owner_id AND vb.leader_id=?)
      OR (NOT EXISTS(SELECT 1 FROM zh_keywords vk WHERE vk.plan_id=${alias}.plan_id)
        AND ${alias}.owner_id IN (SELECT id FROM users WHERE parent_id=?)))`,
    bindings: [user.sub, user.sub, user.sub],
  };
}
