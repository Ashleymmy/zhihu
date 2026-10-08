import { z } from 'zod';
import type { ModuleTaskProvider, ModuleTodoProvider, TaskItem, TaskScope } from '../../src/core/contracts';
import type { AuthUser } from '../../src/types';
import { AppError } from '../../src/middleware/errors';
const row = z.object({ id: z.string(), title: z.string(), executorId: z.string().nullable(), completed: z.boolean() });
export function sampleTasks(endpoint: URL): { taskProvider: ModuleTaskProvider; todoProvider: ModuleTodoProvider } {
  async function read(scope: TaskScope, user: AuthUser) {
    const url = new URL(endpoint);
    url.searchParams.set('projectId', scope.projectId);
    url.searchParams.set('accountId', scope.accountId);
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw Error('sample_tasks_unavailable');
    const tasks = z.object({ tasks: z.array(row).default([]) }).parse(await response.json()).tasks;
    return tasks.filter((task) => !task.executorId || task.executorId === user.sub || user.role === 'admin');
  }
  function present(task: z.infer<typeof row>, user: AuthUser): TaskItem {
    return {
      id: task.id,
      title: task.title,
      status: task.completed
        ? { key: 'done', label: '已完成', tone: 'success' }
        : task.executorId
          ? { key: 'assigned', label: '待交作品', tone: 'warning' }
          : { key: 'available', label: '可领取', tone: 'success' },
      executor: task.executorId ? (task.executorId === user.sub ? '本人' : '项目成员') : '待领取',
      next: {
        actor: '本人',
        text: task.completed ? '已完成' : task.executorId ? '继续完成任务' : '领取任务',
        ...(!task.executorId ? { action: { key: 'claim', label: '领取任务' } } : {}),
      },
      metrics: [],
    };
  }
  return {
    taskProvider: {
      async list(scope, user, filter) {
        const all = (await read(scope, user)).filter(
          (task) =>
            (filter.view === 'owned'
              ? task.executorId === user.sub
              : filter.view === 'available'
                ? !task.executorId
                : true) && task.title.includes(filter.search),
        );
        return {
          list: all
            .slice((filter.page - 1) * filter.pageSize, filter.page * filter.pageSize)
            .map((task) => present(task, user)),
          total: all.length,
        };
      },
      async detail(scope, user, id) {
        const task = (await read(scope, user)).find((task) => task.id === id);
        if (!task) throw new AppError(404, 40401, '任务不存在');
        return {
          ...present(task, user),
          fields: [],
          progress: [
            { label: '领取', status: task.executorId ? 'done' : 'current', actor: '本人' },
            { label: '完成', status: task.completed ? 'done' : task.executorId ? 'current' : 'waiting', actor: '本人' },
          ],
          actions: !task.executorId ? [{ key: 'claim', label: '领取任务' }] : [],
        };
      },
      async execute(scope, user, id, action, _input, requestKey) {
        const task = (await read(scope, user)).find((task) => task.id === id);
        if (action !== 'claim' || !task || task.executorId) throw new AppError(409, 40901, '任务已被领取或不可操作');
        const response = await fetch(new URL('claim', endpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
          body: JSON.stringify({ ...scope, id, userId: user.sub }),
          signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) throw new AppError(409, 40901, '领取未完成，请刷新后重试');
        return { message: '任务已领取' };
      },
    },
    todoProvider: {
      async overview(scope, user) {
        const tasks = (await read(scope, user)).filter((task) => task.executorId === user.sub && !task.completed);
        return {
          todos: tasks.length
            ? [
                {
                  kind: 'task.submit',
                  count: tasks.length,
                  label: '任务待完成',
                  actor: '本人',
                  actionLabel: '查看任务',
                  path: '/tasks?' + new URLSearchParams({ projectId: scope.projectId }),
                },
              ]
            : [],
          metrics: [],
        };
      },
    },
  };
}
