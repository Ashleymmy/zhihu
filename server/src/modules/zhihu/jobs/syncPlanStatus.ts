import { requireOfficialPlanRead } from '../zhihu/planReadCapability';

/** Retain the handler for queued legacy jobs, but fail explicitly instead of reporting success. */
export async function syncPlanStatus() {
  requireOfficialPlanRead();
}
