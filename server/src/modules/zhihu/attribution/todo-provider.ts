import type { ModuleTodoProvider, TodoItem, DashboardMetric } from '../../../core/contracts';
import { dutyAllows } from '../../../core/duties';
import { isStaffRole } from '../../../auth/roles';
import { withTransaction } from '../../../db';
import { authorize, select } from './store';
import { overview } from './workbench';
import { listWorks, workActivity } from './works';
import { readyPlanSql } from './keyword-usability';

export const zhihuTodoProvider: ModuleTodoProvider = {
  async overview(scope, user) {
    await authorize(user, scope);
    const query = new URLSearchParams({ projectId: scope.projectId, accountId: scope.accountId }).toString();
    const link = (path: string, extra = '') => path + '?' + query + extra;
    const periodQuery = '&from=' + scope.from + '&to=' + scope.to;
    const todos: TodoItem[] = [], metrics: DashboardMetric[] = [];
    const push = (kind: string, count: unknown, label: string, actor: string, actionLabel: string, path: string) => {
      if (Number(count) > 0) todos.push({ kind, count: Number(count), label, actor, actionLabel, path });
    };
    if (!isStaffRole(user.role) || dutyAllows(user, 'operations')) {
      const [tasks] = await withTransaction((c) => select(c, `SELECT
        SUM(b.path_type='reserved') reserved,
        SUM(b.executor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM compositions cw WHERE cw.plan_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM zh_evidence e WHERE e.binding_id=b.id) AND ${readyPlanSql()}) missing_work,
        SUM(p.sync_status='failed') failed
        FROM zh_keywords k JOIN plans p ON p.id=k.plan_id LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id
        WHERE k.account_id=? AND k.project_id=? AND k.lifecycle_status NOT IN ('archived','retired')
          AND (b.id IS NULL OR b.released_at IS NULL AND b.stop_new_use_at IS NULL)
          AND (?=1 OR b.executor_id=? OR b.leader_id=?)`,
      [scope.accountId, scope.projectId, Number(isStaffRole(user.role)), user.sub, user.sub]));
      if (user.role === 'leader') push('task.assign', tasks.reserved, '任务待分配', '团长', '分配执行人', link('/tasks'));
      push('task.submit', tasks.missing_work, user.role === 'creator' ? '任务待交作品' : '任务待跟进作品',
        user.role === 'creator' ? '本人' : user.role === 'leader' ? '团长与执行人' : '运营与执行人', '查看任务', link('/tasks'));
      push('task.failed', tasks.failed, '关键词创建失败', '创建人', '修改并重试', link('/tasks'));
      const failed = await listWorks(user, scope, 1, 1, { result: 'failed' });
      push('work.failed', failed.total, '作品提交失败', '提交人', '修改作品', link('/works', '&result=failed'));
      const [history] = await withTransaction(c=>select(c,`SELECT
        SUM(b.verification_status='pending' AND (e.id IS NULL OR e.status='rejected')) missing,
        SUM(b.verification_status='pending' AND e.status='pending' AND (?=1 OR b.leader_id=? AND b.executor_id<>?)) reviewing,
        SUM(b.verification_status='disputed') disputed
        FROM zh_keywords k JOIN zh_keyword_bindings b ON b.id=k.current_binding_id
        LEFT JOIN zh_evidence e ON e.id=(SELECT MAX(ev.id) FROM zh_evidence ev WHERE ev.binding_id=b.id)
        WHERE k.account_id=? AND k.project_id=? AND k.legacy_mode='historical_registered'
          AND b.verification_status IN ('pending','disputed') AND b.released_at IS NULL AND b.stop_new_use_at IS NULL
          AND (?=1 OR b.executor_id=? OR b.leader_id=?)`,
        [Number(isStaffRole(user.role)),user.sub,user.sub,scope.accountId,scope.projectId,Number(isStaffRole(user.role)),user.sub,user.sub]));
      push('work.historical.submit',history.missing,'历史任务待补作品','执行人','补登记历史作品',link('/works'));
      push('work.historical.review',history.reviewing,'历史作品待核验','团长或运营','核验历史作品',link('/works'));
      if(dutyAllows(user,'operations'))push('work.historical.disputed',history.disputed,'历史作品有争议','运营','核实作品归属',link('/works'));
      if (dutyAllows(user, 'operations')) {
        const [issues] = await withTransaction((c) => select(c, `SELECT COUNT(*) total FROM zh_exceptions
          WHERE account_id=? AND project_id=? AND status='open'
            AND reason_code NOT IN ('PRICE_MISSING','PRICE_OVERLAP','PRICE_CONFLICT','REPORT_INCOMPLETE','SOURCE_REVISION_PENDING')`,
        [scope.accountId, scope.projectId]));
        push('data.resolve', issues.total, '数据待核对', '运营', '处理数据问题', link('/data-issues'));
      }
      const performance = await workActivity(user, scope, { from: scope.from, to: scope.to, view: 'self' }, 1, 1);
      metrics.push({ key: 'works.self', label: '我的作品', value: String(performance.summary.registered), unit: '篇', path: link('/works', '&view=self' + periodQuery) });
      if (user.role === 'leader' || isStaffRole(user.role)) {
        const team = await workActivity(user, scope, { from: scope.from, to: scope.to, view: 'team' }, 1, 1);
        metrics.push({ key: 'works.team', label: user.role === 'leader' ? '团队作品' : '成员作品', value: String(team.summary.registered), unit: '篇', path: link('/works', '&view=team' + periodQuery) });
      }
    }
    if (!isStaffRole(user.role) || dutyAllows(user, 'finance')) {
      const finance = await overview(user, scope, { from: scope.from, to: scope.to });
      if (dutyAllows(user, 'finance')) push('bill.confirm', new Set(finance.entries.filter((entry) => entry.ready).map((entry) => entry.factId)).size,
        '业绩待确认账单', '财务', '核对并确认', link('/finance'));
      for (const [type, value] of Object.entries(finance.summary.byType)) {
        metrics.push({ key: 'income.' + type, label: (type === 'activation' ? '拉活' : '拉新') + (isStaffRole(user.role) ? '应付' : '收益'),
          value: isStaffRole(user.role) ? value.payable : value.receivable, unit: '元', path: link(isStaffRole(user.role) ? '/finance' : '/income', '&metricType=' + type + periodQuery) });
      }
    }
    return { todos, metrics };
  },
};
