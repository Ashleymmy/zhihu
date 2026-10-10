import type { AuthUser } from '../../../types';
import { assertDuty } from '../../../core/duties';
import { authorize, mutate, select, json } from './store';
import { businessDay, type Scope } from './domain';
import { withTransaction } from '../../../db';
import type { AllianceUploadFile } from '../zhihu/allianceXlsx';
import { parseReport, type MetricType, type ReportKind, type SourceRow } from './report';
import { previewImport, importDetail, commitImportInTransaction } from './facts';

export async function previewWorkbenchImport(
  user: AuthUser,
  scope: Scope,
  file: AllianceUploadFile,
  reportType: MetricType,
  key: string,
) {
  assertDuty(user, 'finance');
  scope = { accountId: scope.accountId, projectId: scope.projectId };
  await authorize(user, scope);
  let kind: ReportKind = reportType === 'activation' ? 'activation' : 'combined';
  if (reportType === 'new_user') {
    try {
      await parseReport(file, kind);
    } catch (e) {
      if (!(e instanceof Error) || e.message !== '报告类型与指标列不一致') throw e;
      kind = 'order';
      try {
        await parseReport(file, kind);
      } catch (e2) {
        if (!(e2 instanceof Error) || e2.message !== '报告类型与指标列不一致') throw e2;
        kind = 'search';
      }
    }
  }
  const batch = await previewImport(user, scope, file, kind, { key, deferBoundary: true });
  const detail = await importDetail(user, scope, batch.id, 1, 100);
  const range = await withTransaction(
    async (c) =>
      (
        await select(
          c,
          "SELECT MIN(JSON_UNQUOTE(JSON_EXTRACT(normalized_json,'$.date'))) first_day,MAX(JSON_UNQUOTE(JSON_EXTRACT(normalized_json,'$.date'))) last_day FROM zh_import_rows WHERE batch_id=? AND processing_status NOT IN ('invalid','skipped')",
          [batch.id],
        )
      )[0],
  );
  return {
    ...batch,
    status: detail.status,
    reportType,
    reportKind: kind,
    from: String(range.first_day ?? businessDay()),
    to: String(range.last_day ?? businessDay()),
    previewHash: detail.preview_hash,
    total: detail.counts.reduce((n, r) => n + r.total, 0),
    invalidRows: detail.counts.filter((r) => r.processing_status === 'invalid').reduce((n, r) => n + r.total, 0),
    page: 1,
    pageSize: 100,
    rows: detail.rows.map((row) => ({
      id: String(row.id),
      lineNumber: Number(row.line_number),
      ...json<SourceRow>(row.normalized_json),
      error: row.error_text ?? null,
      status: row.processing_status,
    })),
  };
}

export async function commitWorkbenchImport(
  user: AuthUser,
  scope: Scope,
  id: string,
  key: string,
  previewHash: string,
) {
  assertDuty(user, 'finance');
  scope = { accountId: scope.accountId, projectId: scope.projectId };
  return mutate(
    user,
    scope,
    'workbench.import.commit',
    key,
    { id, previewHash },
    async (c) => {
      await commitImportInTransaction(c, user, scope, id, previewHash, true);
      const [counts] = await select(
        c,
        "SELECT COALESCE(SUM(processing_status='pending'),0) remaining,COALESCE(SUM(processing_status IN ('processed','duplicate')),0) processed FROM zh_import_rows WHERE batch_id=?",
        [id],
      );
      return { id, processed: Number(counts.processed), remaining: Number(counts.remaining) };
    },
    true,
  );
}
