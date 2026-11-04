import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import type { Scope } from './domain';
import { select, type RecordRow } from './store';
import { writeAudit, type AuditInput } from '../../../services/audit.service';

export function rejectedWork(work: Record<string, unknown>) {
  const raw = work.zhihu_status_json;
  const remote = ((typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {}) as Record<string, unknown>;
  return (
    ['ended', 'rejected'].includes(String(work.status)) ||
    !!String(work.reject_reason ?? '').trim() ||
    ['rejected', 'failed'].includes(String(remote.auditStatus ?? remote.audit_status ?? remote.status ?? '')) ||
    !!String(remote.rejectReason ?? remote.reject_reason ?? '').trim()
  );
}

export const submittedWorkSql = `co.sync_status='synced' AND NULLIF(TRIM(co.zhihu_composition_id),'') IS NOT NULL
  AND co.status NOT IN ('ended','rejected') AND NULLIF(TRIM(co.reject_reason),'') IS NULL
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(co.zhihu_status_json,'$.auditStatus')),
    JSON_UNQUOTE(JSON_EXTRACT(co.zhihu_status_json,'$.audit_status')),
    JSON_UNQUOTE(JSON_EXTRACT(co.zhihu_status_json,'$.status')),'') NOT IN ('rejected','failed')
  AND COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(co.zhihu_status_json,'$.rejectReason')),'null'),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(co.zhihu_status_json,'$.reject_reason')),'null'),'')=''`;

export const defaultWorkReviewPolicy = 'R7-default-review-v1';

/** Business review records outlive the operational audit retention window. */
export async function recordWorkReview(
  c: PoolConnection,
  bindingId: string,
  policy: string,
  status: string,
  event: AuditInput,
  source: { compositionId?: string; evidenceId?: string } = {},
) {
  await writeAudit(event, c);
  await c.query(
    `INSERT INTO zh_work_review_records
    (binding_id,composition_id,evidence_id,policy,status,decided_by,detail_json,source_audit_id)
    VALUES(?,?,?,?,?,?,?,LAST_INSERT_ID())`,
    [
      bindingId,
      source.compositionId ?? null,
      source.evidenceId ?? null,
      policy,
      status,
      event.userId,
      JSON.stringify(event.detail ?? {}),
    ],
  );
}

export interface WorkReviewSource {
  kind: 'evidence' | 'composition';
  id: string;
  status: 'ready' | 'blocked';
  reasonCode: string;
  reason: string;
}

export interface WorkReviewItem {
  keywordId: string;
  bindingId: string;
  executorId: string | null;
  previousStatus: string;
  status: 'ready' | 'blocked' | 'applied' | 'unchanged';
  reason: string;
  reasonCode: string;
  evidenceIds: string[];
  compositionIds: string[];
  sources: WorkReviewSource[];
  changed: boolean;
}

interface ReviewOptions {
  apply: boolean;
  lock?: boolean;
  trigger: string;
  actorId?: string | null;
}

function publicWorkUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? ''));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function withinExecution(work: RecordRow, binding: RecordRow) {
  return (
    !!work.published_at &&
    String(work.published_at) >= String(binding.from_day) &&
    (!binding.until_time || String(work.published_at) < String(binding.until_time))
  );
}

function sourceResult(kind: WorkReviewSource['kind'], id: unknown, reasonCode = '', reason = ''): WorkReviewSource {
  return { kind, id: String(id), status: reasonCode ? 'blocked' : 'ready', reasonCode, reason };
}

function manuallyReviewed(work: RecordRow, binding: RecordRow) {
  const raw = work.manually_reviewed_binding_ids;
  const ids = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(ids) && ids.map(String).includes(String(binding.id));
}

function compositionSource(work: RecordRow, binding: RecordRow, undatedAllowed: boolean) {
  const source = (code = '', reason = '') => sourceResult('composition', work.id, code, reason);
  if (rejectedWork(work)) return source('WORK_REJECTED', '作品已明确退回，运营需先更正原作品');
  if (work.sync_status === 'failed')
    return source('WORK_SUBMISSION_FAILED', '作品报送失败，运营需处理原作品的报送问题');
  if (Number(work.has_receipt) !== 1) return source('WORK_SUBMISSION_PENDING', '作品尚未完成报送，等待报送结果');
  if (!publicWorkUrl(work.promo_url)) return source('WORK_SOURCE_INVALID', '作品地址不完整，运营需核实原作品');
  if (!manuallyReviewed(work, binding) && !withinExecution(work, binding) && !(undatedAllowed && !work.published_at))
    return source('WORK_PERIOD_MISSING', '作品发布时间无法对应原执行期，运营需核实日期');
  return source();
}

