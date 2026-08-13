import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody, validateQuery } from '../middleware/validate';
import { checkKeyword, createPlan, deletePlan, getPlan, listPlans, retryPlan, updatePlan } from '../services/plans.service';
import { paginationSchema } from '../utils/pagination';
import { ok, okList } from '../utils/response';

const id = z.string().regex(/^\d+$/);
const keyword = z.string().trim().min(1).max(128).refine(
  (value) => !/[\s,，、;；]/u.test(value),
  '仅支持单个关键词，不能包含空格或分隔符',
);
const listSchema = paginationSchema.extend({ taskId: z.string().optional(), channelId: z.string().optional(), keyword: z.string().optional(), status: z.string().optional() });
const checkSchema = z.object({ channelId: z.string().min(1), keyword });
const createSchema = z.object({
  taskId: z.string().min(1), channelId: z.string().min(1), secondChannelId: z.string().nullable().optional(),
  keyword, landingUrl: z.string().url().max(1024), popularizeType: z.number().int(),
  name: z.string().max(255).nullable().optional(), dailyBudget: z.number().nonnegative().nullable().optional(),
  startDate: z.string().date().nullable().optional(), endDate: z.string().date().nullable().optional(), ownerId: id.optional(),
});
const updateSchema = z.object({ keyword: keyword.optional(), landingUrl: z.string().url().max(1024).optional(), name: z.string().max(255).nullable().optional(), dailyBudget: z.number().nonnegative().nullable().optional() });

export const plansRouter = Router();
plansRouter.use(requireAuth);
plansRouter.post('/check-keyword', requirePermission('keyword.bind'), validateBody(checkSchema), asyncHandler(async (req, res) => ok(res, await checkKeyword(req.user, req.body.channelId, req.body.keyword))));
plansRouter.get('/', validateQuery(listSchema), asyncHandler(async (req, res) => { const data = await listPlans(req.user, req.query); okList(res, data.list, data.total, data.page, data.pageSize); }));
plansRouter.post('/', requirePermission('plan.create'), validateBody(createSchema), asyncHandler(async (req, res) => ok(res, await createPlan(req.user, req.body, req.ip), 201)));
plansRouter.get('/:id', asyncHandler(async (req, res) => ok(res, await getPlan(req.user, id.parse(req.params.id)))));
plansRouter.patch('/:id', requirePermission('plan.edit'), validateBody(updateSchema), asyncHandler(async (req, res) => ok(res, await updatePlan(req.user, id.parse(req.params.id), req.body, req.ip))));
plansRouter.delete('/:id', requirePermission('plan.delete'), asyncHandler(async (req, res) => { await deletePlan(req.user, id.parse(req.params.id), req.ip); ok(res, null); }));
plansRouter.post('/:id/retry-sync', requirePermission('plan.create'), asyncHandler(async (req, res) => ok(res, await retryPlan(req.user, id.parse(req.params.id), req.ip))));
