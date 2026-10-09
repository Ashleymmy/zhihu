import type { ActivityFilter, ActivityResult, DataScope } from '../../../core/contracts';
import type { AuthUser } from '../../../types';
import { isStaffRole } from '../../../auth/roles';
import { withTransaction } from '../../../db';
import { authorize, select } from './store';
import { day, fail } from './domain';

// One latest report record per metric/date/keyword, independent of payout lines.
// This read path deliberately returns no rate, settlement or payee amounts.
export async function performance(scope: DataScope, user: AuthUser, filter: ActivityFilter): Promise<ActivityResult> {
  await authorize(user, scope);
  day(scope.from); day(scope.to);
  if (scope.from > scope.to) fail('开始日期不能晚于结束日期');
  if (filter.metricType && !['new_user', 'activation'].includes(filter.metricType)) fail('请选择拉新或拉活');
  const where = ['f.account_id=?', 'f.project_id=?', 'f.business_date BETWEEN ? AND ?',
    "f.metric_type IN ('new_user','activation')"], args: unknown[] = [scope.accountId, scope.projectId, scope.from, scope.to];
  if (!isStaffRole(user.role)) {
    where.push(user.role === 'leader' ? '(b.executor_id=? OR b.leader_id=?)' : 'b.executor_id=?');
    args.push(user.sub);
    if (user.role === 'leader') args.push(user.sub);
  }
  const view = user.role === 'creator' ? 'self' : filter.view;
  if (view === 'self') { where.push('b.executor_id=?'); args.push(user.sub); }
  if (view === 'team') { where.push('b.executor_id<>?'); args.push(user.sub); }
  if (filter.ownerId) { where.push('b.executor_id=?'); args.push(filter.ownerId); }
  if (filter.metricType) { where.push('f.metric_type=?'); args.push(filter.metricType); }
  const base = `SELECT CAST(f.id AS CHAR) id,CAST(k.plan_id AS CHAR) plan_id,k.keyword,
    CAST(b.executor_id AS CHAR) performer_id,u.display_name performer_name,
    DATE_FORMAT(f.business_date,'%Y-%m-%d') business_date,f.metric_type,
    CAST(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(v.snapshot_json,
      IF(f.metric_type='activation','$.activations','$.orders'))),'null') AS DECIMAL(30,0)) AS CHAR) quantity
    FROM zh_metric_facts f JOIN zh_metric_revisions v ON v.id=f.current_revision_id
    JOIN zh_keywords k ON k.id=f.keyword_id AND k.project_id=f.project_id AND k.account_id=f.account_id
    LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id AND b.keyword_id=k.id
    LEFT JOIN users u ON u.id=b.executor_id WHERE ${where.join(' AND ')}`;
  return withTransaction(async c => {
    const groups = await select(c, `SELECT metric_type,COUNT(*) records,SUM(quantity IS NULL) pending,
      CAST(SUM(CAST(quantity AS DECIMAL(30,0))) AS CHAR) quantity FROM (${base}) data GROUP BY metric_type`, args);
    const rows = await select(c, `SELECT * FROM (${base}) data ORDER BY business_date DESC,CAST(id AS UNSIGNED) DESC LIMIT ? OFFSET ?`,
      [...args, filter.pageSize, (filter.page - 1) * filter.pageSize]);
    const label = (type: unknown) => type === 'activation' ? '拉活' : '拉新';
    const unit = (type: unknown) => type === 'activation' ? '个' : '单';
    const total = groups.reduce((n, g) => n + Number(g.records), 0);
    return {
      status: total ? 'ready' : 'empty', total, page: filter.page, pageSize: filter.pageSize,
      metrics: groups.map(g => ({key:String(g.metric_type),label:label(g.metric_type),unit:unit(g.metric_type),
        value:g.quantity == null ? null : String(g.quantity),records:Number(g.records),pending:Number(g.pending)})),
      list: rows.map(r => ({id:String(r.id),taskId:'plan:'+r.plan_id,taskName:String(r.keyword),
        performerId:r.performer_id == null ? null : String(r.performer_id),performerName:String(r.performer_name || '尚未指定'),
        businessDate:String(r.business_date),metricType:String(r.metric_type),metricLabel:label(r.metric_type),
        quantity:r.quantity == null ? null : String(r.quantity),quantityUnit:unit(r.metric_type)})),
    };
  });
}
