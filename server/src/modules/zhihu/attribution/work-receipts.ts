import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import type { Scope } from './domain';

export function rejectedWork(work: Record<string, unknown>) {
  const raw = work.zhihu_status_json;
  const remote = ((typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {}) as Record<string, unknown>;
  return (
    ['ended', 'rejected'].includes(String(work.status)) ||
    !!String(work.reject_reason ?? '').trim() ||
    ['rejected', 'failed'].includes(String(remote.auditStatus ?? remote.audit_status ?? remote.status ?? '')) ||
    !!String(remote.rejectReason ?? remote.reject_reason ?? '').trim()
  );
}

export const submittedWorkSql = `co.sync_status='synced' AND NULLIF(TRIM(co.zhihu_composition_id),'') IS NOT NULL
  AND co.status NOT IN ('ended','rejected') AND NULLIF(TRIM(co.reject_reason),'') IS NULL
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(co.zhihu_status_json,'$.auditStatus')),
    JSON_UNQUOTE(JSON_EXTRACT(co.zhihu_status_json,'$.audit_status')),
    JSON_UNQUOTE(JSON_EXTRACT(co.zhihu_status_json,'$.status')),'') NOT IN ('rejected','failed')
  AND COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(co.zhihu_status_json,'$.rejectReason')),'null'),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(co.zhihu_status_json,'$.reject_reason')),'null'),'')=''`;

/** An earlier owner's work does not invalidate a later, explicitly assigned period.
 * Unknown dates and overlapping owners still require a person to check the work. */
export async function reconcileWorkReceipts(c: PoolConnection, scope: Scope, keywordId: string) {
  const [updated] = await c.query<ResultSetHeader>(
    `UPDATE zh_keyword_bindings b
    JOIN zh_keywords k ON k.current_binding_id=b.id
    JOIN compositions co ON co.plan_id=k.plan_id AND co.owner_id=b.executor_id
    SET b.verification_status='passed',b.version=b.version+1
    WHERE k.id=? AND k.account_id=? AND k.project_id=?
      AND b.verification_status='pending' AND b.used_at IS NOT NULL AND b.released_at IS NULL
      AND ${submittedWorkSql}
      AND (DATE(co.release_time)>=b.activated_on OR (co.release_time IS NULL AND NOT EXISTS(
        SELECT 1 FROM compositions previous WHERE previous.plan_id=k.plan_id AND previous.owner_id<>b.executor_id)))
      AND NOT EXISTS(SELECT 1 FROM compositions other WHERE other.plan_id=k.plan_id AND other.owner_id<>b.executor_id
        AND (other.release_time IS NULL OR b.activated_on IS NULL OR DATE(other.release_time)>=b.activated_on))
      AND NOT EXISTS(SELECT 1 FROM zh_evidence rejected WHERE rejected.binding_id=b.id AND rejected.status='rejected')`,
    [keywordId, scope.accountId, scope.projectId],
  );
  await c.query(
    `UPDATE zh_evidence e JOIN zh_keyword_bindings b ON b.id=e.binding_id
    JOIN zh_keywords k ON k.current_binding_id=b.id
    JOIN compositions co ON co.plan_id=k.plan_id AND co.owner_id=b.executor_id AND BINARY co.promo_url=BINARY e.work_url
    SET e.status='passed',e.reason='系统已核对作品归属并收到知乎提交回执',e.reviewed_at=NOW(3)
    WHERE k.id=? AND k.account_id=? AND k.project_id=? AND e.status='pending'
      AND b.verification_status='passed' AND b.released_at IS NULL
      AND ${submittedWorkSql}`,
    [keywordId, scope.accountId, scope.projectId],
  );
  return updated.affectedRows > 0;
}

// Both financial projections must count the same registered works.
export const registeredWorkSql = `(EXISTS(SELECT 1 FROM zh_evidence ev WHERE ev.binding_id=b.id)
  OR EXISTS(SELECT 1 FROM compositions co JOIN zh_keywords wk ON wk.plan_id=co.plan_id
    WHERE wk.id=b.keyword_id AND co.owner_id=b.executor_id))`;
