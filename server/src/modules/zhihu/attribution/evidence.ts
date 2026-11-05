import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../../../types';
import type { DataScope, EvidenceAction, EvidenceCheck, EvidenceFilter, EvidenceResult, EvidenceRow, EvidenceSourceRef } from '../../../core/contracts';
import { dutyAllows } from '../../../core/duties';
import { resolveMemberHistory } from '../../../core/member-history';
import { createHistoryKeywordContext } from '../services/account-lifecycle';
import { digest, fail } from './domain';
import { select, json, type RecordRow } from './store';
import { normalizedName } from './matching';
import { reconcileWorkReview } from './work-receipts';
import { allocations } from './allocations';
import type { AttributionSnapshot } from './facts';
import { reasonText } from './reasons';

const text = (value: unknown): string | null => value == null || value === 'null' ? null : String(value);
const uniqueRefs = (refs: EvidenceSourceRef[]) => [...new Map(refs.map(r => [r.kind + ':' + r.id, r])).values()];
const rowRef = (r: RecordRow): EvidenceSourceRef => ({ kind: 'official_row', id: String(r.id), batchId: String(r.batch_id), line: Number(r.line_number) });
const check = (status: EvidenceCheck['status'], reason: string, sourceRefs: EvidenceSourceRef[] = [], nextAction?: EvidenceAction): EvidenceCheck =>
  ({ status, reason, sourceRefs, ...(nextAction ? { nextAction } : {}) });
const day = (v: unknown) => String(v ?? '').slice(0, 10);

/** Read the existing adopted sources. This query deliberately never attributes,
 * reviews, confirms or pays; a GET must not change financial or work state. */
