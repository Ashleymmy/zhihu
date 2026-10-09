import type { RowDataPacket } from 'mysql2/promise';
import type { AuthUser } from '../types';
import { rows } from '../db';
import { isStaffRole } from '../auth/roles';
import { assertProjectMembership } from '../services/projectMembers.service';
import { AppError } from '../middleware/errors';
import { assertDataScope } from './accounts';
import { serviceProjects } from './project-scopes';
import { dutyAllows } from './duties';
import { financeOverview } from './finance';
import type { DashboardMetric, TodoItem } from './contracts';
import type { ModuleRuntime } from './module-runtime';
import { logger } from '../utils/logger';

export async function dashboard(runtime: ModuleRuntime, user: AuthUser, period: { from: string; to: string }, projectId?: string) {
  if (projectId) await assertProjectMembership(user, projectId);
  const projects = await serviceProjects(runtime,user);
  if (projectId && !projects.some((project) => project.id === projectId)) throw new AppError(404, 40401, '项目暂不可用');
  const selected = projects.filter((project) => !projectId || project.id === projectId);
  const groups = await Promise.all(selected.map(async (project) => {
    const accounts = project.accounts;
    const services = await Promise.all(accounts.map(async (account) => {
      const module = runtime.get(account.moduleId);
      const empty = { moduleId: account.moduleId, accountId: account.id, todos: [] as TodoItem[], metrics: [] as DashboardMetric[] };
      if (!module) return { ...empty, status: 'unavailable' };
      if (!module.todoProvider) return { ...empty, status: 'unsupported' };
      try {
        await assertDataScope(user, project.id, account.id, account.moduleId);
        const data = await module.todoProvider.overview({ projectId: project.id, accountId: account.id, ...period }, user);
        const scope = { projectId: project.id, accountId: account.id, moduleId: account.moduleId };
        const query = new URLSearchParams(scope).toString();
        if (!isStaffRole(user.role)) {
          const funds = await financeOverview(user, scope);
          if (funds.balance) data.metrics.push({ key: 'wallet.available', label: '可提现', value: funds.balance.available, unit: '元', path: '/income?' + query });
        } else if (dutyAllows(user, 'finance')) {
          const withdrawals = await rows<RowDataPacket>(`SELECT status,COUNT(*) total FROM opc_withdrawals
            WHERE module_id=? AND project_id=? AND account_id=? AND status IN ('pending','approved') GROUP BY status`,
          [account.moduleId, project.id, account.id]);
          for (const item of withdrawals) data.todos.push({ kind: 'payment.' + item.status, count: Number(item.total),
            label: item.status === 'pending' ? '提现申请待审核' : '提现待登记付款', actor: '财务',
            actionLabel: item.status === 'pending' ? '审核提现' : '登记付款', path: '/finance?' + query + '#payments' });
        }
        // The provider still owns SQL isolation; the platform never serializes money to operations.
        if (isStaffRole(user.role) && !dutyAllows(user, 'finance')) data.metrics = data.metrics.filter((metric) => metric.unit !== '元');
        return { ...empty, ...data, status: 'ready' };
      } catch (error) {
        logger.warn({ err: error, moduleId: account.moduleId, projectId: project.id, accountId: account.id }, 'Dashboard provider unavailable');
        return { ...empty, status: 'unavailable' };
      }
    }));
    return { id: project.id, name: project.name, services };
  }));
  return { period, projects: projects.map(({ id, name }) => ({ id, name })), groups };
}
