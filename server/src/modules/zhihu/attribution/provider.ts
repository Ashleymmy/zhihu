import type { ModuleDataProvider } from '../../../core/contracts';
import { withTransaction } from '../../../db';
import { authorize, select } from './store';
import { day, fail } from './domain';
export const attributionDataProvider: ModuleDataProvider = {
  async summary(scope, user) {
    await authorize(user, scope);
    day(scope.from);
    day(scope.to);
    if (scope.to < scope.from) fail('日期范围不合法');
    const [r] = await withTransaction((c) =>
      select(
        c,
        `SELECT COUNT(*) total,MAX(v.created_at) updated_at,
      CAST(SUM(CASE WHEN COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(v.snapshot_json,'$.riskAssessment')),'null'),'')=''
        THEN CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(v.snapshot_json,'$.orders')),'null') AS DECIMAL(30,0)) END) AS CHAR) orders,
      CAST(SUM(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(v.snapshot_json,'$.search')),'null') AS DECIMAL(30,0))) AS CHAR) searches
      FROM zh_metric_facts f JOIN zh_metric_revisions v ON v.id=f.current_revision_id JOIN zh_keywords k ON k.id=f.keyword_id
      LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id WHERE f.account_id=? AND f.project_id=? AND f.business_date BETWEEN ? AND ?
      AND (?='admin' OR b.executor_id=? OR b.leader_id=?)`,
        [scope.accountId, scope.projectId, scope.from, scope.to, user.role, user.sub, user.sub],
      ),
    );
    return {
      moduleId: 'zhihu',
      ...scope,
      updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : new Date().toISOString(),
      status: Number(r.total) ? 'ready' : 'empty',
      metrics: [
        {
          key: 'zhihu.final_orders',
          label: '知乎有效订单',
          unit: '笔',
          value: r.orders === null ? null : String(r.orders),
        },
        {
          key: 'zhihu.searches',
          label: '知乎搜索量',
          unit: '次',
          value: r.searches === null ? null : String(r.searches),
        },
      ],
    };
  },
};
