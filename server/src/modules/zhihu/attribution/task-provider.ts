import { z } from 'zod';
import type { AuthUser } from '../../../types';
import { isStaffRole } from '../../../auth/roles';
import { dutyAllows } from '../../../core/duties';
import type { ModuleTaskProvider, TaskAction, TaskDetail, TaskItem, TaskScope } from '../../../core/contracts';
import { withTransaction } from '../../../db';
import { AppError } from '../../../middleware/errors';
import { select, type RecordRow } from './store';
import { businessDay, money, moneyText } from './domain';
import { quote } from './pricing';
import { quoteActivation } from './activation-pricing';
import * as resources from './resources';
import { assignRetro } from './retro-assignment';
import { submitEvidence, reviewEvidence, disputeBinding } from './statements';
import { scopeFilter } from '../../../utils/scopeFilter';
import { submissionFailure } from '../services/submission-feedback';

const link = (path: string, scope: TaskScope, extra: Record<string, string> = {}) =>
  path + '?' + new URLSearchParams({ ...scope, ...extra }).toString();
type Options = Awaited<ReturnType<typeof resources.options>>;
function person(user: AuthUser, options: Options, id: unknown) {
  return String(id) === user.sub
    ? user.displayName
    : String(options.users.find((u) => String(u.id) === String(id))?.display_name ?? '项目成员');
}
function editableFields(word: RecordRow, options: Options): NonNullable<TaskAction['fields']> {
  return [
    { key: 'keyword', label: '关键词', type: 'text', required: true, value: String(word.keyword) },
    {
      key: 'taskId',
      label: '推广活动',
      type: 'select',
      required: true,
      value: String(word.task_id ?? ''),
      options: options.tasks.map((t) => ({ value: String(t.id), label: String(t.name) })),
    },
    {
      key: 'mappingId',
      label: '渠道',
      type: 'select',
      required: true,
      value: String(word.mapping_id ?? ''),
      options: options.mappings.map((m) => ({ value: String(m.id), label: String(m.channel_name) })),
    },
    { key: 'landingUrl', label: '小说原文链接', type: 'url', required: true, value: String(word.landing_url ?? '') },
    { key: 'novelTitle', label: '小说原名', type: 'text', value: String(word.novel_title ?? '') },
    { key: 'novelUrl', label: '原文备用链接', type: 'url', value: String(word.novel_url_override ?? '') },
  ];
}
function actions(word: RecordRow, user: AuthUser, scope: TaskScope, options: Options): TaskAction[] {
  const result: TaskAction[] = [],
    id = String(word.id),
    staff = isStaffRole(user.role);
  if (
    word.legacy_mode === 'historical_registered' &&
    word.binding_id &&
    word.used_ever_at &&
    word.verification_status !== 'passed' &&
    !word.released_at &&
    !word.stop_new_use_at &&
    word.release_status !== 'requested'
  ) {
    if (word.verification_status === 'disputed') {
      if (staff)
        result.push({
          key: 'history-resolve',
          label: '核实作品争议',
          fields: [{ key: 'reason', label: '核实结果', type: 'textarea', required: true }],
        });
    } else if (word.evidence_status === 'pending') {
      if (
        staff ||
        (user.role === 'leader' && String(word.leader_id) === user.sub && String(word.executor_id) !== user.sub)
      ) {
        result.push({ key: 'history-accept', label: '历史作品核验通过' });
        result.push({
          key: 'history-return',
          label: '退回补充历史作品',
          fields: [{ key: 'reason', label: '哪里需要补充', type: 'textarea', required: true }],
        });
      }
    } else if (
      word.plan_status === 'active' &&
      (staff || String(word.executor_id) === user.sub || String(word.leader_id) === user.sub)
    )
      result.push({
        key: 'history-submit',
        label: '补登记历史作品',
        fields: [
          { key: 'url', label: '作品链接', type: 'url', required: true, value: String(word.evidence_url || '') },
          {
            key: 'description',
            label: '作品说明',
            type: 'textarea',
            required: true,
            value: String(word.evidence_description || ''),
          },
        ],
      });
  }
  if (Number(word.can_edit_failed))
    result.push({ key: 'edit-retry', label: '修改并重试', fields: editableFields(word, options) });
  if (Number(word.can_copy_failed))
    result.push({ key: 'copy-retry', label: '沿用信息新建', fields: editableFields(word, options) });
  if (
    Number(word.allocation_ready) &&
    !staff &&
    (user.role === 'leader' || (!options.hasTeamLeader && Number(word.priority_ended)))
  )
    result.push({ key: 'claim', label: '领取任务' });
  if (Number(word.allocation_ready) && staff)
    result.push({key:'claim',label:'我来执行'});
  if (Number(word.allocation_ready) && staff)
    result.push({
      key: 'distribute',
      label: '分发任务',
      fields: [
        {
          key: 'targetId',
          label: '成员',
          type: 'select',
          required: true,
          options: options.users
            .filter((u) => ['leader', 'creator'].includes(String(u.role)) || String(u.id)===user.sub)
            .map((u) => ({
              value: String(u.id),
              label: String(u.display_name) + (isStaffRole(String(u.role)) ? ' · 本人执行' : u.role === 'leader' ? ' · 团长' : ' · 达人'),
            })),
        },
      ],
    });
  if (
    Number(word.usage_ready) &&
    word.binding_id &&
    !word.used_ever_at &&
    !Number(word.has_usage_history) &&
    word.leader_id &&
    (staff || String(word.leader_id) === user.sub)
  )
    result.push({
      key: 'assign',
      label: '分配执行人',
      fields: [
        {
          key: 'executorId',
          label: '执行人',
          type: 'select',
          required: true,
          value: String(word.executor_id ?? ''),
          options: options.users
            .filter(
              (u) =>
                String(u.id) === String(word.leader_id) ||
                (u.role === 'creator' && String(u.parent_id) === String(word.leader_id)),
            )
            .map((u) => ({ value: String(u.id), label: String(u.display_name) })),
        },
      ],
    });
  if (
    Number(word.usage_ready) &&
    String(word.executor_id) === user.sub &&
    ['synced', 'simulated'].includes(String(word.sync_status))
  )
    result.push({
      key: 'submit-work',
      label: word.used_ever_at ? '补充作品' : '提交作品',
      path: link('/modules/zhihu/works/new', scope, { planId: String(word.plan_id), keyword: String(word.keyword) }),
    });
  if (Number(word.composition_count))
    result.push({
      key: 'works',
      label: '查看作品',
      path: link('/modules/zhihu/works', scope, { planId: String(word.plan_id), keyword: String(word.keyword) }),
    });
  if (Number(word.can_assign_retro) && word.retro_from_date)
    result.push({
      key: 'resolve-owner',
      label: '指定执行人',
      fields: [
        {
          key: 'executorId',
          label: '执行人',
          type: 'select',
          required: true,
          options: options.users
            .filter((u) => ['leader', 'creator'].includes(String(u.role)) || String(u.id)===user.sub)
            .map((u) => ({ value: String(u.id), label: String(u.display_name) })),
        },
      ],
    });
  if (Number(word.can_edit_novel))
    result.push({
      key: 'novel',
      label: '编辑小说资料',
      fields: [
        { key: 'title', label: '小说原名', type: 'text', value: String(word.novel_title ?? '') },
        { key: 'url', label: '小说原文链接', type: 'url', value: String(word.novel_url ?? '') },
      ],
    });
  if (word.binding_id && !Number(word.read_only)) {
    if (!word.used_ever_at && !Number(word.has_usage_history) && word.release_status !== 'requested')
      result.push({
        key: 'request-release',
        label: '退回未使用任务',
        fields: [{ key: 'reason', label: '退回原因', type: 'textarea', required: true }],
        confirm: '请确认尚未用这个关键词发布作品。已使用的任务不能转给他人。',
      });
    if (staff && !Number(word.has_usage_history) && word.release_status === 'requested')
      result.push({
        key: 'release',
        label: '确认退回',
        fields: [{ key: 'reason', label: '核实说明', type: 'textarea', required: true }],
        confirm: '确认未使用后，任务会重新开放领取。',
      });
    if (word.used_ever_at && word.lifecycle_status !== 'retired')
      result.push({ key: 'stop', label: '停止新增使用', confirm: '停止后不能再新增作品，已有作品和原使用人仍保留。' });
  }
  if (Number(word.can_delete_failed))
    result.push({
      key: 'delete-failed',
      label: '删除错误记录',
      confirm: '从任务列表移除这条失败记录，已有作品和历史信息仍会保留。',
    });
  return result;
}
function taskItem(word: RecordRow, user: AuthUser, scope: TaskScope, options: Options): TaskItem {
  let status: TaskItem['status'] = { key: 'pending', label: '创建中', tone: 'warning' },
    actor = '系统',
    text = '等待创建结果';
  if (Number(word.ownership_conflict)) {
    status = { key: 'disputed', label: '归属待核对', tone: 'danger' };
    actor = '运营';
    text = '核对原使用人';
  } else if (
    ['retired', 'archived'].includes(String(word.lifecycle_status)) ||
    ['paused', 'ended'].includes(String(word.plan_status))
  ) {
    status = { key: 'retired', label: '已停用', tone: 'neutral' };
    text = '已有作品与原归属保留';
  } else if (word.sync_status === 'failed') {
    status = { key: 'failed', label: '创建失败', tone: 'danger' };
    actor = '创建人';
    text = String(word.sync_error || '修改关键词后重试');
  } else if (word.retro_from_date && !word.executor_id) {
    status = { key: 'unassigned', label: '没有执行人', tone: 'warning' };
    actor = '运营';
    text = '指定实际执行人，自动继续计算业绩';
  } else if (Number(word.allocation_ready)) {
    status = { key: 'available', label: '可领取', tone: 'success' };
    actor = '本人';
    text = '领取后开始创作';
  } else if (word.release_status === 'requested') {
    status = { key: 'returning', label: '退回待核实', tone: 'warning' };
    actor = '运营';
    text = '核实关键词尚未使用';
  } else if (Number(word.failed_work_count)) {
    status = { key: 'work-failed', label: '作品提交失败', tone: 'danger' };
    actor = String(word.executor_name || '提交人');
    text = String(word.work_failure || '修改作品后重新提交');
  } else if (word.path_type === 'reserved') {
    status = { key: 'reserved', label: '待分配', tone: 'leader' };
    actor = person(user, options, word.leader_id);
    text = '分配执行人';
  } else if (
    word.legacy_mode === 'historical_registered' &&
    word.executor_id &&
    word.verification_status !== 'passed'
  ) {
    const pending = word.evidence_status === 'pending';
    status = {
      key: 'historical-work',
      label: word.verification_status === 'disputed' ? '历史作品有争议' : pending ? '历史作品待核验' : '历史作品待补充',
      tone: 'warning',
    };
    actor =
      word.verification_status === 'disputed'
        ? '运营'
        : pending
          ? '团长或运营'
          : String(word.executor_name || '执行人');
    text =
      word.verification_status === 'disputed'
        ? '核实历史作品归属'
        : pending
          ? '核验已登记的历史作品'
          : String(word.evidence_reason || '补登记已发布的作品链接');
  } else if (word.verification_status === 'disputed') {
    status = { key: 'disputed', label: '作品待核对', tone: 'danger' };
    actor = '运营';
    text = '查看作品问题';
  } else if (word.executor_id && !Number(word.composition_count)) {
    status = { key: 'assigned', label: '待交作品', tone: 'warning' };
    actor = person(user, options, word.executor_id);
    text = '提交作品链接';
  } else if (Number(word.composition_count) && word.verification_status === 'passed') {
    status = { key: 'active', label: '生效中', tone: 'success' };
    actor = '系统';
    text = '持续汇总业绩';
  } else if (Number(word.composition_count)) {
    status = { key: 'checking', label: '作品审核中', tone: 'warning' };
    actor = '系统';
    text = '等待作品提交与审核结果';
  } else if (word.sync_status === 'historical' || Number(word.read_only)) {
    status = { key: 'historical', label: '历史任务', tone: 'neutral' };
    actor = '运营';
    text = '保留原作品和使用人';
  }
  const available = actions(word, user, scope, options);
  const preferred =
    status.key === 'work-failed'
      ? ['works']
      : word.executor_id
        ? ['edit-retry', 'copy-retry', 'submit-work', 'works', 'release']
        : ['edit-retry', 'copy-retry', 'resolve-owner', 'claim', 'distribute', 'assign', 'release'];
  const primary =
    ['history-resolve', 'history-submit', 'history-accept']
      .map((key) => available.find((a) => a.key === key))
      .find(Boolean) ?? preferred.map((key) => available.find((a) => a.key === key)).find(Boolean);
  return {
    id: String(word.id),
    title: String(word.keyword),
    subtitle: String(word.novel_title ?? ''),
    status,
    executor: word.executor_id ? String(word.executor_name || person(user, options, word.executor_id)) : '待分配',
    leader: word.leader_id ? String(word.leader_name || person(user, options, word.leader_id)) : undefined,
    next: { actor, text, ...(primary ? { action: primary } : {}) },
    metrics: [
      { label: '已交作品', value: String(word.composition_count ?? 0) + ' 篇' },
      ...(Array.isArray(word.task_rules) ? word.task_rules : []),
    ],
  };
}
async function one(scope: TaskScope, user: AuthUser, id: string) {
  const result = await resources.listKeywords(user, scope, 1, 1, '', 'all', id),
    word = result.list[0];
  if (!word) throw new AppError(404, 40401, '任务不存在或不在你的查看范围');
  await enrichWorks(user, [word]);
  await enrichRules(scope, user, [word]);
  return word;
}
// Enrich only the already authorized task IDs, retaining the work-level role scope.
async function enrichWorks(user: AuthUser, words: RecordRow[]) {
  if (!words.length) return;
  const visible = scopeFilter(user, 'cw.owner_id');
  const rows = await withTransaction((c) =>
    select(
      c,
      `SELECT CAST(p.id AS CHAR) plan_id,k.legacy_mode,ex.display_name executor_name,ld.display_name leader_name,
    CAST(e.id AS CHAR) evidence_id,e.status evidence_status,e.work_url evidence_url,e.description evidence_description,e.reason evidence_reason,
    (SELECT COUNT(*) FROM compositions cw WHERE cw.plan_id=p.id AND cw.sync_status='failed' AND ${visible.clause}) failed_work_count,
    (SELECT cw.sync_error FROM compositions cw WHERE cw.plan_id=p.id AND cw.sync_status='failed' AND ${visible.clause} ORDER BY cw.id DESC LIMIT 1) work_failure,
    (SELECT COUNT(*) FROM zh_evidence ev JOIN zh_keyword_bindings eb ON eb.id=ev.binding_id
      WHERE eb.keyword_id=k.id AND (?=1 OR eb.executor_id=? OR eb.leader_id=?)
      AND NOT EXISTS(SELECT 1 FROM compositions linked WHERE linked.plan_id=p.id AND linked.owner_id=eb.executor_id AND BINARY linked.promo_url=BINARY ev.work_url)) evidence_only_count
    FROM plans p LEFT JOIN zh_keywords k ON k.plan_id=p.id LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id
    LEFT JOIN users ex ON ex.id=b.executor_id LEFT JOIN users ld ON ld.id=b.leader_id
    LEFT JOIN zh_evidence e ON e.id=(SELECT MAX(ev.id) FROM zh_evidence ev WHERE ev.binding_id=b.id)
      AND (?=1 OR b.leader_id=? OR b.executor_id=?) WHERE p.id IN (?)`,
      [
        ...visible.bindings,
        ...visible.bindings,
        Number(isStaffRole(user.role)),
        user.sub,
        user.sub,
        Number(isStaffRole(user.role)),
        user.sub,
        user.sub,
        words.map((w) => String(w.plan_id)),
      ],
    ),
  );
  for (const word of words) {
    const stats = rows.find((row) => String(row.plan_id) === String(word.plan_id));
    if (stats) {
      Object.assign(word, stats);
      word.composition_count = Number(word.composition_count) + Number(stats.evidence_only_count);
      word.work_failure = submissionFailure(stats.work_failure, 'composition');
    }
  }
}
async function enrichRules(scope: TaskScope, user: AuthUser, words: RecordRow[]) {
  if (isStaffRole(user.role)) return;
  await withTransaction(async (c) => {
    const cache = new Map<string, { label: string; value: string }[]>();
    for (const word of words) {
      const rules: { label: string; value: string }[] = [];
      if (Number(word.allocation_ready))
        rules.push({
          label: '领取规则',
          value: Number(word.priority_ended) ? '团长、独立达人可领取' : '创建后 30 分钟内团长优先',
        });
      if (!word.task_id) {
        word.task_rules = rules;
        continue;
      }
      const mine = String(word.executor_id) === user.sub || String(word.leader_id) === user.sub;
      if (!mine && !Number(word.allocation_ready)) {
        word.task_rules = rules;
        continue;
      }
      const binding: RecordRow =
        mine && word.path_type !== 'reserved'
          ? word
          : {
              ...word,
              path_type: user.role === 'leader' ? 'leader_self' : 'direct_creator',
              leader_id: user.role === 'leader' ? user.sub : null,
              executor_id: user.sub,
            };
      const cacheKey = [word.task_id, binding.path_type, binding.leader_id, binding.executor_id].join(':');
      let prices = cache.get(cacheKey);
      if (!prices) {
        prices = [];
        for (const type of ['new_user', 'activation'] as const) {
          try {
            const obligations =
              type === 'new_user'
                ? await quote(c, scope, String(word.task_id), binding, businessDay(), '1')
                : (await quoteActivation(c, scope, binding, businessDay(), '1', null)).obligations;
            const own = obligations.find((o) => o.payeeId === user.sub);
            if (own) {
              const value = money(own.unitPrice);
              if (value < 0n) throw new AppError(409, 40901, 'PRICE_CONFLICT');
              prices.push({
                label:
                  (type === 'activation' ? '当前拉活' : '当前拉新') +
                  (binding.path_type === 'team_creator' && user.role === 'leader' ? '分成' : '单价'),
                value: moneyText(value) + ' 元/' + (type === 'activation' ? '个' : '单'),
              });
            }
          } catch (error) {
            if (
              error instanceof Error &&
              ['PRICE_MISSING', 'PRICE_OVERLAP', 'PRICE_CONFLICT', 'RATE_OVERLAP'].includes(error.message)
            )
              prices.push({ label: type === 'activation' ? '当前拉活单价' : '当前拉新单价', value: '待财务完善' });
            else throw error;
          }
        }
        cache.set(cacheKey, prices);
      }
      word.task_rules = [...rules, ...prices];
    }
  });
}
async function metrics(scope: TaskScope, user: AuthUser, words: RecordRow[]) {
  const ids = words.filter((w) => w.keyword_id).map((w) => String(w.keyword_id));
  if (!ids.length) return [];
  const today = businessDay();
  return withTransaction((c) =>
    select(
      c,
      `SELECT CAST(f.keyword_id AS CHAR) keyword_id,f.metric_type,
    CAST(COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.snapshot_json,IF(f.metric_type='activation','$.activations','$.orders'))) AS UNSIGNED)),0) AS CHAR) quantity
    FROM zh_metric_facts f JOIN zh_metric_revisions v ON v.id=f.current_revision_id
    JOIN zh_keywords k ON k.id=f.keyword_id LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id
    WHERE f.account_id=? AND f.project_id=? AND f.keyword_id IN (?) AND f.business_date BETWEEN ? AND ?
      AND (?=1 OR b.executor_id=? OR b.leader_id=?) GROUP BY f.keyword_id,f.metric_type`,
      [
        scope.accountId,
        scope.projectId,
        ids,
        today.slice(0, 8) + '01',
        today,
        Number(isStaffRole(user.role)),
        user.sub,
        user.sub,
      ],
    ),
  );
}
export const zhihuTaskProvider: ModuleTaskProvider = {
  async list(scope, user, filter) {
    const result = await resources.listKeywords(user, scope, filter.page, filter.pageSize, filter.search, filter.view, undefined, filter.attention),
      config = await resources.options(user, scope),
      amounts = await metrics(scope, user, result.list);
    await enrichWorks(user, result.list);
    await enrichRules(scope, user, result.list);
    return {
      list: result.list.map((word) => {
        const item = taskItem(word, user, scope, config);
        for (const m of amounts.filter((m) => String(m.keyword_id) === String(word.keyword_id)))
          item.metrics.push({
            label: m.metric_type === 'activation' ? '本月拉活' : '本月拉新',
            value: String(m.quantity) + (m.metric_type === 'activation' ? ' 个' : ' 单'),
          });
        return item;
      }),
      total: result.total,
      create: { label: '创建关键词', path: link('/modules/zhihu/operations', scope, { create: '1' }) },
    };
  },
  async detail(scope, user, id) {
    const word = await one(scope, user, id),
      config = await resources.options(user, scope),
      item = taskItem(word, user, scope, config);
    const financial = !isStaffRole(user.role) || dutyAllows(user, 'finance'),internal=word.path_type==='staff_self';
    const state = word.keyword_id
      ? await withTransaction(async (c) => {
          const [data] = await select(
            c,
            `SELECT COUNT(*) reported,COALESCE(SUM(JSON_LENGTH(JSON_EXTRACT(r.snapshot_json,'$.obligations'))>0),0) calculated,
        COALESCE(SUM(?=1 AND EXISTS(SELECT 1 FROM zh_statement_entries e WHERE e.fact_id=f.id AND e.result_id=f.current_result_id AND e.revision_id=f.current_revision_id AND e.status='confirmed' AND (?=1 OR e.payee_id=?))),0) confirmed
        FROM zh_metric_facts f LEFT JOIN zh_attribution_results r ON r.id=f.current_result_id
        JOIN zh_keywords k ON k.id=f.keyword_id LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id
        WHERE f.current_revision_id IS NOT NULL AND f.keyword_id=? AND f.account_id=? AND f.project_id=? AND (?=1 OR b.executor_id=? OR b.leader_id=?)`,
            [
              Number(financial),
              Number(isStaffRole(user.role)),
              user.sub,
              word.keyword_id,
              scope.accountId,
              scope.projectId,
              Number(isStaffRole(user.role)),
              user.sub,
              user.sub,
            ],
          );
          let available = false;
          if (!isStaffRole(user.role) || dutyAllows(user, 'finance')) {
            const [funds] = await select(
              c,
              `SELECT COUNT(*) total FROM opc_income_entries e JOIN opc_income_sources src ON src.id=e.source_id
          JOIN zh_metric_facts f ON src.source_key=CONCAT('fact:',f.id) AND src.account_id=f.account_id AND src.project_id=f.project_id
          WHERE src.module_id='zhihu' AND f.keyword_id=? AND f.account_id=? AND f.project_id=? AND e.user_id=? AND e.availability='available' AND src.blocked_reason IS NULL`,
              [word.keyword_id, scope.accountId, scope.projectId, user.sub],
            );
            available = Number(funds.total) > 0;
          }
          return {
            reported: Number(data.reported),
            calculated: Number(data.calculated),
            confirmed: Number(data.confirmed),
            available,
          };
        })
      : { reported: 0, calculated: 0, confirmed: 0, available: false };
    const done = [
      !!word.binding_id || state.reported > 0,
      !!word.executor_id,
      Number(word.composition_count) > 0 &&
        !(word.legacy_mode === 'historical_registered' && word.evidence_status === 'rejected'),
      word.verification_status === 'passed' && !Number(word.failed_work_count),
      state.reported > 0,
      state.reported > 0 && state.calculated === state.reported,
      state.reported > 0 && state.confirmed === state.reported,
      state.available,
    ];
    const steps = ['领取', '分配', '交作品', '核验', '出业绩', '算钱', '确认', '可提现'],
      owners = [
        '本人',
        word.leader_id ? person(user, config, word.leader_id) : '运营',
        word.executor_id ? person(user, config, word.executor_id) : '执行人',
        word.legacy_mode === 'historical_registered' ? '团长或运营' : '系统',
        '系统',
        '系统',
        '财务',
        '本人',
      ];
    const current = done.findIndex((d) => !d);
    const descriptions = [
      item.status.key === 'failed' ? item.next.text : '领取任务后开始创作',
      '选择实际执行人',
      '发布作品后提交链接',
      Number(word.failed_work_count)
        ? String(word.work_failure)
        : word.legacy_mode === 'historical_registered'
          ? '核验补登记的历史作品'
          : '登记后自动检查并提交知乎，无需逐条人工审批',
      '等待平台同步或导入业绩报表',
      '按当前计费规则计算',
      '核对业绩后确认账单',
      '确认账单及资金到位后可提现',
    ];
    const detail: TaskDetail = {
      ...item,
      fields: [
        { label: '小说原名', value: String(word.novel_title || '尚未填写') },
        { label: '原文', value: '查看小说原文', url: String(word.novel_url || word.landing_url || '') },
        { label: '推广活动', value: String(word.task_name || '尚未填写') },
      ],
      progress: steps.slice(0, financial ? internal?6:8 : 5).map((label, index) => ({
        label:internal&&index===5?'记入管理员业绩':label,
        status: done[index] ? 'done' : index === current ? 'current' : 'waiting',
        actor: owners[index],
        description: internal&&index===5?'按单价记录本人业绩，不计入应付或提现':descriptions[index],
      })),
      actions: actions(word, user, scope, config),
    };
    if (word.evidence_url)
      detail.fields.push({ label: '已登记作品', value: '打开历史作品', url: String(word.evidence_url) });
    if (state.reported && financial)
      detail.actions.push({
        key: 'financial-progress',
        label: isStaffRole(user.role) ? '核对业绩账单' : '查看我的收益',
        path: link(isStaffRole(user.role) ? '/finance' : '/income', scope),
      });
    const counts = await metrics(scope, user, [word]);
    for (const m of counts)
      detail.metrics.push({
        label: m.metric_type === 'activation' ? '本月拉活' : '本月拉新',
        value: String(m.quantity) + (m.metric_type === 'activation' ? ' 个' : ' 单'),
      });
    return detail;
  },
  async execute(scope, user, id, action, input, key) {
    const word = await one(scope, user, id),
      config = await resources.options(user, scope);
    if (!actions(word, user, scope, config).some((a) => a.key === action && !a.path))
      throw new AppError(403, 40301, '当前任务不能执行此操作，请刷新查看');
    if (action === 'history-submit')
      await submitEvidence(user, scope, key, {
        ...z
          .object({ url: z.string().url().max(1024), description: z.string().trim().min(1).max(500) })
          .strict()
          .parse(input),
        bindingId: String(word.binding_id),
      });
    else if (action === 'history-accept' || action === 'history-return')
      await reviewEvidence(
        user,
        scope,
        String(word.evidence_id),
        key,
        action === 'history-accept',
        action === 'history-accept' ? '已核对历史作品和执行人' : z.string().trim().min(1).max(500).parse(input.reason),
      );
    else if (action === 'history-resolve')
      await disputeBinding(
        user,
        scope,
        String(word.binding_id),
        key,
        true,
        z.string().trim().min(1).max(500).parse(input.reason),
      );
    else if (action === 'resolve-owner')
      await assignRetro(
        user,
        scope,
        id,
        key,
        z
          .object({ executorId: z.string().regex(/^\d+$/) })
          .strict()
          .parse(input),
      );
    else if (action === 'claim') await resources.claim(user, scope, id, key);
    else if (action === 'distribute')
      await resources.distribute(user, scope, id, key, z.string().regex(/^\d+$/).parse(input.targetId));
    else if (['assign', 'request-release', 'release', 'stop'].includes(action)) {
      const value = z
        .object({ executorId: z.string().regex(/^\d+$/).optional(), reason: z.string().trim().max(500).optional() })
        .strict()
        .parse(input);
      await resources.changeBinding(user, scope, String(word.binding_id), key, {
        ...value,
        action: action as 'assign' | 'request-release' | 'release' | 'stop',
      });
    } else if (action === 'novel')
      await resources.updateKeywordNovel(
        user,
        scope,
        id,
        key,
        z
          .object({ title: z.string().max(128), url: z.string().max(1024) })
          .strict()
          .parse(input),
      );
    else if (action === 'delete-failed') await resources.deleteFailedKeyword(user, scope, id, key);
    else if (action === 'edit-retry' || action === 'copy-retry') {
      const form = z
        .object({
          keyword: z.string().trim().min(1).max(128),
          taskId: z.string().regex(/^\d+$/),
          mappingId: z.string().regex(/^\d+$/),
          landingUrl: z.string().url().max(1024),
          novelTitle: z.string().max(128).default(''),
          novelUrl: z.string().max(1024).default(''),
        })
        .strict()
        .parse(input);
      const patch = {
        taskId: form.taskId,
        mappingId: form.mappingId,
        landingUrl: form.landingUrl,
        novel: { title: form.novelTitle, url: form.novelUrl },
      };
      if (action === 'edit-retry') await resources.editFailedKeyword(user, scope, id, key, form.keyword, patch);
      else await resources.copyFailedKeyword(user, scope, id, key, form.keyword, patch);
    }
    return {
      message:
        action === 'delete-failed'
          ? '错误记录已移除'
          : action === 'claim'
            ? '任务已领取'
            : action === 'assign'
              ? '执行人已更新'
              : '已保存，任务状态已更新',
    };
  },
};