function decideReview(
  binding: RecordRow,
  bindings: RecordRow[],
  works: RecordRow[],
  evidence: RecordRow[],
): WorkReviewItem {
  const foreign = works.filter((work) => String(work.owner_id) !== String(binding.executor_id));
  const ownWorks = works.filter((work) => String(work.owner_id) === String(binding.executor_id));
  const undatedAllowed =
    !binding.released_at && bindings.filter((row) => row.used_at).length === 1 && foreign.length === 0;
  const compositionSources = ownWorks.map((work) => compositionSource(work, binding, undatedAllowed));
  const evidenceSources = evidence.map((record) => {
    if (foreign.some((work) => work.promo_url === record.work_url))
      return sourceResult(
        'evidence',
        record.id,
        'WORK_OWNERSHIP_CONFLICT',
        '这个作品地址属于其他执行人，运营需核实原作品归属',
      );
    if (record.status === 'rejected')
      return sourceResult('evidence', record.id, 'WORK_REJECTED', '作品已有明确退回记录，需先补正');
    if (!publicWorkUrl(record.work_url))
      return sourceResult('evidence', record.id, 'WORK_SOURCE_INVALID', '作品地址不完整，需补充实际链接');
    const linkedProblem = ownWorks
      .map((work, index) => ({ work, source: compositionSources[index] }))
      .find(({ work, source }) => work.promo_url === record.work_url && source.status === 'blocked');
    if (linkedProblem) return { ...linkedProblem.source, kind: 'evidence' as const, id: String(record.id) };
    return sourceResult('evidence', record.id);
  });
  const result: WorkReviewItem = {
    keywordId: String(binding.keyword_id),
    bindingId: String(binding.id),
    executorId: binding.executor_id == null ? null : String(binding.executor_id),
    previousStatus: String(binding.verification_status),
    status: 'blocked',
    reason: '',
    reasonCode: '',
    evidenceIds: [],
    compositionIds: [],
    sources: [...evidenceSources, ...compositionSources],
    changed: false,
  };
  const blocked = (reasonCode: string, reason: string) => ({
    ...result,
    reasonCode,
    reason,
    sources: result.sources.map((source) =>
      source.status === 'blocked' ? source : { ...source, status: 'blocked' as const, reasonCode, reason },
    ),
  });
  if (binding.verification_status === 'disputed') return blocked('WORK_DISPUTED', '作品存在争议，运营需先核实归属');
  if (!['pending', 'passed'].includes(String(binding.verification_status)))
    return blocked('WORK_REJECTED', '作品已有明确退回记录，运营需先处理退回原因');
  if (!binding.executor_id || !binding.used_at || !binding.from_day)
    return blocked('WORK_PERIOD_MISSING', '执行人或使用日期不完整，运营需补齐原执行记录');
  if (!binding.released_at && String(binding.current_binding_id) !== String(binding.id))
    return blocked('WORK_OWNERSHIP_CONFLICT', '执行归属记录不一致，运营需核实原执行人');

  // An explicit human resolution remains evidence of ownership. It never
  // overrides a later failure or rejection on that same registered work.
  const manualEvidence = evidence.filter(
    (record, index) =>
      record.status === 'passed' && record.reviewed_by != null && evidenceSources[index].status === 'ready',
  );
  const manualWork = ownWorks.some(
    (work, index) => manuallyReviewed(work, binding) && compositionSources[index].status === 'ready',
  );
  const unhandledRejection = evidence.some(
    (record) =>
      record.status === 'rejected' &&
      !manualEvidence.some((accepted) =>
        accepted.review_order && record.review_order
          ? BigInt(String(accepted.review_order)) > BigInt(String(record.review_order))
          : accepted.reviewed_time &&
            record.reviewed_time &&
            String(accepted.reviewed_time) > String(record.reviewed_time),
      ),
  );
  if (unhandledRejection) return blocked('WORK_REJECTED', '作品已有明确退回记录，运营需先处理退回原因');
  const overlap = bindings.some(
    (other) =>
      String(other.id) !== String(binding.id) &&
      other.used_at &&
      (!other.from_day ||
        ((!binding.until_time || String(other.from_day) < String(binding.until_time)) &&
          (!other.until_time || String(binding.from_day) < String(other.until_time)))),
  );
  if (
    !manualWork &&
    !manualEvidence.length &&
    (overlap || foreign.some((work) => !work.published_at || withinExecution(work, binding)))
  )
    return blocked('WORK_OWNERSHIP_CONFLICT', '作品执行人或使用日期有重叠，运营需核实原作品归属');

  result.evidenceIds = evidenceSources.filter((source) => source.status === 'ready').map((source) => source.id);
  result.compositionIds = compositionSources.filter((source) => source.status === 'ready').map((source) => source.id);
  if (result.evidenceIds.length || result.compositionIds.length) {
    const pendingEvidence = evidence.some(
      (record) => record.status === 'pending' && result.evidenceIds.includes(String(record.id)),
    );
    return {
      ...result,
      status: binding.verification_status === 'passed' && !pendingEvidence ? 'unchanged' : 'ready',
      reason: '已登记作品，按平台默认通过规则处理',
    };
  }
  // Older explicit approvals can predate URL storage. Only retain that existing
  // decision when there is no contrary source and no default-policy provenance.
  if (!result.sources.length && binding.verification_status === 'passed' && !Number(binding.default_reviewed))
    return { ...result, status: 'unchanged', reason: '保留已有审核结果' };
  const problem =
    result.sources.find(
      (source) => source.reasonCode === 'WORK_REJECTED' || source.reasonCode === 'WORK_SUBMISSION_FAILED',
    ) ?? result.sources.find((source) => source.status === 'blocked');
  return blocked(
    problem?.reasonCode ?? 'WORK_MISSING',
    problem?.reason ?? '尚无这位执行人的作品，请由执行人登记实际作品',
  );
}

