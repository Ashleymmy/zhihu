import type { PoolConnection } from 'mysql2/promise';
import { fail } from './domain';
import { select } from './store';
import { submissionFailure } from '../services/submission-feedback';

// A missing current value alone does not prove an old record was cancelled.
// Only disregard it when every recorded upload source was explicitly withdrawn.
export const retainedReportFactSql = (f='f') => `(${f}.current_revision_id IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM zh_import_rows ir WHERE ir.fact_id=${f}.id)
 OR EXISTS(SELECT 1 FROM zh_import_rows ir JOIN zh_import_batches ib ON ib.id=ir.batch_id WHERE ir.fact_id=${f}.id AND ib.status<>'withdrawn'))`;

export const unconfirmedFactSql = (f='f') => `${retainedReportFactSql(f)} AND NOT EXISTS(SELECT 1 FROM zh_statement_entries se WHERE se.fact_id=${f}.id AND se.status='confirmed')
 AND NOT EXISTS(SELECT 1 FROM opc_income_sources ins WHERE ins.module_id='zhihu' AND ins.account_id=${f}.account_id AND ins.source_key=CONCAT('fact:',${f}.id))`;

// A local reservation is exclusive, but is not permission to publish or assign.
export function readyPlanSql(p = 'p', k = 'k', lock = '') {
  return `(${p}.status='active' AND (
    (${p}.sync_status='synced' AND NULLIF(TRIM(${p}.zhihu_plan_id),'') IS NOT NULL)
    OR (${p}.sync_status='simulated' AND ${k}.upstream_status='simulated' AND EXISTS(
      SELECT 1 FROM zhihu_account_settings ks WHERE ks.project_id=${k}.project_id AND ks.account_id=${k}.account_id
      AND JSON_UNQUOTE(JSON_EXTRACT(ks.config_json,'$.mode'))='simulation'${lock}))))`;
}

// Never recycle a used word, even if an old import left its lifecycle incorrect.
export function unusedKeywordSql(k = 'k', lock = '') {
  return `(${k}.used_ever_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM zh_keyword_bindings ub WHERE ub.keyword_id=${k}.id AND ub.used_at IS NOT NULL${lock})
    AND NOT EXISTS(SELECT 1 FROM compositions uc WHERE uc.plan_id=${k}.plan_id${lock})
    AND NOT EXISTS(SELECT 1 FROM zh_evidence ue JOIN zh_keyword_bindings eb ON eb.id=ue.binding_id WHERE eb.keyword_id=${k}.id${lock})
    AND NOT EXISTS(SELECT 1 FROM zh_metric_facts uf WHERE uf.keyword_id=${k}.id AND ${retainedReportFactSql('uf')}${lock})
    AND NOT EXISTS(SELECT 1 FROM daily_metrics um WHERE um.plan_id=${k}.plan_id${lock})
    AND NOT EXISTS(SELECT 1 FROM earnings un WHERE un.plan_id=${k}.plan_id${lock}))`;
}

// Report facts alone identify performance, not an executor. They must not lock
// an otherwise unowned keyword into the historical-owner view.
export function ownershipHistorySql(k='k') {
  return `(EXISTS(SELECT 1 FROM zh_keyword_bindings ob WHERE ob.keyword_id=${k}.id AND ob.executor_id IS NOT NULL)
    OR EXISTS(SELECT 1 FROM compositions oc WHERE oc.plan_id=${k}.plan_id)
    OR EXISTS(SELECT 1 FROM zh_evidence oe JOIN zh_keyword_bindings eb ON eb.id=oe.binding_id WHERE eb.keyword_id=${k}.id)
    OR EXISTS(SELECT 1 FROM daily_metrics om WHERE om.plan_id=${k}.plan_id)
    OR EXISTS(SELECT 1 FROM earnings onw WHERE onw.plan_id=${k}.plan_id))`;
}

export function ownershipConflictSql(k = 'k', b = 'b', lock = '') {
  return `EXISTS(SELECT 1 FROM compositions oc WHERE oc.plan_id=${k}.plan_id AND ${b}.executor_id IS NOT NULL AND oc.owner_id<>${b}.executor_id${lock})`;
}

export function keywordFailureMessage(error: unknown) {
  return submissionFailure(error, 'keyword');
}

export async function assertKeywordReady(c: PoolConnection, keywordId: string) {
  const [p] = await select(c, `SELECT p.sync_status,p.sync_error,${readyPlanSql('p','k',' FOR SHARE')} AS ready,${ownershipConflictSql('k','b',' FOR SHARE')} AS ownership_conflict
    FROM zh_keywords k JOIN plans p ON p.id=k.plan_id AND p.project_id=k.project_id
    LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id
    WHERE k.id=? FOR SHARE`, [keywordId]);
  if (!p || !Number(p.ready)) fail(p?.sync_status === 'failed' ? keywordFailureMessage(p.sync_error)
    : '关键词尚未就绪：请等待知乎创建成功，暂不可分配或登记作品', 409);
  if (Number(p.ownership_conflict)) fail('关键词历史作品归属与当前使用人不一致，请联系管理员核对，暂不可新增使用',409);
}

export async function assertKeywordUnused(c: PoolConnection, keywordId: string) {
  const [row] = await select(c, `SELECT ${unusedKeywordSql('k', ' FOR SHARE')} AS unused
    FROM zh_keywords k WHERE k.id=? FOR UPDATE`, [keywordId]);
  if (!row || !Number(row.unused)) fail('关键词已有作品或使用记录，必须保留原归属，不可重新分配或释放', 409);
}

export async function assertNoLiveBinding(c: PoolConnection, keywordId: string) {
  const live = await select(c, 'SELECT id FROM zh_keyword_bindings WHERE keyword_id=? AND released_at IS NULL LIMIT 1 FOR UPDATE', [keywordId]);
  if (live.length) fail('关键词已有独占使用人，不可重复领取或分发', 409);
}
