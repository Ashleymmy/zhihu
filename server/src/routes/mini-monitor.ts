import { Router } from 'express';
import { requireAuth } from '../auth/middleware';
import { asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { miniMonitor } from '../services/mini-monitor.service';
export const miniMonitorRouter = Router();
miniMonitorRouter.use(requireAuth);
miniMonitorRouter.get(
  '/',
  asyncHandler(async (req, res) => ok(res, await miniMonitor(req.user))),
);
