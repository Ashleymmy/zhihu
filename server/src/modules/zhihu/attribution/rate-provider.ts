import type { ModuleRateProvider } from '../../../core/contracts';
import { cash, cashText } from '../../../core/money';
import { AppError } from '../../../middleware/errors';
import { scopeLock, select } from './store';
import { assertEngineWritable } from './routing';
import { unconfirmedFactSql } from './keyword-usability';

const roleRules = [
  { code: 'creator', label: '达人单价', editable: true },
  { code: 'leader_self', label: '团长单价', editable: true },
  { code: 'leader_override', label: '团队分成', editable: false },
  { code: 'staff_self', label: '管理员业绩单价', editable: true },
];
export const zhihuRateProvider: ModuleRateProvider = {
  metrics: [
    {
      code: 'new_user',
      label: '拉新订单',
      unit: '单',
      rules: roleRules,
      note: '按执行人角色计价，团队分成为团长单价减去达人单价。已确认账目保留原单价。',
    },
    {
      code: 'activation',
      label: '拉活',
      unit: '个',
      rules: [...roleRules, { code: 'upstream', label: '上游结算单价', editable: false }],
      note: '团队分成为团长单价减去达人单价。管理员业绩不进入提现。',
    },
  ],
  async lock(c, user, projectId) {
    const accounts = await select(
      c,
      `SELECT pi.account_id FROM project_integrations pi JOIN integration_accounts a ON a.id=pi.account_id
      WHERE pi.project_id=? AND a.module_id='zhihu' AND a.status='active' ORDER BY pi.account_id`,
      [projectId],
    );
    for (const account of accounts) {
      const scope = { projectId, accountId: String(account.account_id) };
      await scopeLock(c, scope, user);
      await assertEngineWritable(c, scope);
    }
  },
  async prepare(_c, input) {
    const margin = cash(input.prices.leader_self) - cash(input.prices.creator);
    if (margin < 0n) throw new AppError(422, 42200, '团长单价不能低于达人单价，请调整后再发布');
    return { ...input.prices, leader_override: cashText(margin) };
  },
  async published(c, _user, input) {
    const facts = await select(
      c,
      `SELECT f.*,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day
      FROM zh_metric_facts f WHERE f.project_id=? AND f.metric_type=? AND f.business_date>=?
      AND ${unconfirmedFactSql()} ORDER BY f.account_id,f.id FOR UPDATE`,
      [input.projectId, input.metricType, input.effectiveFrom],
    );
    const { attribute } = await import('./facts');
    for (const fact of facts)
      await attribute(c, { projectId: input.projectId, accountId: String(fact.account_id) }, fact);
    return { recalculated: facts.length };
  },
};
