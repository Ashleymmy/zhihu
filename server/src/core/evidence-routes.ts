import { Router } from 'express';
import { asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import type { ModuleRuntime } from './module-runtime';
import { evidenceQuerySchema, queryEvidence } from './evidence';

export function createEvidenceRouter(runtime: ModuleRuntime) {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    ok(res, await queryEvidence(runtime, req.user, evidenceQuerySchema.parse(req.query)));
  }));
  return router;
}
