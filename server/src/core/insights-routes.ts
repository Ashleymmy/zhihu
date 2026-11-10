import { Router } from 'express';
import { asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import type { ModuleRuntime } from './module-runtime';
import { readInsights } from './insights';
import { readDeveloperInsights, runCurrentInspection } from './insights-operations';

export function createInsightsRouter(runtime: ModuleRuntime) {
  const router = Router();
  for (const name of ['summary', 'daily', 'team-top', 'retention', 'relation-forest', 'live-feed'] as const)
    router.get('/' + name, asyncHandler(async (req, res) => ok(res, await readInsights(runtime, req.user, name, req.query))));
  for (const name of ['dev-summary', 'dev-daily', 'dev-workers', 'dev-activity', 'dev-inspections', 'dev-queue'] as const)
    router.get('/' + name, asyncHandler(async (req, res) => ok(res, await readDeveloperInsights(req.user, name, req.query))));
  router.post('/dev-inspections/run', asyncHandler(async (req, res) => ok(res, await runCurrentInspection(req.user, req.body))));
  return router;
}
