import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/errors';
import { syncPlanStatus } from '../../src/modules/zhihu/jobs/syncPlanStatus';
import { toolsRouter } from '../../src/modules/zhihu/routes/tools';
import { resolveClientEndpoint } from '../../src/modules/zhihu/zhihu/allianceEndpointRegistry';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), query: vi.fn(), get: vi.fn() }));
vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: mocks.enqueue }));
vi.mock('../../src/db', () => ({ db: { query: mocks.query }, rows: vi.fn() }));
vi.mock('../../src/modules/zhihu/zhihu/client', () => ({ zhihuGet: mocks.get }));
vi.mock('../../src/auth/middleware', () => ({ requireAuth: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../../src/modules/zhihu/permissions', () => ({ requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next() }));

describe('official plan reads require a verified upstream contract', () => {
  it('does not register an undocumented GET as a usable plan-list endpoint', () => {
    expect(resolveClientEndpoint('GET', '/alliance/api/popularize_plans')).toBeUndefined();
    expect(resolveClientEndpoint('POST', '/alliance/api/popularize_plans')).toBeDefined();
  });
  it('rejects manual synchronization instead of acknowledging an impossible job', async () => {
    const app = express(); app.use('/tools', toolsRouter); app.use(errorHandler);
    const response = await request(app).post('/tools/sync-plan-status');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ code: 50312, data: null });
    expect(response.body.message).toContain('尚未接通');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('fails old queued jobs without calling the upstream or changing local records', async () => {
    await expect(syncPlanStatus()).rejects.toMatchObject({ httpStatus: 503, code: 50312 });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
