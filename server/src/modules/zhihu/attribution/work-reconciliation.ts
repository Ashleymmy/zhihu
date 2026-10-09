import type { AuthUser } from '../../../types';
import { withTransaction } from '../../../db';
import { assertDuty } from '../../../core/duties';
import type { Scope } from './domain';
import { audit, authorize, scopeLock, select } from './store';
import { unconfirmedFactSql } from './keyword-usability';
import { refreshUnconfirmedKeyword } from './automatic-repair';

/** Explicit release repair. Default is read-only; no upstream calls or bill confirmation. */
export async function reconcileRegisteredWorks(user: AuthUser, scope: Scope, apply = false) {
  assertDuty(user, 'finance');
  await authorize(user, scope);
  return withTransaction(async (c) => {
    if (apply) await scopeLock(c, scope, user);
    const words = await select(
      c,
      `SELECT CAST(k.id AS CHAR) id FROM zh_keywords k
    WHERE k.account_id=? AND k.project_id=? AND k.current_binding_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM compositions co WHERE co.plan_id=k.plan_id)
    AND EXISTS(SELECT 1 FROM zh_metric_facts f JOIN zh_engine_routes route ON route.account_id=f.account_id AND route.project_id=f.project_id
      WHERE f.keyword_id=k.id AND route.mode<>'stopped' AND f.business_date>=route.exclusive_from AND ${unconfirmedFactSql()})
    ORDER BY k.id`,
      [scope.accountId, scope.projectId],
    );
    let refreshed = 0;
    if (apply) {
      for (const word of words) refreshed += await refreshUnconfirmedKeyword(c, scope, String(word.id));
      await audit(c, user, 'work.reconcile-existing', scope.projectId, {
        keywordIds: words.map((w) => w.id),
        refreshed,
      });
    }
    return { apply, keywordIds: words.map((w) => String(w.id)), records: words.length, refreshed };
  });
}
