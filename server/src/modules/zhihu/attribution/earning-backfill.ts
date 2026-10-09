import type { AuthUser } from '../../../types';
import { withTransaction } from '../../../db';
import { assertDuty } from '../../../core/duties';
import type { Scope } from './domain';
import { audit, authorize, scopeLock, select } from './store';
import { projectEarnings } from './earning-lines';

/** Copies existing calculations only; never recalculates or changes cash/statement rows. */
export async function backfillEarnings(user: AuthUser, scope: Scope, apply = false) {
  assertDuty(user, 'finance');
  await authorize(user, scope);
  return withTransaction(async (c) => {
    await scopeLock(c, scope, user);
    const facts = await select(
      c,
      `SELECT CAST(f.id AS CHAR) id FROM zh_metric_facts f
      LEFT JOIN opc_earning_sources s ON s.module_id='zhihu' AND s.project_id=f.project_id AND s.account_id=f.account_id AND s.source_key=CONCAT('fact:',f.id)
      WHERE f.account_id=? AND f.project_id=? AND f.current_result_id IS NOT NULL AND (s.id IS NULL OR BINARY s.current_version<>BINARY CAST(f.current_result_id AS CHAR)) ORDER BY f.id FOR UPDATE`,
      [scope.accountId, scope.projectId],
    );
    if (apply) {
      for (const fact of facts) await projectEarnings(c, scope, String(fact.id));
      if (facts.length) await audit(c, user, 'earnings.backfill', scope.projectId, { factIds: facts.map((f) => f.id) });
    }
    return { apply, records: facts.length, factIds: facts.map((f) => String(f.id)) };
  });
}
