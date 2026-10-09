import { isStaffRole } from '../../../auth/roles';
import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../../../types';
import { withTransaction } from '../../../db';
import { audit, authorize, insert, mutate, scopeLock, select, type RecordRow } from './store';
import { businessDay, count, day, fail, money, moneyText, type Scope } from './domain';
import { rateRuleFor } from '../../../core/rates';
import { independentCreatorSql } from './relationships';
import { assertDuty } from '../../../core/duties';

export interface PriceInput {
  taskId: string;
  payeeId: string;
  unitPrice: string;
  from: string;
  to?: string;
  reason: string;
}
export async function draftPrice(user: AuthUser, scope: Scope, key: string, input: PriceInput) {
  if (user.role === 'creator') fail('达人无报价权限', 403);
  day(input.from);
  if (input.to) day(input.to);
  if (input.to && input.to <= input.from) fail('价格有效区间不合法');
  const price = moneyText(money(input.unitPrice));
  return mutate(user, scope, 'price.draft', key, input, async (c) => {
    const [task] = await select(c, 'SELECT id FROM tasks WHERE id=? AND project_id=? FOR UPDATE', [
      input.taskId,
      scope.projectId,
    ]);
    if (!task) fail('任务不属于当前项目');
    const [target] = await select(
      c,
      `SELECT u.id,u.role,u.parent_id,${independentCreatorSql('u',' FOR SHARE')} independent FROM users u JOIN project_members pm ON pm.user_id=u.id
      WHERE u.id=? AND u.is_active=1 AND pm.project_id=? AND pm.left_at IS NULL FOR SHARE`,
      [input.payeeId, scope.projectId],
    );
    if (!target) fail('收款人不是有效项目成员', 403);
    let relation = '';
    if (isStaffRole(user.role)) {
      if (target.role === 'leader') relation = 'agency_leader';
      else if (target.role === 'creator' && Number(target.independent)) relation = 'agency_creator';
    } else if (target.role === 'creator' && String(target.parent_id) === user.sub) relation = 'leader_creator';
    if (!relation) fail('当前付款关系不允许向此成员报价', 403);
    const payerKind = isStaffRole(user.role) ? 'agency' : 'user',
      payerId = isStaffRole(user.role) ? '1' : user.sub;
    const agreementId = await insert(
      c,
      `INSERT INTO zh_price_agreements(account_id,project_id,task_id,payer_kind,payer_id,payee_id,relation_type)
      VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [scope.accountId, scope.projectId, input.taskId, payerKind, payerId, input.payeeId, relation],
    );
    const id = await insert(
      c,
      'INSERT INTO zh_price_versions(agreement_id,unit_price,effective_from,effective_to,created_by,reason,relationship_snapshot) VALUES(?,?,?,?,?,?,?)',
      [
        agreementId,
        price,
        input.from,
        input.to ?? null,
        user.sub,
        input.reason,
        JSON.stringify({ target, payerKind, payerId }),
      ],
    );
    await audit(c, user, 'price.draft', id, { agreementId });
    return { id, agreementId };
  });
}
const pricesSql = `SELECT a.*,v.id AS version_id,v.status AS price_status,CAST(v.unit_price AS CHAR) AS price,DATE_FORMAT(v.effective_from,'%Y-%m-%d') AS start_day,
  DATE_FORMAT(v.effective_to,'%Y-%m-%d') AS end_day FROM zh_price_agreements a JOIN zh_price_versions v ON v.agreement_id=a.id`;
function covers(prices: RecordRow[], start: string, end: string | null, price: bigint) {
  let cursor = start;
  const until = end ?? '9999-12-31';
  for (const p of prices.sort((a, b) => String(a.start_day).localeCompare(String(b.start_day)))) {
    const to = String(p.end_day ?? '9999-12-31');
    if (to <= cursor) continue;
    if (String(p.start_day) > cursor || money(String(p.price)) < price) return false;
    cursor = to;
    if (cursor >= until) return true;
  }
  return false;
}
export async function publishPrice(user: AuthUser, scope: Scope, id: string, key: string) {
  if (user.role === 'creator') fail('达人无报价发布权限', 403);
  return mutate(user, scope, 'price.publish', key, { id }, async (c) => {
    const [ref] = await select(
      c,
      'SELECT a.task_id FROM zh_price_versions v JOIN zh_price_agreements a ON a.id=v.agreement_id WHERE v.id=? AND a.account_id=? AND a.project_id=?',
      [id, scope.accountId, scope.projectId],
    );
    if (!ref) fail('报价不存在', 404);
    // 同任务的上下级报价共同串行，避免双方同时发布绕过倒挂校验。
    await select(c, 'SELECT id FROM tasks WHERE id=? FOR UPDATE', [ref.task_id]);
    const [p] = await select(c, `${pricesSql} WHERE v.id=? FOR UPDATE`, [id]);
    if (
      (p.payer_kind === 'agency' && !isStaffRole(user.role)) ||
      (p.payer_kind === 'user' && String(p.payer_id) !== user.sub)
    )
      fail('仅付款主体可发布报价', 403);
    if (p.price_status === 'published') return { id };
    const [target] = await select(
      c,
      `SELECT u.role,u.parent_id,${independentCreatorSql('u',' FOR SHARE')} independent FROM users u JOIN project_members pm ON pm.user_id=u.id WHERE u.id=? AND u.is_active=1 AND pm.project_id=? AND pm.left_at IS NULL FOR SHARE`,
      [p.payee_id, scope.projectId],
    );
    if (
      !target ||
      (p.relation_type === 'leader_creator' && String(target.parent_id) !== String(p.payer_id)) ||
      (p.relation_type === 'agency_creator' && !Number(target.independent))
    )
      fail('报价的上下级关系已经变化', 409);
    if (target.role !== (p.relation_type === 'agency_leader' ? 'leader' : 'creator')) fail('收款人的角色已变化', 409);
    const overlaps = await select(
      c,
      `${pricesSql} WHERE a.id=? AND v.status='published' AND v.effective_from<COALESCE(?,'9999-12-31') AND COALESCE(v.effective_to,'9999-12-31')>? FOR UPDATE`,
      [p.id, p.end_day, p.start_day],
    );
    for (const old of overlaps) {
      if (String(p.start_day) <= businessDay() || String(old.start_day) >= String(p.start_day))
        fail('价格区间冲突；已生效价格不能覆盖，未来调价须晚于现有起点', 409);
      await c.query('UPDATE zh_price_versions SET effective_to=? WHERE id=?', [p.start_day, old.version_id]);
      await audit(c, user, 'price.close-future', String(old.version_id), { effectiveTo: p.start_day });
    }
    await c.query("UPDATE zh_price_versions SET status='published',published_by=?,published_at=NOW(3) WHERE id=?", [
      user.sub,
      id,
    ]);
    const all = await select(
      c,
      `${pricesSql} WHERE a.account_id=? AND a.project_id=? AND a.task_id=? AND v.status='published'`,
      [scope.accountId, scope.projectId, p.task_id],
    );
    for (const lower of all.filter((x) => x.relation_type === 'leader_creator')) {
      const upper = all.filter(
        (x) => x.relation_type === 'agency_leader' && String(x.payee_id) === String(lower.payer_id),
      );
      if (
        !covers(
          upper,
          String(lower.start_day),
          lower.end_day === null ? null : String(lower.end_day),
          money(String(lower.price)),
        )
      )
        fail('团长达人报价高于进价，或进价未覆盖完整有效期', 409);
    }
    await audit(c, user, 'price.publish', id);
    return { id };
  });
}
export async function listPrices(user: AuthUser, scope: Scope, page: number, pageSize: number) {
  if(isStaffRole(user.role))assertDuty(user,'finance');
  await authorize(user, scope);
  return withTransaction(async (c) => {
    await scopeLock(c, scope, user);
    const where = `a.account_id=? AND a.project_id=? AND (?=1 OR a.payee_id=? OR (a.payer_kind='user' AND a.payer_id=?))`;
    const args = [scope.accountId, scope.projectId, Number(isStaffRole(user.role)), user.sub, user.sub];
    const [total] = await select(
      c,
      `SELECT COUNT(*) total FROM zh_price_agreements a JOIN zh_price_versions v ON v.agreement_id=a.id WHERE ${where}`,
      args,
    );
    const list = await select(c, `${pricesSql} WHERE ${where} ORDER BY v.id DESC LIMIT ? OFFSET ?`, [
      ...args,
      pageSize,
      (page - 1) * pageSize,
    ]);
    return { list, total: Number(total.total), page, pageSize };
  });
}
export interface Obligation {
  priceSource?: 'agreement' | 'role_rate';
  relation: string;
  payerKind: string;
  payerId: string;
  payeeId: string;
  versionId: string;
  unitPrice: string;
  amount: string;
}
export async function quote(
  c: PoolConnection,
  scope: Scope,
  taskId: string,
  binding: RecordRow,
  date: string,
  orders: string,
): Promise<Obligation[]> {
  day(date);
  const quantity = count(orders);
  if(binding.path_type==='staff_self'){
    let rule:Awaited<ReturnType<typeof rateRuleFor>>;
    try{rule=await rateRuleFor(c,{projectId:scope.projectId,moduleId:'zhihu',metricType:'new_user',ruleCode:'staff_self',date});}
    catch(error){if(error instanceof Error&&error.message==='RATE_OVERLAP')fail('PRICE_OVERLAP',409);throw error;}
    if(!rule)fail('PRICE_MISSING',409);
    return [{relation:'new_user:staff_self',payerKind:'agency',payerId:'1',payeeId:String(binding.executor_id),versionId:rule.id,priceSource:'role_rate',unitPrice:rule.unitPrice,amount:moneyText(quantity*money(rule.unitPrice))}];
  }
  const paths: [string, string, string, string][] = [];
  if (binding.path_type === 'team_creator' || binding.path_type === 'leader_self')
    paths.push(['agency_leader', 'agency', '1', String(binding.leader_id)]);
  if (binding.path_type === 'team_creator')
    paths.push(['leader_creator', 'user', String(binding.leader_id), String(binding.executor_id)]);
  if (binding.path_type === 'direct_creator')
    paths.push(['agency_creator', 'agency', '1', String(binding.executor_id)]);
  if (!paths.length) fail('执行人尚未分配', 409);
  const result: Obligation[] = [];
  for (const [relation, payerKind, payerId, payeeId] of paths) {
    const prices = await select(
      c,
      `${pricesSql} WHERE a.account_id=? AND a.project_id=? AND a.task_id=? AND a.payer_kind=? AND a.payer_id=? AND a.payee_id=? AND a.relation_type=?
      AND v.status='published' AND v.effective_from<=? AND (v.effective_to IS NULL OR v.effective_to>?)`,
      [scope.accountId, scope.projectId, taskId, payerKind, payerId, payeeId, relation, date, date],
    );
    if (prices.length > 1) fail('PRICE_OVERLAP', 409);
    let rule:Awaited<ReturnType<typeof rateRuleFor>>=null;
    if(!prices.length){
      try{rule=await rateRuleFor(c,{projectId:scope.projectId,moduleId:'zhihu',metricType:'new_user',ruleCode:relation==='agency_leader'?'leader_self':'creator',date});}
      catch(error){if(error instanceof Error&&error.message==='RATE_OVERLAP')fail('PRICE_OVERLAP',409);throw error;}
      if(!rule)fail('PRICE_MISSING',409);
    }
    const price = prices.length?String(prices[0].price):rule!.unitPrice;
    result.push({
      relation,
      payerKind,
      payerId,
      payeeId,
      versionId: prices.length?String(prices[0].version_id):rule!.id,
      priceSource: prices.length?'agreement':'role_rate',
      unitPrice: price,
      amount: moneyText(quantity * money(price)),
    });
  }
  if(binding.path_type==='team_creator'&&result.some(o=>o.priceSource==='role_rate')&&money(result[1].unitPrice)>money(result[0].unitPrice))fail('PRICE_MISSING',409);
  return result;
}
