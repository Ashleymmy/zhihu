import { db } from '../../../db';
import type { Scope } from './domain';

// A successful create receipt is enough to open the local allocation workflow.
// This does not claim to have queried the plan's current official audit status.
// Also repairs previously saved receipts that were left in pending by old workers.
export async function synchronizeKeywords(scope?: Scope, planId?: string) {
  await db.query(
    `UPDATE zh_keywords k JOIN plans p ON p.id=k.plan_id AND p.project_id=k.project_id
     JOIN integration_accounts a ON a.id=k.account_id AND a.module_id='zhihu' AND a.status='active'
     JOIN project_integrations pi ON pi.account_id=k.account_id AND pi.project_id=k.project_id
     JOIN projects pr ON pr.id=k.project_id AND pr.is_enabled=1
     SET p.status='active',k.upstream_status='created',k.lifecycle_status='available',
       k.upstream_confirmed_at=COALESCE(k.upstream_confirmed_at,NOW(3)),
       k.priority_until=COALESCE(k.priority_until,TIMESTAMPADD(MINUTE,30,k.created_at)),k.version=k.version+1
     WHERE p.sync_status='synced' AND NULLIF(TRIM(p.zhihu_plan_id),'') IS NOT NULL
       AND p.status IN ('pending','active') AND k.lifecycle_status='pending' AND k.legacy_mode='new'
       AND k.upstream_status IN ('pending','created','available')
       AND k.current_binding_id IS NULL AND k.used_ever_at IS NULL
       AND NOT EXISTS(SELECT 1 FROM zh_keyword_bindings b WHERE b.keyword_id=k.id)
       AND NOT EXISTS(SELECT 1 FROM compositions c WHERE c.plan_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM zh_metric_facts f WHERE f.keyword_id=k.id)
       AND NOT EXISTS(SELECT 1 FROM daily_metrics m WHERE m.plan_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM earnings e WHERE e.plan_id=p.id)
       AND (? IS NULL OR k.account_id=?) AND (? IS NULL OR k.project_id=?) AND (? IS NULL OR p.id=?)
       AND NOT EXISTS(SELECT 1 FROM zh_engine_routes r WHERE r.account_id=k.account_id AND r.project_id=k.project_id AND r.mode='stopped')`,
    [scope?.accountId ?? null,scope?.accountId ?? null,scope?.projectId ?? null,scope?.projectId ?? null,planId ?? null,planId ?? null],
  );
}