export async function readEvidence(c: PoolConnection, scope: DataScope, user: AuthUser, filter: EvidenceFilter): Promise<EvidenceResult> {
  const finance = dutyAllows(user, 'finance'), metrics = filter.metricType ? [filter.metricType] : ['new_user', 'activation'];
  const days = (Date.parse(scope.to) - Date.parse(scope.from)) / 86400000 + 1;
  const where = `k.project_id=? AND k.account_id=?${filter.channelRef ? ' AND k.channel_mapping_id=?' : ''}${filter.taskRef ? ' AND k.id=?' : ''}`;
  const args = [scope.projectId, scope.accountId, ...(filter.channelRef ? [filter.channelRef] : []), ...(filter.taskRef ? [filter.taskRef] : [])];
  const [count] = await select(c, `SELECT COUNT(*) total FROM zh_keywords k WHERE ${where}`, args);
  const total = Number(count.total) * days * metrics.length;
  const result: EvidenceResult = { ...scope, moduleId: 'zhihu', status: total ? 'ready' : 'empty', total,
    page: filter.page, pageSize: filter.pageSize, list: [], limits: { maxDays: 31, maxPageSize: 100 } };
  if ((filter.page - 1) * filter.pageSize >= total) return result;
  // Scope and optional filters precede both COUNT and paging. Dates without a
  // report remain visible, including explicit zero versus an absent record.
  const grid = await select(c, `WITH RECURSIVE days AS (
    SELECT CAST(? AS DATE) d UNION ALL SELECT DATE_ADD(d,INTERVAL 1 DAY) FROM days WHERE d<CAST(? AS DATE)),
    metrics AS (${metrics.map(() => 'SELECT ? metric').join(' UNION ALL ')})
    SELECT k.id,k.keyword,k.task_id,k.plan_id,k.channel_mapping_id,k.version,k.legacy_mode,
      DATE_FORMAT(days.d,'%Y-%m-%d') business_day,metrics.metric
    FROM zh_keywords k CROSS JOIN days CROSS JOIN metrics WHERE ${where}
    ORDER BY k.id,days.d,metrics.metric LIMIT ? OFFSET ?`,
    [scope.from, scope.to, ...metrics, ...args, filter.pageSize, (filter.page - 1) * filter.pageSize]);
  const ids = [...new Set(grid.map(r => String(r.id)))];
  const mappings = await select(c, `SELECT id,COALESCE(canonical_id,id) stable_id,project_id,channel_name,
    DATE_FORMAT(effective_from,'%Y-%m-%d') start_day,DATE_FORMAT(effective_to,'%Y-%m-%d') end_day
    FROM zh_channel_mappings WHERE account_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)`, [scope.accountId, scope.to, scope.from]);
  const matchChannel = (name: string, at: string) => [...new Map(mappings.filter(m => String(m.start_day) <= at && (!m.end_day || String(m.end_day) > at)
    && normalizedName(String(m.channel_name)) === normalizedName(name)).map(m => [String(m.project_id) + ':' + m.stable_id, m])).values()];
  const facts = await select(c, `SELECT f.id,f.keyword_id,f.channel_mapping_id,f.metric_type,f.version,f.current_revision_id,f.current_result_id,
    DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day,r.status revision_status,r.created_at revision_at,
    JSON_OBJECT('orders',JSON_EXTRACT(r.snapshot_json,'$.orders'),'activations',JSON_EXTRACT(r.snapshot_json,'$.activations'),
      'withdrawn',JSON_EXTRACT(r.snapshot_json,'$.withdrawn'),'sources',JSON_EXTRACT(r.snapshot_json,'$.sources')) official,
    a.reason_code,a.status calculation_status,a.binding_id,a.input_hash,a.created_at calculated_at,
    EXISTS(SELECT 1 FROM zh_statement_entries se WHERE se.fact_id=f.id AND se.status='confirmed') OR
      EXISTS(SELECT 1 FROM opc_income_sources ins WHERE ins.module_id='zhihu' AND ins.project_id=f.project_id AND ins.account_id=f.account_id AND ins.source_key=CONCAT('fact:',f.id)) confirmed
    ${finance ? ',a.snapshot_json calculation' : ''}
    FROM zh_metric_facts f LEFT JOIN zh_metric_revisions r ON r.id=f.current_revision_id
    LEFT JOIN zh_attribution_results a ON a.id=f.current_result_id
    WHERE f.project_id=? AND f.account_id=? AND f.keyword_id IN (?) AND f.business_date BETWEEN ? AND ? AND f.metric_type IN (?)`,
    [scope.projectId, scope.accountId, ids, scope.from, scope.to, metrics]);
  const factIds = facts.map(f => String(f.id));
  const pending = factIds.length ? await select(c, `SELECT id,fact_id,source_row_id,created_at FROM zh_metric_revisions
    WHERE fact_id IN (?) AND status='pending' ORDER BY id`, [factIds]) : [];
  const bindings = await select(c, `SELECT id,keyword_id,path_type,leader_id,executor_id,version,verification_status,relation_snapshot,
    DATE_FORMAT(activated_on,'%Y-%m-%d') start_day,DATE_FORMAT(released_at,'%Y-%m-%d %H:%i:%s') end_time,used_at
    FROM zh_keyword_bindings WHERE keyword_id IN (?) ORDER BY id`, [ids]);
  // Operations may inspect status and provenance but SQL never selects their
  // monetary fields, raw upload JSON, unit prices or calculation snapshots.
  const rawProjection = `r.id,r.batch_id,r.line_number,r.fact_id,r.processing_status,r.error_text,b.report_kind,b.status batch_status,b.created_at,
    m.keyword_id chosen_keyword,m.channel_mapping_id chosen_channel,
    JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.date')) business_day,
    JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.channel')) channel,
    JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.keyword')) keyword,
    JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.orders')) orders,
    JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.activations')) activations`;
  const names = [...new Set(grid.map(r => normalizedName(String(r.keyword))))];
  const sources = await select(c, `SELECT ${rawProjection} FROM zh_import_rows r JOIN zh_import_batches b ON b.id=r.batch_id
    LEFT JOIN zh_import_row_matches m ON m.source_row_id=r.id
    WHERE b.account_id=? AND b.project_id=? AND b.status IN ('preview','committed','processed','withdrawn')
      AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.date')) BETWEEN ? AND ?
      AND (r.fact_id IN (${factIds.length ? '?' : 'NULL'}) OR m.keyword_id IN (?) OR
        REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.keyword')),'[[:space:]　]+','') COLLATE utf8mb4_unicode_ci IN (?))
    ORDER BY r.id LIMIT 5001`, [scope.accountId, scope.projectId, scope.from, scope.to, ...(factIds.length ? [factIds] : []), ids, names]);
  if (sources.length > 5000) fail('所选记录的来源较多，请缩小日期范围或选择一个关键词继续查询');
  const coverage = await select(c, `SELECT JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.date')) business_day,
    JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.channel')) channel,b.report_kind,
    COALESCE(m.channel_mapping_id,f.channel_mapping_id) chosen_channel,COUNT(*) records
    FROM zh_import_rows r JOIN zh_import_batches b ON b.id=r.batch_id
    LEFT JOIN zh_import_row_matches m ON m.source_row_id=r.id LEFT JOIN zh_metric_facts f ON f.id=r.fact_id
    WHERE b.account_id=? AND b.project_id=? AND b.status IN ('committed','processed')
      AND r.processing_status IN ('pending','processed','duplicate','exception')
      AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.date')) BETWEEN ? AND ?
      AND ((b.report_kind IN ('order','combined') AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.orders')) REGEXP '^[0-9]+$')
        OR (b.report_kind='activation' AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.activations')) REGEXP '^[0-9]+$'))
    GROUP BY business_day,channel,b.report_kind,chosen_channel LIMIT 2001`, [scope.accountId, scope.projectId, scope.from, scope.to]);
  if (coverage.length > 2000) fail('所选日期涉及较多渠道，请缩小日期范围继续查询');
  const rates = await select(c, `SELECT id,metric_type,rule_code,status,DATE_FORMAT(effective_from,'%Y-%m-%d') start_day,
    DATE_FORMAT(effective_to,'%Y-%m-%d') end_day,published_at FROM opc_rate_rules WHERE project_id=? AND module_id='zhihu'
    AND effective_from<=? AND (effective_to IS NULL OR effective_to>?) ORDER BY id`, [scope.projectId, scope.to, scope.from]);
  const reviewRecords = await select(c, `SELECT r.id,r.binding_id,r.policy,r.status,r.composition_id,r.evidence_id FROM zh_work_review_records r
    JOIN zh_keyword_bindings b ON b.id=r.binding_id WHERE b.keyword_id IN (?) ORDER BY r.id`, [ids]);
  const reviews = new Map<string, Awaited<ReturnType<typeof reconcileWorkReview>>>();
  for (const id of ids) reviews.set(id, await reconcileWorkReview(c, scope, id, { apply: false, trigger: 'evidence.query' }));
  for (const word of grid) {
    const keywordId = String(word.id), at = String(word.business_day), metric = String(word.metric), channelId = String(word.channel_mapping_id);
    const fact = facts.find(f => String(f.keyword_id) === keywordId && String(f.business_day) === at && f.metric_type === metric);
    const adopted = fact?.official ? json<{ orders: string | null; activations: string | null; withdrawn?: boolean; sources?: Record<string, { rowId: string }> }>(fact.official) : null;
    const field = metric === 'activation' ? 'activations' : 'orders';
    const applicableKind = (kind: unknown) => metric === 'activation' ? kind === 'activation' : ['order', 'combined'].includes(String(kind));
    const matchesChannel = (r: RecordRow) => {
      if (r.chosen_channel) return String(r.chosen_channel) === channelId;
      const found = matchChannel(String(r.channel ?? ''), at);
      return found.length === 1 && String(found[0].project_id) === scope.projectId && String(found[0].stable_id) === channelId;
    };
    const relevant = sources.filter(r => {
      if (String(r.business_day) !== at || !applicableKind(r.report_kind)) return false;
      if (fact && String(r.fact_id) === String(fact.id)) return true;
      if (r.chosen_keyword && String(r.chosen_keyword) !== keywordId || !r.chosen_keyword && normalizedName(String(r.keyword)) !== normalizedName(String(word.keyword))) return false;
      if (r.chosen_channel) return String(r.chosen_channel) === channelId;
      const found = matchChannel(String(r.channel ?? ''), at);
      // Unresolved candidates stay visible, but are never treated as adopted
      // evidence or as proof that this canonical channel was covered.
      return !found.length || found.some(m => String(m.project_id) === scope.projectId && String(m.stable_id) === channelId);
    });
    const active = relevant.filter(r => r.batch_status !== 'withdrawn');
    const observed = coverage.some(r => String(r.business_day) === at && applicableKind(r.report_kind) && matchesChannel(r));
    const conflicts = pending.filter(p => String(p.fact_id) === String(fact?.id));
    const quantity = adopted?.withdrawn ? null : text(adopted?.[field]);
    const upload: EvidenceAction = { key: 'upload_official_report', label: metric === 'activation' ? '补传拉活资料' : '补传订单资料', method: 'POST',
      path: '/api/v1/modules/zhihu/workbench/import', requiredDuty: 'finance', parameters: { projectId: scope.projectId, accountId: scope.accountId, reportType: metric } };
    const task: EvidenceAction = { key: 'open_task', label: '核对任务与作品', method: 'GET', path: `/api/v1/core/tasks/zhihu/${scope.accountId}/${keywordId}`,
      requiredDuty: 'operations', parameters: { projectId: scope.projectId } };
    const rateAction: EvidenceAction = { key: 'set_pricing', label: '核对计价规则', method: 'GET', path: '/api/v1/core/rates', requiredDuty: 'finance',
      parameters: { projectId: scope.projectId, moduleId: 'zhihu', metricType: metric } };
    const pendingSource = sources.find(r => String(r.id) === String(conflicts[0]?.source_row_id));
    const analysisSource = pendingSource ?? active.find(r => r.processing_status === 'exception') ?? active[0];
    const analysis: EvidenceAction | undefined = analysisSource ? { key: 'resolve_official_source', label: '核对报表记录', method: 'GET',
      path: `/api/v1/modules/zhihu/imports/${analysisSource.batch_id}/analysis`, requiredDuty: conflicts.length ? 'finance' : 'operations',
      parameters: { projectId: scope.projectId, accountId: scope.accountId } } : undefined;
    let officialStatus: EvidenceRow['official']['status'];
    if (conflicts.length || active.some(r => !matchesChannel(r) && matchChannel(String(r.channel ?? ''), at).length > 1)) officialStatus = 'conflict';
    else if (active.some(r => !matchesChannel(r))) officialStatus = 'unknown';
    else if (quantity != null) officialStatus = BigInt(quantity) === 0n ? 'valid_zero' : 'ready';
    else if (active.some(r => r.processing_status === 'pending')) officialStatus = 'processing';
    else if (active.length) officialStatus = 'unknown';
    else if (relevant.length || adopted?.withdrawn) officialStatus = 'withdrawn';
    else officialStatus = observed ? 'record_missing' : 'not_arrived';
    const adoptedSource = text(adopted?.sources?.[field]?.rowId);
    const sourceRefs = active.map(r => ({ ...rowRef(r), status: (String(r.id) === adoptedSource ? 'adopted' :
      ['pending','exception','invalid'].includes(String(r.processing_status)) || conflicts.some(p => String(p.source_row_id) === String(r.id)) ? 'pending' :
      quantity != null && text(r[field]) !== quantity ? 'superseded' : 'available') as EvidenceSourceRef['status'] }));
    if (adoptedSource && !sourceRefs.some(r => r.id === adoptedSource) && !relevant.some(r => String(r.id) === adoptedSource && r.batch_status === 'withdrawn'))
      sourceRefs.push({ kind: 'official_row', id: adoptedSource, status: 'adopted' });
    const official: EvidenceRow['official'] = { status: officialStatus, quantity, quantityUnit: metric === 'activation' ? '次' : '单',
      coverageBasis: observed || relevant.length ? 'observed_rows' : 'none', coverageIsExhaustive: false, sourceRefs,
      withdrawnSourceRefs: relevant.filter(r => r.batch_status === 'withdrawn').map(r => ({ ...rowRef(r), status: 'withdrawn' })),
      currentRevision: text(fact?.current_revision_id), pendingConflict: conflicts.map(p => ({ revisionId: String(p.id), sourceRefs: [
        { ...(sources.find(r => String(r.id) === String(p.source_row_id)) ? rowRef(sources.find(r => String(r.id) === String(p.source_row_id))!) : { kind: 'official_row', id: String(p.source_row_id) }), status: 'pending' },
      ] })) };
    const candidates = bindings.filter(b => String(b.keyword_id) === keywordId && b.executor_id && b.start_day && String(b.start_day) <= at && (!b.end_time || day(b.end_time) >= at));
    const binding = fact?.binding_id ? bindings.find(b => String(b.id) === String(fact.binding_id)) : candidates.length === 1 ? candidates[0] : undefined;
    const bindingRef: EvidenceSourceRef[] = binding ? [{ kind: 'saved_execution', id: String(binding.id) }] : [];
    const ownership = binding ? check('ready', '使用任务保存的历史执行关系', bindingRef) :
      check(candidates.length > 1 ? 'conflict' : 'unknown', candidates.length > 1 ? '同日执行关系需要核对' : '缺少该日的历史执行关系', [], task);
    let participation: EvidenceCheck = check('unknown', '先核对历史执行人，再核对项目参与记录', [], task);
    if (binding?.path_type === 'staff_self') {
      // The saved execution path is authoritative. Management self-execution
      // does not require a member project assignment; today's role is irrelevant.
      participation = check('not_applicable', '该任务保存为管理岗位本人执行，无需单独分配项目', bindingRef);
    } else if (binding) {
      const history = await resolveMemberHistory(c, String(binding.executor_id), scope.projectId, { at });
      const refs = history.projectParticipation.sources.map(s => ({ kind: 'member_history', id: s.id }));
      participation = history.projectParticipation.status === 'matched' && history.projectParticipation.value === true
        ? check('ready', '该日项目参与记录已核实', refs)
        : check(history.projectParticipation.status === 'conflict' ? 'conflict' : history.projectParticipation.status === 'matched' ? 'blocked' : 'unknown',
          history.projectParticipation.status === 'matched' ? '该日没有参与当前项目' : '该日项目参与依据尚未完整', refs);
      participation.version = String(history.version);
      if (participation.status !== 'ready') participation.nextAction = {
        key: 'complete_member_history', label: '补充历史依据', method: 'POST', path: `/api/v1/core/relations/members/${binding.executor_id}/history-evidence`,
        requiredDuty: 'operations', parameters: { projectId: scope.projectId, effectiveFrom: at, timePrecision: 'date' },
        expectedHistoryVersion: history.version,
        historyContext: await createHistoryKeywordContext(c, scope, keywordId, String(binding.executor_id), { from: at, to: at }),
      };
    }
    const review = (reviews.get(keywordId) ?? []).find(r => r.bindingId === String(binding?.id));
    const workRefs = uniqueRefs([...(review?.sources ?? []).map(s => ({ kind: s.kind === 'composition' ? 'composition' : 'work_evidence', id: s.id })),
      ...reviewRecords.filter(r => String(r.binding_id) === String(binding?.id)).map(r => ({ kind: 'work_review', id: String(r.id) }))]);
    const work = review && review.status !== 'blocked' && (review.previousStatus === 'passed' || review.status === 'ready')
      ? check('ready', '作品登记有效，采用平台已保存的核验规则', workRefs)
      : check(review?.reasonCode?.includes('CONFLICT') ? 'conflict' : review?.reasonCode === 'WORK_MISSING' || !review ? 'missing' : 'blocked',
        review?.reason || '还没有有效作品登记', workRefs, task);
    work.version = digest({ review, records: reviewRecords.filter(r => String(r.binding_id) === String(binding?.id)) });
    const applicableRates = rates.filter(r => r.metric_type === metric && r.status === 'published' && String(r.start_day) <= at && (!r.end_day || String(r.end_day) > at));
    const requiredCodes = !binding ? [] : binding.path_type === 'team_creator' ? ['creator', 'leader_override'] : binding.path_type === 'leader_self' ? ['leader_self'] :
      binding.path_type === 'staff_self' ? ['staff_self'] : ['creator'];
    if (binding && metric === 'activation') requiredCodes.push('upstream');
    const counts = requiredCodes.map(code => applicableRates.filter(r => r.rule_code === code).length);
    const pricing = !binding ? check('unknown', '执行关系核实后可确定计价规则', [], task) : counts.some(n => n > 1) ? check('conflict', '该日存在重叠计价规则', [], rateAction) :
      counts.some(n => !n) ? check('missing', '该日计价规则未补齐', [], rateAction) : check('ready', '计价规则已覆盖该日');
    // A confirmed result keeps its saved quote even if newer rate metadata changes.
    if (Number(fact?.confirmed) === 1 && fact?.current_result_id) { pricing.status = 'ready'; pricing.reason = '使用已确认账保存的计价结果'; delete pricing.nextAction; }
    pricing.sourceRefs = applicableRates.map(r => ({ kind: 'pricing_rule', id: String(r.id) }));
    pricing.version = digest(applicableRates);
    const code = text(fact?.reason_code);
    const calculation = !fact?.current_result_id ? check('missing', '资料齐备后自动形成核算结果') : code ?
      check(code.includes('OVERLAP') ? 'conflict' : 'blocked', reasonText(code, { metricType: metric }).reason,
        [{ kind: 'calculation', id: String(fact.current_result_id) }], code.startsWith('PRICE_') ? rateAction : code === 'REPORT_INCOMPLETE' ? upload : task)
      : check('ready', Number(fact.confirmed) === 1 ? '已确认金额保持不变，资料变化按原更正流程办理' : '已有未确认核算结果', [{ kind: 'calculation', id: String(fact.current_result_id) }]);
    calculation.version = text(fact?.input_hash) ?? undefined;
    const checks = { work, historicalOwnership: ownership, projectParticipation: participation, pricing, existingCalculation: calculation };
    const officialReasons: Record<EvidenceRow['official']['status'], string> = { ready: '官方数量已找到', valid_zero: '官方记录为零，资料有效',
      not_arrived: '该日尚未收到所需官方资料', record_missing: '同日已有官方资料，但缺少该关键词的有效记录',
      conflict: '多份官方资料不一致，需要选择采用来源', withdrawn: '所需官方来源已全部撤回', processing: '官方资料正在处理', unknown: '官方记录尚未完成核对' };
    const officialReady = ['ready', 'valid_zero'].includes(officialStatus);
    const blocked = Object.values(checks).find(v => v.status !== 'ready' && v.status !== 'not_applicable');
    const nextAction = !officialReady ? analysis && ['conflict', 'unknown', 'processing'].includes(officialStatus) ? analysis : upload : blocked?.nextAction ?? null;
    const reason = !officialReady ? officialReasons[officialStatus] : blocked?.reason ?? '资料已齐备，可继续财务核对';
    result.list.push({ key: { projectId: scope.projectId, accountId: scope.accountId, channelRef: channelId, taskRef: keywordId, businessDate: at, metricType: metric },
      title: String(word.keyword), official, checks,
      result: { status: officialStatus === 'processing' ? 'processing' : officialReady && !blocked ? 'ready' : blocked?.status === 'unknown' || officialStatus === 'unknown' ? 'unknown' : 'needs_input',
        reason, responsibleRole: nextAction?.requiredDuty ?? (blocked ? 'operations' : null), nextAction,
        evidenceVersion: digest({ key: [scope.projectId, scope.accountId, channelId, keywordId, at, metric], wordVersion: word.version, official,
          sources: relevant.map(r => [r.id,r.batch_status,r.processing_status,r.error_text,r.chosen_keyword,r.chosen_channel]), checks, factVersion: fact?.version }),
        lastChangedAt: null },
      ...(finance ? { finance: { amount: fact?.calculation && calculation.status === 'ready' ? allocations(json<AttributionSnapshot>(fact.calculation)).total : null,
        currency: 'CNY' as const, sourceRefs: calculation.sourceRefs } } : {}) });
  }
  return result;
}