/** Callers hold scopeLock for writes. Preview and application share this exact
 * decision path, using saved ownership and periods rather than today's team. */
export async function reconcileWorkReview(c: PoolConnection, scope: Scope, keywordId: string, options: ReviewOptions) {
  const lock = options.apply || options.lock ? ' FOR UPDATE' : '';
  const bindings = await select(
    c,
    `SELECT b.*,k.current_binding_id,
    DATE_FORMAT(b.activated_on,'%Y-%m-%d') from_day,
    DATE_FORMAT(b.released_at,'%Y-%m-%d %H:%i:%s.%f') until_time
    FROM zh_keyword_bindings b JOIN zh_keywords k ON k.id=b.keyword_id
    WHERE k.id=? AND k.account_id=? AND k.project_id=? ORDER BY b.id${lock}`,
    [keywordId, scope.accountId, scope.projectId],
  );
  if (!bindings.length) return [];
  const evidence = await select(
    c,
    `SELECT e.*,DATE_FORMAT(e.reviewed_at,'%Y-%m-%d %H:%i:%s.%f') reviewed_time FROM zh_evidence e
    JOIN zh_keyword_bindings b ON b.id=e.binding_id JOIN zh_keywords k ON k.id=b.keyword_id
    WHERE k.id=? AND k.account_id=? AND k.project_id=? ORDER BY e.id${lock}`,
    [keywordId, scope.accountId, scope.projectId],
  );
  const works = await select(
    c,
    `SELECT co.*,DATE_FORMAT(co.release_time,'%Y-%m-%d %H:%i:%s.%f') published_at,
    (${submittedWorkSql}) has_receipt FROM compositions co JOIN zh_keywords k ON k.plan_id=co.plan_id
    JOIN plans p ON p.id=co.plan_id AND p.project_id=k.project_id
    WHERE k.id=? AND k.account_id=? AND k.project_id=? ORDER BY co.id${lock}`,
    [keywordId, scope.accountId, scope.projectId],
  );
  const reviews = await select(
    c,
    `SELECT wr.* FROM zh_work_review_records wr
    JOIN zh_keyword_bindings b ON b.id=wr.binding_id JOIN zh_keywords k ON k.id=b.keyword_id
    WHERE k.id=? AND k.account_id=? AND k.project_id=? ORDER BY wr.id${lock}`,
    [keywordId, scope.accountId, scope.projectId],
  );
  for (const binding of bindings)
    binding.default_reviewed = Number(
      reviews.some(
        (review) => String(review.binding_id) === String(binding.id) && review.policy === defaultWorkReviewPolicy,
      ),
    );
  for (const record of evidence)
    record.review_order = reviews
      .filter(
        (review) => String(review.evidence_id) === String(record.id) && review.policy === 'manual-evidence-review-v1',
      )
      .at(-1)?.id;
  for (const work of works)
    work.manually_reviewed_binding_ids = reviews
      .filter(
        (review) =>
          String(review.composition_id) === String(work.id) &&
          review.status === 'passed' &&
          ['manual-registered-work-v1', 'legacy-approved-v1'].includes(String(review.policy)),
      )
      .map((review) => String(review.binding_id));
  const decisions: WorkReviewItem[] = [];
  for (const binding of bindings) {
    const ownEvidence = evidence.filter((record) => String(record.binding_id) === String(binding.id));
    const item = decideReview(binding, bindings, works, ownEvidence);
    if (
      options.apply &&
      (item.status === 'ready' || (item.status === 'blocked' && binding.verification_status === 'passed'))
    ) {
      const nextStatus = item.status === 'ready' ? 'passed' : 'pending';
      const [updated] = await c.query<ResultSetHeader>(
        'UPDATE zh_keyword_bindings SET verification_status=?,version=version+1 WHERE id=? AND verification_status<>?',
        [nextStatus, binding.id, nextStatus],
      );
      let changedEvidence = 0;
      if (nextStatus === 'passed')
        for (const id of item.evidenceIds) {
          const [updatedEvidence] = await c.query<ResultSetHeader>(
            `UPDATE zh_evidence
          SET status='passed',reason='平台按作品默认通过规则处理',reviewed_by=NULL,reviewed_at=NOW(3)
          WHERE id=? AND binding_id=? AND status='pending'`,
            [id, binding.id],
          );
          changedEvidence += updatedEvidence.affectedRows;
        }
      item.changed = updated.affectedRows > 0 || changedEvidence > 0;
      if (nextStatus === 'passed') item.status = 'applied';
      if (item.changed)
        await recordWorkReview(c, item.bindingId, defaultWorkReviewPolicy, nextStatus, {
          userId: null,
          action: nextStatus === 'passed' ? 'zhihu.work.default-review' : 'zhihu.work.review-blocked',
          resourceType: 'zh_attribution',
          resourceId: item.bindingId,
          detail: {
            policy: defaultWorkReviewPolicy,
            trigger: options.trigger,
            triggeredBy: options.actorId ?? null,
            ...scope,
            keywordId,
            bindingId: item.bindingId,
            executorId: item.executorId,
            previousStatus: item.previousStatus,
            status: nextStatus,
            fromDate: binding.from_day,
            until: binding.until_time,
            evidenceIds: item.evidenceIds,
            compositionIds: item.compositionIds,
            sources: item.sources,
            reasonCode: item.reasonCode,
            changedEvidence,
          },
        });
    }
    decisions.push(item);
  }
  return decisions;
}

