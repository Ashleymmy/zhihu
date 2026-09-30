import { isStaffRole } from '../../../auth/roles';
import type { AuthUser } from '../../../types';
import { scopeFilter } from '../../../utils/scopeFilter';
import { independentCreatorSql } from '../attribution/relationships';

// Reading the public keyword pool is not permission to submit works for it.
// Keep the picker, spreadsheet preview and transactional insert on one policy.
export function compositionPlanScope(user: AuthUser, currentRead = false) {
  // Inserts can follow an Excel preview in a REPEATABLE READ transaction.
  // Locking the outer plan does not refresh nested subquery snapshots, so every
  // authorization subquery must also read and lock the current relationship.
  const lock = currentRead ? ' FOR SHARE' : '';
  const legacy =
    user.role === 'leader'
      ? {
          clause: `p.owner_id IN (SELECT id FROM users WHERE parent_id=? OR id=?${lock})`,
          bindings: [user.sub, user.sub],
        }
      : scopeFilter(user, 'p.owner_id');
  const actor =
    isStaffRole(user.role)
      ? '1=1'
      : user.role === 'leader'
        ? '(cb.executor_id=? OR cb.leader_id=?)'
        : 'cb.executor_id=?';
  const actorBindings = isStaffRole(user.role) ? [] : user.role === 'leader' ? [user.sub, user.sub] : [user.sub];
  return {
    clause: `(p.status<>'ended' AND (
      (NOT EXISTS(SELECT 1 FROM zh_keywords legacy WHERE legacy.plan_id=p.id${lock}) AND ${legacy.clause}
        ${isStaffRole(user.role) ? '' : `AND EXISTS(SELECT 1 FROM project_members legacy_member JOIN projects legacy_project ON legacy_project.id=legacy_member.project_id AND legacy_project.is_enabled=1 WHERE legacy_member.project_id=p.project_id AND legacy_member.user_id=? AND legacy_member.left_at IS NULL${lock})`})
      OR EXISTS(
        SELECT 1 FROM zh_keywords ck
        JOIN projects cp ON cp.id=ck.project_id AND cp.is_enabled=1
        JOIN integration_accounts ca ON ca.id=ck.account_id AND ca.module_id='zhihu' AND ca.status='active'
        JOIN project_integrations cpi ON cpi.project_id=ck.project_id AND cpi.account_id=ck.account_id
        LEFT JOIN zh_keyword_bindings cb ON cb.id=ck.current_binding_id AND cb.keyword_id=ck.id
        LEFT JOIN users executor ON executor.id=cb.executor_id AND executor.is_active=1
        WHERE ck.plan_id=p.id AND ck.project_id=p.project_id
        AND NOT EXISTS(SELECT 1 FROM zh_engine_routes er WHERE er.project_id=ck.project_id AND er.account_id=ck.account_id AND er.mode='stopped'${lock})
        AND (${isStaffRole(user.role) ? '1=1' : `EXISTS(SELECT 1 FROM project_members viewer WHERE viewer.project_id=ck.project_id AND viewer.user_id=? AND viewer.left_at IS NULL${lock})`})
        AND (
          (${isStaffRole(user.role) ? '1=1' : '1=0'} AND ck.current_binding_id IS NULL AND ck.lifecycle_status IN ('pending','available'))
          OR (ck.lifecycle_status IN ('assigned','active') AND cb.released_at IS NULL
            AND cb.stop_new_use_at IS NULL AND cb.release_status<>'requested'
            AND executor.id IS NOT NULL AND ${actor}
            AND EXISTS(SELECT 1 FROM project_members member WHERE member.project_id=ck.project_id AND member.user_id=cb.executor_id AND member.left_at IS NULL${lock})
            AND ((cb.path_type='direct_creator' AND executor.role='creator' AND ${independentCreatorSql('executor', lock)})
              OR (cb.path_type='team_creator' AND executor.role='creator' AND executor.parent_id=cb.leader_id)
              OR (cb.path_type='leader_self' AND executor.role='leader' AND executor.id=cb.leader_id)))
        )${lock}
      )
    ))`,
    bindings: [...legacy.bindings, ...(isStaffRole(user.role) ? [] : [user.sub, user.sub]), ...actorBindings],
  };
}
