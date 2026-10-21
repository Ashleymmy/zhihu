import { Router } from 'express';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { rows } from '../db';
import { canViewWorkStatistics } from '../auth/roles';
import { assertDuty } from './duties';
import { AppError, asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { serviceProjects } from './project-scopes';
import { assertDataScope } from './accounts';
import type { ModuleRuntime } from './module-runtime';
import type { AuthUser } from '../types';
import type { MemberActivityCounts, MemberActivityProvider, TaskScope } from './contracts';

const id = z.string().regex(/^[1-9]\d*$/);
const summaryInput = z.object({ memberIds: z.array(id).min(1).max(100), projectId: id.optional() }).strict();
const detailInput = z
  .object({
    moduleId: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
    projectId: id.optional(),
    kind: z.enum(['tasks', 'works']).default('tasks'),
    status: z.enum(['all', 'current', 'verified', 'released']).default('all'),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    search: z.string().trim().max(200).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    taskRef: z.string().min(1).max(100).optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '开始日期不能晚于结束日期' })
  .refine((q) => q.kind === 'tasks' || q.status === 'all', { message: '作品请使用作品筛选条件' });
const zero = (): MemberActivityCounts => ({ tasks: 0, currentTasks: 0, verifiedTasks: 0, works: 0 });

export function createMemberActivityRouter(runtime: ModuleRuntime) {
  const r = Router();
  r.use((req, _res, next) => {
    try {
      if (!canViewWorkStatistics(req.user.role))
        throw new AppError(403, 40300, '仅管理员和开发者可查看成员任务及作品统计');
      assertDuty(req.user, 'operations');
      next();
    } catch (e) {
      next(e);
    }
  });
  async function members(ids: string[]) {
    const found = await rows<RowDataPacket>('SELECT CAST(id AS CHAR) id FROM users WHERE id IN (?)', [ids]);
    if (found.length !== new Set(ids).size) throw new AppError(404, 40401, '成员不存在，请刷新名单');
  }
  async function sources(user: AuthUser, projectId?: string) {
    const projects = await serviceProjects(runtime, user);
    if (projectId && !projects.some((p) => p.id === projectId))
      throw new AppError(403, 40304, '无权查看该项目或项目已停用');
    const selected = projects.filter((p) => !projectId || p.id === projectId);
    const groups = new Map<
      string,
      {
        moduleId: string;
        name: string;
        provider: MemberActivityProvider;
        scopes: (TaskScope & { projectName: string })[];
      }
    >();
    const unsupported: string[] = [];
    for (const p of selected)
      for (const a of p.accounts) {
        await assertDataScope(user, p.id, a.id, a.moduleId);
        const module = runtime.get(a.moduleId);
        if (!module) throw new AppError(503, 50300, '项目暂不可用，请稍后刷新统计');
        if (!module.dataProvider?.memberActivity) {
          unsupported.push(p.name);
          continue;
        }
        if (!groups.has(a.moduleId))
          groups.set(a.moduleId, {
            moduleId: a.moduleId,
            name: module.manifest.name,
            provider: module.dataProvider.memberActivity,
            scopes: [],
          });
        groups.get(a.moduleId)!.scopes.push({ projectId: p.id, accountId: a.id, projectName: p.name });
      }
    return { groups: [...groups.values()], unsupported: [...new Set(unsupported)] };
  }
  r.post(
    '/summary',
    asyncHandler(async (req, res) => {
      const q = summaryInput.parse(req.body),
        ids = [...new Set(q.memberIds)];
      await members(ids);
      const { groups, unsupported } = await sources(req.user, q.projectId);
      const totals = Object.fromEntries(ids.map((id) => [id, zero()]));
      const modules = [];
      for (const g of groups) {
        const counts = await g.provider.summary(g.scopes, req.user, ids);
        for (const id of ids)
          for (const key of Object.keys(totals[id]) as (keyof MemberActivityCounts)[])
            totals[id][key] += counts[id]?.[key] ?? 0;
        modules.push({ moduleId: g.moduleId, name: g.name, counts });
      }
      res.setHeader('Cache-Control', 'no-store');
      ok(res, { totals, modules, unsupported });
    }),
  );
  r.get(
    '/:memberId',
    asyncHandler(async (req, res) => {
      const memberId = id.parse(req.params.memberId),
        q = detailInput.parse(req.query);
      await members([memberId]);
      const { groups } = await sources(req.user, q.projectId),
        group = groups.find((g) => g.moduleId === q.moduleId);
      if (!group) throw new AppError(403, 40304, '无权查看该项目或暂未提供成员明细');
      const result = await group.provider.records(group.scopes, req.user, memberId, q);
      res.setHeader('Cache-Control', 'no-store');
      ok(res, {
        ...result,
        list: result.list.map((r) => ({
          ...r,
          projectName:
            group.scopes.find((s) => s.projectId === r.projectId && s.accountId === r.accountId)?.projectName || '',
        })),
        page: q.page,
        pageSize: q.pageSize,
      });
    }),
  );
  return r;
}
