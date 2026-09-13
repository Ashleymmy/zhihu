import type { PoolConnection } from 'mysql2/promise';
import type { Scope } from './domain';
export async function scheduleImport(c: PoolConnection, scope: Scope, batchId: string, actorId: string) {
  await c.query(
    `INSERT INTO zh_processing_jobs(account_id,project_id,batch_id,actor_id) VALUES(?,?,?,?)
    ON DUPLICATE KEY UPDATE actor_id=VALUES(actor_id),status=IF(status='running',status,'pending'),next_attempt_at=NOW(3)`,
    [scope.accountId, scope.projectId, batchId, actorId],
  );
}
