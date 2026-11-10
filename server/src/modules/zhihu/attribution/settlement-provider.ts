import type { SettlementProvider, SettlementSourceCheck, SettlementScope } from '../../../core/settlement-contracts';
import type { EvidenceRow } from '../../../core/contracts';
import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../../../types';
import { confirmEarningSource } from '../../../core/earnings';
import { checksum } from '../../../core/money';
import { overview } from './workbench';
import { readEvidence } from './evidence';
import { scopeLock, select, audit } from './store';
import { confirmFinancialFact, type FinancialConfirmationContext } from './statements';
import { fail } from './domain';
import type { MetricType } from './report';

export const zhihuSettlementProvider: SettlementProvider = {
  lock: (c, user, scope) => scopeLock(c, scope, user),
  async inspect(c, user, scope, sourceKeys) {
    if (scope.metricType && !['new_user', 'activation'].includes(scope.metricType)) fail('请选择拉新或拉活业绩');
    if (!sourceKeys.length) return [];
    const ids = sourceKeys.map((key) => {
      if (!/^fact:[1-9]\d*$/.test(key)) fail('收益来源暂不可核对', 409);
      return key.slice(5);
    });
    const view = await overview(
      user,
      scope,
      { from: scope.from, to: scope.to, ...(scope.metricType ? { metricType: scope.metricType as MetricType } : {}) },
      c,
      ids,
    );
    const sourceEntries = new Map(ids.map((id) => [id, view.entries.filter((e) => e.factId === id)]));
    const keys = [
      ...new Map(
        view.entries.map((e) => [
          `${e.keywordId}:${e.date}:${e.metricType}`,
          { taskRef: e.keywordId, businessDate: e.date, metricType: e.metricType },
        ]),
      ).values(),
    ].sort(
      (a, b) =>
        a.businessDate.localeCompare(b.businessDate) ||
        a.taskRef.localeCompare(b.taskRef) ||
        a.metricType.localeCompare(b.metricType),
    );
    const evidenceRows = new Map<string, EvidenceRow>();
    for (let offset = 0; offset < keys.length;) {
      const batch = keys
        .slice(offset, offset + 100)
        .filter((k) => (Date.parse(k.businessDate) - Date.parse(keys[offset].businessDate)) / 86400000 < 31);
      offset += batch.length;
      const dates = batch.map((k) => k.businessDate).sort();
      const result = await readEvidence(
        c,
        { projectId: scope.projectId, accountId: scope.accountId, from: dates[0], to: dates.at(-1)! },
        user,
        { page: 1, pageSize: 100 },
        batch,
      );
      for (const row of result.list)
        evidenceRows.set(`${row.key.taskRef}:${row.key.businessDate}:${row.key.metricType}`, row);
    }
    const result: SettlementSourceCheck[] = [];
    for (const id of ids) {
      const entries = sourceEntries.get(id)!;
      if (!entries.length) continue;
      const first = entries[0],
        key = 'fact:' + id;
      const evidence = evidenceRows.get(`${first.keywordId}:${first.date}:${first.metricType}`) ?? null;
      const correction =
        entries.some((e) => e.kind === 'adjustment') &&
        entries.every((e) => ['REPORT_WITHDRAWN', 'RISK_EXCLUDED', ''].includes(e.reasonCode));
      const confirmed = entries.every((e) => e.status === 'confirmed');
      const ready = entries.every((e) => e.ready) && (evidence?.result.status === 'ready' || correction);
      const status = confirmed ? 'confirmed' : ready ? 'ready' : 'blocked';
      const evidenceBlocked = evidence && evidence.result.status !== 'ready';
      // Workbench names the actual executor/leader for work submission/review.
      // Other evidence blockers must not inherit its generic "finance confirm" next step.
      const useWorkNext =
        evidenceBlocked &&
        ['ready', 'valid_zero'].includes(evidence.official.status) &&
        !['ready', 'not_applicable'].includes(evidence.checks.work.status) &&
        first.reasonCode.startsWith('WORK_');
      const blockedNext = useWorkNext
        ? first.next
        : evidenceBlocked && evidence.result.nextAction
          ? `${evidence.result.responsibleRole === 'finance' ? '财务' : '运营'}：${evidence.result.nextAction.label}`
          : first.blocked && first.next
            ? first.next
            : evidenceBlocked
              ? `${evidence.result.responsibleRole === 'finance' ? '财务' : '运营'}：核对所缺资料`
              : first.next || '运营：核对所缺资料';
      result.push({
        sourceKey: key,
        version: first.resultId,
        token: checksum({
          confirmation: first.confirmationToken,
          evidenceVersion: evidence?.result.evidenceVersion,
          status,
        }),
        status,
        reason:
          status === 'confirmed'
            ? '金额已确认'
            : status === 'ready'
              ? '资料齐备，可核对并确认'
              : evidenceBlocked
                ? evidence.result.reason
                : first.blocked || '资料尚未齐备',
        next: status === 'confirmed' ? '' : status === 'ready' ? '财务：核对并确认金额' : blockedNext,
        nextAction: status === 'blocked' ? (evidence?.result.nextAction ?? null) : null,
        evidence,
        allocations: entries
          .filter((e) => !e.internal && e.payeeId)
          .map((e) => ({ payeeId: e.payeeId, amount: e.amount })),
      });
    }
    return result;
  },
  async context(c, _user, scope) {
    const [coverage] = await select(
      c,
      `SELECT COALESCE(SUM(b.status IN ('committed','processed')),0) records,
        COALESCE(SUM(b.status='preview' OR (b.status IN ('committed','processed') AND r.processing_status='pending')),0) processing,
        COALESCE(SUM(b.status='withdrawn'),0) withdrawn
      FROM zh_import_rows r JOIN zh_import_batches b ON b.id=r.batch_id
      WHERE b.project_id=? AND b.account_id=?
      AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.date')) BETWEEN ? AND ?
      ${scope.metricType ? "AND IF(b.report_kind='activation','activation','new_user')=?" : ''}`,
      [scope.projectId, scope.accountId, scope.from, scope.to, ...(scope.metricType ? [scope.metricType] : [])],
    );
    // Count business keys rather than uploaded rows: duplicates and an unassigned copy of a resolved source
    // must not inflate the scope warning. A fact without a trustworthy recipient is also unresolved.
    const [unresolved] = await select(
      c,
      `SELECT COUNT(*) records,CAST(MIN(import_id) AS CHAR) import_id FROM (
      SELECT MIN(b.id) import_id,
        MAX(EXISTS(SELECT 1 FROM opc_earning_sources es JOIN opc_earning_lines el ON el.source_id=es.id AND el.source_version=es.current_version
          WHERE es.module_id='zhihu' AND es.project_id=b.project_id AND es.account_id=b.account_id AND es.source_key=CONCAT('fact:',f.id) AND el.is_internal=0)) has_recipient,
        MAX(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ar.snapshot_json,'$.binding.path_type'))='staff_self',0)) internal_record,
        MAX(r.fact_id IS NOT NULL OR r.processing_status='exception') needs_association
      FROM zh_import_rows r JOIN zh_import_batches b ON b.id=r.batch_id
      LEFT JOIN zh_metric_facts f ON f.id=r.fact_id AND f.project_id=b.project_id AND f.account_id=b.account_id
      LEFT JOIN zh_attribution_results ar ON ar.id=f.current_result_id
      WHERE b.project_id=? AND b.account_id=? AND b.status IN ('committed','processed') AND r.processing_status NOT IN ('invalid','skipped','legacy_settled')
      AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.date')) BETWEEN ? AND ?
      ${scope.metricType ? "AND IF(b.report_kind='activation','activation','new_user')=?" : ''}
      GROUP BY JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.date')),JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.channel')),
        JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.keyword')),IF(b.report_kind='activation','activation','new_user')
      ) pending WHERE has_recipient=0 AND internal_record=0 AND needs_association=1`,
      [scope.projectId, scope.accountId, scope.from, scope.to, ...(scope.metricType ? [scope.metricType] : [])],
    );
    const count = Number(unresolved.records);
    return {
      coverage: {
        status: Number(coverage.processing)
          ? 'processing'
          : Number(coverage.records)
            ? 'no_performance'
            : Number(coverage.withdrawn)
              ? 'withdrawn'
              : 'not_arrived',
        message: Number(coverage.processing)
          ? '所选范围的报表仍在处理中，财务可查看报表处理进度'
          : Number(coverage.records)
            ? '所选范围尚无可归属到该收款人的收益记录，可核对报表与待处理资料'
            : Number(coverage.withdrawn)
              ? '所选范围的来源报表已撤回，财务可查看上传记录或上传更正后的报表'
              : '所选范围尚未收到可采用的官方资料，请上传对应报表',
      },
      unresolvedContext: {
        records: count,
        reason: count ? '所选项目范围还有尚未确定归属的报表行，未计入这位团长的金额' : '',
        next: count ? '运营：核对报表中的任务与执行人' : '',
        nextAction: count
          ? {
              key: 'resolve_official_source',
              label: '核对报表记录',
              method: 'GET' as const,
              path: `/api/v1/modules/zhihu/imports/${unresolved.import_id}/analysis`,
              requiredDuty: 'operations' as const,
              parameters: { projectId: scope.projectId, accountId: scope.accountId },
            }
          : null,
      },
    };
  },
  confirm: (c, user, scope, sourceKey, version) => confirmSources(c, user, scope, [{ sourceKey, version }]),
  confirmMany: confirmSources,
};

