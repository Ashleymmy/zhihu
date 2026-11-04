import type { AuthUser } from '../../../types';
import { withTransaction } from '../../../db';
import { assertDuty } from '../../../core/duties';
import type { Scope } from './domain';
import { audit, authorize, scopeLock, select } from './store';
import { refreshUnconfirmedKeyword } from './automatic-repair';
import { reconcileWorkReview, type WorkReviewItem } from './work-receipts';

/** Release repair is read-only by default and never confirms financial entries. */
export async function reconcileRegisteredWorks(user: AuthUser, scope: Scope, apply = false) {
  assertDuty(user, 'finance');
  await authorize(user, scope);
  return withTransaction(async (c) => {
    if (apply) await scopeLock(c, scope, user);
    const words = await select(
      c,
      `SELECT CAST(k.id AS CHAR) id FROM zh_keywords k
      WHERE k.account_id=? AND k.project_id=? AND EXISTS(
        SELECT 1 FROM zh_keyword_bindings b WHERE b.keyword_id=k.id AND (b.used_at IS NOT NULL OR EXISTS(SELECT 1 FROM zh_evidence e WHERE e.binding_id=b.id)))
      ORDER BY k.id${apply ? ' FOR UPDATE' : ''}`,
      [scope.accountId, scope.projectId],
    );
    const items: WorkReviewItem[] = [];
    let refreshed = 0;
    for (const word of words) {
      const decisions = await reconcileWorkReview(c, scope, String(word.id), {
        apply,
        trigger: 'work.reconcile-existing',
        actorId: user.sub,
      });
      items.push(...decisions);
      if (decisions.some((item) => item.changed))
        refreshed += await refreshUnconfirmedKeyword(c, scope, String(word.id));
    }
    const changed = items.filter((item) => item.changed).length;
    if (changed)
      await audit(c, user, 'work.reconcile-existing', scope.projectId, {
        keywordIds: words.map((word) => word.id),
        changed,
        refreshed,
      });
    return {
      apply,
      keywordIds: words.map((word) => String(word.id)),
      records: words.length,
      refreshed,
      changed,
      eligible: items.filter((item) => item.status === 'ready' || item.status === 'applied').length,
      blocked: items.filter((item) => item.status === 'blocked').length,
      blockedSources: items.reduce(
        (total, item) => total + item.sources.filter((source) => source.status === 'blocked').length,
        0,
      ),
      items,
    };
  });
}
