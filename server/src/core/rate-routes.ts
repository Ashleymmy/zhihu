import { Router } from 'express';
import { asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import type { ModuleRuntime } from './module-runtime';
import { requireDuty } from './duties';
import { listRateVersions, publishRateVersions } from './rate-management';

export function createRateRouter(runtime: ModuleRuntime) {
  const r = Router();
  r.use(requireDuty('finance'));
  r.get(
    '/',
    asyncHandler(async (req, res) => ok(res, await listRateVersions(runtime, req.user, req.query))),
  );
  r.post(
    '/',
    asyncHandler(async (req, res) => ok(res, await publishRateVersions(runtime, req.user, req.body), 201)),
  );
  return r;
}