export async function reconcileWorkReceipts(
  c: PoolConnection,
  scope: Scope,
  keywordId: string,
  trigger = 'report.attribution',
  actorId: string | null = null,
) {
  const decisions = await reconcileWorkReview(c, scope, keywordId, { apply: true, trigger, actorId });
  return decisions.some((item) => item.changed);
}

// Both financial projections must count the same registered works.
export const registeredWorkSql = `(EXISTS(SELECT 1 FROM zh_evidence ev WHERE ev.binding_id=b.id)
  OR EXISTS(SELECT 1 FROM compositions co JOIN zh_keywords wk ON wk.plan_id=co.plan_id
    WHERE wk.id=b.keyword_id AND co.owner_id=b.executor_id))`;

// Add the platform decision alongside untouched upstream fields in work APIs.
export const compositionVerificationSql = `(SELECT b.verification_status
  FROM zh_keywords wk JOIN zh_keyword_bindings b ON b.keyword_id=wk.id
  WHERE wk.plan_id=c.plan_id AND b.executor_id=c.owner_id AND b.used_at IS NOT NULL
    AND ((c.release_time IS NOT NULL AND DATE(c.release_time)>=b.activated_on
      AND (b.released_at IS NULL OR c.release_time<b.released_at))
      OR (c.release_time IS NULL AND b.id=wk.current_binding_id AND b.released_at IS NULL)
      OR EXISTS(SELECT 1 FROM zh_work_review_records wr WHERE wr.binding_id=b.id AND wr.composition_id=c.id
        AND wr.status='passed' AND wr.policy IN ('manual-registered-work-v1','legacy-approved-v1')))
  ORDER BY b.id DESC LIMIT 1)`;