async function confirmSources(
  c: PoolConnection,
  user: AuthUser,
  scope: SettlementScope,
  sources: { sourceKey: string; version: string }[],
) {
  const context: FinancialConfirmationContext = { workReviews: new Map() };
  const [route] = await select(
    c,
    'SELECT id,mode FROM zh_engine_routes WHERE project_id=? AND account_id=? FOR UPDATE',
    [scope.projectId, scope.accountId],
  );
  if (!route || route.mode === 'stopped') fail('业务已暂停，请恢复后重新预览', 409);
  if (route.mode === 'trial') {
    await c.query("UPDATE zh_engine_routes SET mode='enabled',sample_verified=1,reason=?,updated_by=? WHERE id=?", [
      '财务核对并确认结算',
      user.sub,
      route.id,
    ]);
    await audit(c, user, 'engine.finance-review', String(route.id), { sources: sources.length });
  }
  for (const { sourceKey, version } of sources) {
    if (!/^fact:[1-9]\d*$/.test(sourceKey)) fail('收益来源暂不可确认', 409);
    const factId = sourceKey.slice(5);
    const [fact] = await select(
      c,
      `SELECT CAST(current_revision_id AS CHAR) revision_id FROM zh_metric_facts WHERE id=? AND project_id=? AND account_id=?
      AND current_result_id=? AND business_date BETWEEN ? AND ? ${scope.metricType ? 'AND metric_type=?' : ''} FOR UPDATE`,
      [
        factId,
        scope.projectId,
        scope.accountId,
        version,
        scope.from,
        scope.to,
        ...(scope.metricType ? [scope.metricType] : []),
      ],
    );
    if (!fact) fail('资料或金额已变化，请刷新后重新预览', 409);
    await confirmFinancialFact(c, user, scope, factId, version, String(fact.revision_id), context);
    // Core already checked the saved projection against every current module allocation under this account lock.
    // Confirmation does not change attribution, so rebuilding that identical projection is unnecessary.
    await confirmEarningSource(c, user, scope, sourceKey, version);
  }
}
