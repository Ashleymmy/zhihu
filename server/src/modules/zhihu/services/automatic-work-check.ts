import { withTransaction } from '../../../db';
import {scopeLock,select} from '../attribution/store';
import {refreshUnconfirmedKeyword} from '../attribution/automatic-repair';
import type {ResultSetHeader} from 'mysql2/promise';

// A successful upstream receipt plus the existing exclusive owner is enough
// for routine bookkeeping. Explicit disputes/rejections remain untouched.
export async function confirmSubmittedWorks(compositionId: string | null = null) {
  return withTransaction(async c => {
  const scopes=await select(c,`SELECT DISTINCT k.account_id,k.project_id FROM zh_keywords k
    JOIN compositions co ON co.plan_id=k.plan_id JOIN projects p ON p.id=k.project_id AND p.is_enabled=1
    JOIN integration_accounts a ON a.id=k.account_id AND a.status='active'
    WHERE (? IS NULL OR co.id=?) ORDER BY k.account_id,k.project_id`,[compositionId,compositionId]);
  const bindings={affectedRows:0},evidence={affectedRows:0};
  for(const row of scopes){
  const scope={accountId:String(row.account_id),projectId:String(row.project_id)};
  await scopeLock(c,scope);
  const before=await select(c,`SELECT DISTINCT k.id FROM zh_keywords k JOIN zh_keyword_bindings b ON b.id=k.current_binding_id
    JOIN compositions co ON co.plan_id=k.plan_id WHERE k.account_id=? AND k.project_id=? AND b.verification_status='pending'
    AND (? IS NULL OR co.id=?)`,[scope.accountId,scope.projectId,compositionId,compositionId]);
  const [updated] = await c.query<ResultSetHeader>(`UPDATE zh_keyword_bindings b JOIN zh_keywords k ON k.current_binding_id=b.id
    JOIN compositions c ON c.plan_id=k.plan_id AND c.owner_id=b.executor_id
    SET b.verification_status='passed',b.version=b.version+1
    WHERE c.sync_status='synced' AND NULLIF(TRIM(c.zhihu_composition_id),'') IS NOT NULL
      AND b.verification_status='pending' AND b.released_at IS NULL AND c.status<>'ended'
      AND NOT EXISTS(SELECT 1 FROM compositions other WHERE other.plan_id=k.plan_id AND other.owner_id<>b.executor_id)
      AND NOT EXISTS(SELECT 1 FROM zh_evidence rejected WHERE rejected.binding_id=b.id AND rejected.status='rejected')
      AND k.account_id=? AND k.project_id=? AND (? IS NULL OR c.id=?)`, [scope.accountId,scope.projectId,compositionId,compositionId]);
  bindings.affectedRows+=updated.affectedRows;
  const [checked] = await c.query<ResultSetHeader>(`UPDATE zh_evidence e JOIN zh_keyword_bindings b ON b.id=e.binding_id
    JOIN zh_keywords k ON k.id=b.keyword_id AND k.current_binding_id=b.id
    JOIN compositions c ON c.plan_id=k.plan_id AND BINARY c.promo_url=BINARY e.work_url AND c.owner_id=b.executor_id
    SET e.status='passed',e.reason='系统已核对作品归属并收到知乎提交回执',e.reviewed_at=NOW(3)
    WHERE e.status='pending' AND b.verification_status='passed' AND b.released_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM compositions other WHERE other.plan_id=k.plan_id AND other.owner_id<>b.executor_id)
      AND c.status<>'ended' AND c.sync_status='synced' AND NULLIF(TRIM(c.zhihu_composition_id),'') IS NOT NULL
      AND k.account_id=? AND k.project_id=? AND (? IS NULL OR c.id=?)`, [scope.accountId,scope.projectId,compositionId,compositionId]);
  evidence.affectedRows+=checked.affectedRows;
  for(const keyword of before){
    const [passed]=await select(c,"SELECT b.id FROM zh_keyword_bindings b JOIN zh_keywords k ON k.current_binding_id=b.id WHERE k.id=? AND b.verification_status='passed'",[keyword.id]);
    if(passed)await refreshUnconfirmedKeyword(c,scope,String(keyword.id));
  }
  }
  return { bindings, evidence };
  });
}
