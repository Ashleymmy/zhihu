import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody } from '../middleware/validate';
import { ok, okList } from '../utils/response';
import { enqueue } from '../queue';
import {
  accountMonitor,
  activeAnnouncements,
  cleanupAuditLogs,
  createAnnouncement,
  dbStats,
  listAnnouncements,
  listAuditActions,
  listAuditLogs,
  setAnnouncementStatus,
  siteInfo,
} from '../services/admin-tools.service';

const id = z.string().regex(/^\d+$/);
const announcementInput = z.object({
  title: z.string().trim().min(1).max(128),
  content: z.string().trim().min(1).max(2000),
});
const cleanupInput = z.object({ days: z.number().int().min(7).max(365) });
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const settleInput = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  settleDate: dateStr.optional(),
});

/** 操作日志（admin 审计） */
export const auditLogsRouter = Router();
auditLogsRouter.use(requireAuth, requirePermission('audit.view'));
auditLogsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const data = await listAuditLogs(req.query);
    okList(res, data.list, data.total, data.page, data.pageSize);
  }),
);
auditLogsRouter.get('/actions', asyncHandler(async (_req, res) => ok(res, await listAuditActions())));

/** 系统工具（admin） */
export const adminToolsRouter = Router();
adminToolsRouter.use(requireAuth, requirePermission('project.manage'));
adminToolsRouter.get('/monitor', asyncHandler(async (_req, res) => ok(res, await accountMonitor())));
adminToolsRouter.get('/db-stats', asyncHandler(async (_req, res) => ok(res, await dbStats())));
adminToolsRouter.post(
  '/audit-cleanup',
  validateBody(cleanupInput),
  asyncHandler(async (req, res) => ok(res, await cleanupAuditLogs(req.user, req.body.days, req.ip))),
);
adminToolsRouter.get('/site-info', asyncHandler(async (_req, res) => ok(res, await siteInfo())));
adminToolsRouter.post(
  '/settle-earnings',
  validateBody(settleInput),
  asyncHandler(async (req, res) => {
    const jobId = `settle-manual-${Date.now()}`;
    await enqueue(
      'settle-earnings',
      { source: 'manual', from: req.body.from ?? req.body.settleDate, to: req.body.to ?? req.body.settleDate },
      { jobId },
    );
    ok(res, { jobId, message: '收益结算任务已加入队列' }, 202);
  }),
);

/** 公告：管理面（admin） + 生效列表（全体登录用户） */
export const announcementsRouter = Router();
announcementsRouter.use(requireAuth);
announcementsRouter.get('/active', asyncHandler(async (_req, res) => ok(res, await activeAnnouncements())));
announcementsRouter.get('/', requirePermission('project.manage'), asyncHandler(async (_req, res) => ok(res, await listAnnouncements())));
announcementsRouter.post(
  '/',
  requirePermission('project.manage'),
  validateBody(announcementInput),
  asyncHandler(async (req, res) => ok(res, await createAnnouncement(req.user, req.body, req.ip), 201)),
);
announcementsRouter.post(
  '/:id/status',
  requirePermission('project.manage'),
  validateBody(z.object({ status: z.enum(['published', 'offline']) })),
  asyncHandler(async (req, res) => {
    await setAnnouncementStatus(req.user, id.parse(req.params.id), req.body.status, req.ip);
    ok(res, null);
  }),
);
