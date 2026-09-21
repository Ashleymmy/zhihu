import type { AuthUser } from '../../../types';
import { withTransaction } from '../../../db';
import { scopeFilter } from '../../../utils/scopeFilter';
import { planAccountSql } from '../services/plan-account';
import type { Scope } from './domain';
import { authorize, select } from './store';

// Link the two review sources without inventing a binding or financial approval.
export async function listWorks(user: AuthUser, scope: Scope, page: number, pageSize: number) {
  await authorize(user, scope);
  return withTransaction(async c => {
    const visibility = scopeFilter(user, 'c.owner_id');
    const query = `
      SELECT CAST(e.id AS CHAR) id,'evidence' source,CAST(e.binding_id AS CHAR) binding_id,
        CAST(p.id AS CHAR) plan_id,p.keyword,e.work_url,e.description,e.status,e.reason,
        b.verification_status,CAST(b.executor_id AS CHAR) executor_id,u.display_name executor_name,
        CAST(c.id AS CHAR) composition_id,c.sync_status,c.zhihu_status_json,e.created_at
      FROM zh_evidence e JOIN zh_keyword_bindings b ON b.id=e.binding_id
      JOIN zh_keywords k ON k.id=b.keyword_id JOIN plans p ON p.id=k.plan_id
      LEFT JOIN users u ON u.id=b.executor_id
      LEFT JOIN compositions c ON c.id=(SELECT MAX(linked.id) FROM compositions linked
        WHERE linked.plan_id=p.id AND linked.owner_id=b.executor_id AND BINARY linked.promo_url=BINARY e.work_url)
      WHERE k.account_id=? AND k.project_id=? AND p.project_id=k.project_id
        AND (?='admin' OR b.leader_id=? OR b.executor_id=?)
      UNION ALL
      SELECT CONCAT('composition:',c.id) id,'composition' source,NULL binding_id,
        CAST(p.id AS CHAR) plan_id,p.keyword,c.promo_url work_url,c.title description,
        c.status,c.reject_reason reason,NULL verification_status,
        CAST(c.owner_id AS CHAR) executor_id,u.display_name executor_name,
        CAST(c.id AS CHAR) composition_id,c.sync_status,c.zhihu_status_json,c.created_at
      FROM compositions c JOIN plans p ON p.id=c.plan_id LEFT JOIN users u ON u.id=c.owner_id
      WHERE p.project_id=? AND ${planAccountSql()}=? AND ${visibility.clause}
        AND NOT EXISTS(SELECT 1 FROM zh_evidence e JOIN zh_keyword_bindings b ON b.id=e.binding_id
          JOIN zh_keywords k ON k.id=b.keyword_id
          WHERE k.plan_id=p.id AND k.account_id=? AND k.project_id=?
            AND b.executor_id=c.owner_id AND BINARY e.work_url=BINARY c.promo_url
            AND (?='admin' OR b.leader_id=? OR b.executor_id=?))`;
    const args = [scope.accountId, scope.projectId, user.role, user.sub, user.sub,
      scope.projectId, scope.accountId, ...visibility.bindings,
      scope.accountId, scope.projectId, user.role, user.sub, user.sub];
    const [count] = await select(c, `SELECT COUNT(*) total FROM (${query}) works`, args);
    const list = await select(c, `SELECT * FROM (${query}) works ORDER BY created_at DESC,source,id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize]);
    return { list, total: Number(count.total), page, pageSize };
  });
}
