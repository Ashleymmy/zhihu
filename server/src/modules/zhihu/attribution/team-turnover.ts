import type { ModuleDataProvider, TeamTurnover } from '../../../core/contracts';
import { fail, day } from './domain';
import { select } from './store';

export const teamTurnover: NonNullable<ModuleDataProvider['teamTurnover']> = async (c, scope, user) => {
  if (user.role !== 'leader') fail('仅团长可查看团队流水', 403);
  day(scope.from);
  day(scope.to);
  const yesterday = new Date(Date.parse(scope.to) - 86400000).toISOString().slice(0, 10);
  // Read the accepted report and its recorded ownership, not today's team parent.
  // Each fact occurs once, regardless of the number of payees or uploaded copies.
  const [row] = await select(
    c,
    `SELECT
    CAST(COALESCE(SUM(amount),0) AS CHAR) total,
    CAST(COALESCE(SUM(IF(business_date=?,amount,0)),0) AS CHAR) today,
    CAST(COALESCE(SUM(IF(business_date=?,amount,0)),0) AS CHAR) yesterday,
    COUNT(*) total_records,COALESCE(SUM(business_date=?),0) today_records,COALESCE(SUM(business_date=?),0) yesterday_records,
    COALESCE(SUM(amount IS NULL),0) total_missing,
    COALESCE(SUM(business_date=? AND amount IS NULL),0) today_missing,
    COALESCE(SUM(business_date=? AND amount IS NULL),0) yesterday_missing
    FROM (SELECT f.business_date,CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.snapshot_json,
      IF(f.metric_type='activation','$.settlement','$.revenue'))),'null') AS DECIMAL(20,4)) amount
      FROM zh_metric_facts f JOIN zh_attribution_results r ON r.id=f.current_result_id
      JOIN projects p ON p.id=f.project_id JOIN integration_accounts a ON a.id=f.account_id AND a.module_id='zhihu'
      JOIN project_integrations pi ON pi.project_id=p.id AND pi.account_id=a.id
      WHERE f.project_id=? AND f.account_id=? AND f.business_date BETWEEN ? AND ?
        AND p.is_enabled=1 AND a.status='active'
        AND EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=? AND pm.left_at IS NULL)
        AND (JSON_UNQUOTE(JSON_EXTRACT(r.snapshot_json,'$.binding.leader_id'))=?
          OR JSON_UNQUOTE(JSON_EXTRACT(r.snapshot_json,'$.binding.executor_id'))=?)
        AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.snapshot_json,'$.withdrawn')),'false')<>'true'
        AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.snapshot_json,'$.riskReview.decision')),'')<>'excluded'
        AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.snapshot_json,IF(f.metric_type='activation','$.activations','$.orders'))),'null') IS NOT NULL
    ) report`,
    [
      scope.to,
      yesterday,
      scope.to,
      yesterday,
      scope.to,
      yesterday,
      scope.projectId,
      scope.accountId,
      scope.from,
      scope.to,
      user.sub,
      user.sub,
      user.sub,
    ],
  );
  const result: TeamTurnover = {
    total: String(row.total),
    today: String(row.today),
    yesterday: String(row.yesterday),
    missing: { total: 0, today: 0, yesterday: 0 },
    records: { total: 0, today: 0, yesterday: 0 },
  };
  for (const key of ['total', 'today', 'yesterday'] as const) {
    result.missing[key] = Number(row[key + '_missing']);
    result.records[key] = Number(row[key + '_records']);
  }
  return result;
};
