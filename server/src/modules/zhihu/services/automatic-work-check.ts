import { withTransaction } from '../../../db';
import { scopeLock, select } from '../attribution/store';
import { refreshUnconfirmedKeyword } from '../attribution/automatic-repair';
import { reconcileWorkReceipts } from '../attribution/work-receipts';

// Use the same receipt/ownership checks when a work arrives and when a report
// encounters work that was registered earlier. Confirmed ledger rows are untouched.
export async function confirmSubmittedWorks(compositionId: string | null = null) {
  return withTransaction(async (c) => {
    const scopes = await select(
      c,
      `SELECT DISTINCT k.account_id,k.project_id FROM zh_keywords k
      JOIN compositions co ON co.plan_id=k.plan_id JOIN projects p ON p.id=k.project_id AND p.is_enabled=1
      JOIN integration_accounts a ON a.id=k.account_id AND a.status='active'
      WHERE (? IS NULL OR co.id=?) ORDER BY k.account_id,k.project_id`,
      [compositionId, compositionId],
    );
    let changed = 0;
    for (const row of scopes) {
      const scope = { accountId: String(row.account_id), projectId: String(row.project_id) };
      await scopeLock(c, scope);
      const words = await select(
        c,
        `SELECT DISTINCT k.id FROM zh_keywords k JOIN compositions co ON co.plan_id=k.plan_id
        WHERE k.account_id=? AND k.project_id=? AND (? IS NULL OR co.id=?) ORDER BY k.id`,
        [scope.accountId, scope.projectId, compositionId, compositionId],
      );
      for (const word of words)
        if (await reconcileWorkReceipts(c, scope, String(word.id))) {
          changed++;
          await refreshUnconfirmedKeyword(c, scope, String(word.id));
        }
    }
    return { bindings: { affectedRows: changed } };
  });
}
