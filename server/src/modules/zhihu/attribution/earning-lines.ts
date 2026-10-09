import type { PoolConnection } from 'mysql2/promise';
import { writeEarningLines, type EarningLineInput } from '../../../core/earnings';
import { select, json } from './store';
import { money, moneyText, type Scope } from './domain';
import type { AttributionSnapshot } from './facts';
import { allocations } from './allocations';
import { reasonText } from './reasons';

/** Project the module's calculation to platform-owned, per-recipient rows. */
export async function projectEarnings(c: PoolConnection, scope: Scope, factId: string) {
  const [fact] = await select(
    c,
    `SELECT f.*,r.snapshot_json,r.reason_code,b.verification_status,b.executor_id,b.leader_id,
    u.display_name executor_name,u.role executor_role,leader.display_name leader_name,
    (SELECT COUNT(*) FROM zh_evidence e WHERE e.binding_id=b.id) evidence_count,
    (SELECT COUNT(*) FROM zh_metric_revisions v WHERE v.fact_id=f.id AND v.status='pending') pending_revision,
    route.mode route_mode
    FROM zh_metric_facts f JOIN zh_attribution_results r ON r.id=f.current_result_id
    LEFT JOIN zh_keyword_bindings b ON b.id=r.binding_id LEFT JOIN users u ON u.id=b.executor_id
    LEFT JOIN users leader ON leader.id=b.leader_id LEFT JOIN zh_engine_routes route ON route.account_id=f.account_id AND route.project_id=f.project_id
    WHERE f.id=? AND f.project_id=? AND f.account_id=?`,
    [factId, scope.projectId, scope.accountId],
  );
  if (!fact) return;
  const snapshot = json<AttributionSnapshot>(fact.snapshot_json),
    internal = snapshot.binding?.path_type === 'staff_self';
  const type = snapshot.metricType ?? 'new_user',
    quantity = type === 'activation' ? (snapshot.activations ?? null) : snapshot.orders;
  let target: ReturnType<typeof allocations> | null = null;
  try {
    target = allocations(snapshot);
  } catch {
    /* Invalid legacy allocations remain visible as pending. */
  }
  const code = !target
    ? 'PRICE_CONFLICT'
    : fact.route_mode === 'stopped'
      ? 'BUSINESS_STOPPED'
      : Number(fact.pending_revision) > 0
        ? 'SOURCE_REVISION_PENDING'
        : String(fact.reason_code ?? '') ||
          (fact.verification_status === 'passed'
            ? ''
            : fact.verification_status === 'disputed'
              ? 'WORK_DISPUTED'
              : Number(fact.evidence_count)
                ? 'WORK_UNVERIFIED'
                : 'WORK_MISSING');
  const reason = code
    ? reasonText(code, {
        metricType: type,
        executorName: fact.executor_name,
        executorRole: fact.executor_role,
        leaderName: fact.leader_name,
      })
    : { reason: '', next: '财务：核对并确认金额' };
  const values = new Map((target?.list ?? []).map((line) => [line.userId, line.amount as string | null]));
  if (internal && fact.executor_id)
    values.set(String(fact.executor_id), snapshot.obligations.length ? (target?.staffAmount ?? null) : null);
  if (!values.size && fact.executor_id) {
    values.set(String(fact.executor_id), null);
    if (fact.leader_id && String(fact.leader_id) !== String(fact.executor_id)) values.set(String(fact.leader_id), null);
  }
  const lines: EarningLineInput[] = [...values].map(([payeeId, amount]) => {
    const price = snapshot.obligations.reduce(
      (sum, o) =>
        sum +
        (o.payeeId === payeeId ? money(o.unitPrice) : 0n) -
        (o.payerKind === 'user' && o.payerId === payeeId ? money(o.unitPrice) : 0n),
      0n,
    );
    return {
      payeeId,
      performerId: fact.executor_id ? String(fact.executor_id) : null,
      performerName: String(fact.executor_name ?? '执行人'),
      ruleCode: internal
        ? 'staff_self'
        : payeeId !== String(fact.executor_id)
          ? 'leader_override'
          : snapshot.binding?.path_type === 'leader_self'
            ? 'leader_self'
            : 'creator',
      quantity,
      unitPrice: amount !== null && price >= 0n ? moneyText(price) : null,
      amount,
      internal,
      ready:
        !internal && amount !== null && (!code || (code === 'RISK_EXCLUDED' && fact.verification_status === 'passed')),
      reason: reason.reason,
      next: reason.next,
    };
  });
  await writeEarningLines(
    c,
    { ...scope, moduleId: 'zhihu' },
    {
      sourceKey: 'fact:' + factId,
      version: String(fact.current_result_id),
      date: snapshot.date,
      taskId: String(fact.keyword_id),
      taskName: snapshot.keyword,
      metricType: type,
      metricLabel: type === 'activation' ? '拉活' : '拉新',
      unit: type === 'activation' ? '个' : '单',
      lines,
    },
  );
}
