import type { RowDataPacket } from 'mysql2/promise';
import { rows } from '../../../db';
import type { AuthUser } from '../../../types';
import { assertDataScope } from '../../../core/accounts';
import { effectiveDuty } from '../../../auth/roles';
import { hasPermission } from '../permissions';

export interface DataImportProcessing {
  state:
    | 'not_started'
    | 'processing'
    | 'needs_attention'
    | 'analyzed'
    | 'legacy_pending'
    | 'legacy_completed'
    | 'needs_scope';
  from: string | null;
  to: string | null;
  sourceOrders: string;
  sourceSearches: string;
  revenueProvided: boolean;
  matchedRows: number;
  pendingRows: number;
  exceptionRows: number;
  issues: { code: string; count: number }[];
  scope: { projectId: string; accountId: string } | null;
  attributionBatchId: string | null;
  retryAllowed: boolean;
}

/** Reconstruct current processing progress from persisted records. Never starts attribution on a GET. */
export async function readDataImportResult(
  user: AuthUser,
  batch: { id: string; fileSha256: string; status: string },
): Promise<DataImportProcessing> {
  const [metrics] = await rows<RowDataPacket>(
    `SELECT MIN(DATE_FORMAT(occurred_at,'%Y-%m-%d')) first_day,MAX(DATE_FORMAT(occurred_at,'%Y-%m-%d')) last_day,
       COALESCE(SUM(order_count),0) orders,COALESCE(SUM(search_volume),0) searches,
       COALESCE(SUM(revenue_amount IS NOT NULL),0) revenue_rows
     FROM data_import_rows WHERE batch_id=? AND validation_status='valid'`,
    [batch.id],
  );
  const result: DataImportProcessing = {
    state: 'not_started',
    from: metrics?.first_day ?? null,
    to: metrics?.last_day ?? null,
    sourceOrders: String(metrics?.orders ?? '0'),
    sourceSearches: String(metrics?.searches ?? '0'),
    revenueProvided: Number(metrics?.revenue_rows ?? 0) > 0,
    matchedRows: 0,
    pendingRows: 0,
    exceptionRows: 0,
    issues: [],
    scope: null,
    attributionBatchId: null,
    retryAllowed:
      batch.status === 'confirmed' && hasPermission(user.role, 'data.import') && effectiveDuty(user) === 'all',
  };
  if (batch.status !== 'confirmed') return result;
  const linked = await rows<RowDataPacket>(
    `SELECT CAST(id AS CHAR) id,CAST(project_id AS CHAR) project_id,CAST(account_id AS CHAR) account_id
     FROM zh_import_batches WHERE file_sha256=? AND status IN ('committed','processed') AND template_version='zhihu-v3'`,
    [batch.fileSha256],
  );
  if (linked.length > 1) return { ...result, state: 'needs_scope', retryAllowed: false };
  if (!linked.length) {
    const tasks = await rows<RowDataPacket>(
      `SELECT t.status,COUNT(*) total FROM attribution_tasks t WHERE EXISTS (
         SELECT 1 FROM data_import_rows r WHERE r.batch_id=? AND r.validation_status='valid'
           AND r.keyword=t.keyword AND DATE(r.occurred_at)=t.data_date
       ) GROUP BY t.status`,
      [batch.id],
    );
    if (!tasks.length) return result;
    const count = (status: string) => Number(tasks.find((row) => row.status === status)?.total ?? 0);
    return {
      ...result,
      state: tasks.every((row) => row.status === 'completed') ? 'legacy_completed' : 'legacy_pending',
      pendingRows: count('pending'),
      matchedRows: count('completed'),
      exceptionRows: count('failed'),
      retryAllowed: false,
    };
  }
  const scope = { projectId: String(linked[0].project_id), accountId: String(linked[0].account_id) };
  await assertDataScope(user, scope.projectId, scope.accountId, 'zhihu');
  const linkedId = String(linked[0].id);
  const counts = await rows<RowDataPacket>(
    'SELECT processing_status,COUNT(*) total FROM zh_import_rows WHERE batch_id=? GROUP BY processing_status',
    [linkedId],
  );
  const issues = await rows<RowDataPacket>(
    `SELECT e.reason_code,COUNT(*) total FROM zh_exceptions e
     WHERE e.account_id=? AND e.project_id=? AND e.status='open' AND EXISTS (
       SELECT 1 FROM zh_import_rows r WHERE r.batch_id=? AND (r.id=e.source_row_id OR r.fact_id=e.fact_id)
     ) GROUP BY e.reason_code`,
    [scope.accountId, scope.projectId, linkedId],
  );
  const count = (status: string) => Number(counts.find((row) => row.processing_status === status)?.total ?? 0);
  const pendingRows = count('pending');
  const exceptionRows = count('exception') + count('invalid');
  return {
    ...result,
    scope,
    attributionBatchId: linkedId,
    pendingRows,
    exceptionRows,
    matchedRows: count('processed') + count('duplicate'),
    issues: issues.map((row) => ({ code: String(row.reason_code), count: Number(row.total) })),
    state: !counts.length
      ? 'not_started'
      : pendingRows
        ? 'processing'
        : issues.length || exceptionRows
          ? 'needs_attention'
          : 'analyzed',
    retryAllowed: pendingRows > 0 && result.retryAllowed,
  };
}
