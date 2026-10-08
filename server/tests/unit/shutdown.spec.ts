import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'express';
import { ModuleRuntime } from '../../src/core/module-runtime';
import { sampleManifest } from '../../examples/sample-api/module';

const resources = vi.hoisted(() => ({
  queue: vi.fn(),
  database: vi.fn(),
  revocation: vi.fn(),
  limiter: vi.fn(),
  observations: vi.fn(),
}));
vi.mock('../../src/queue', () => ({ closeQueue: resources.queue }));
vi.mock('../../src/db', () => ({ db: { end: resources.database } }));
vi.mock('../../src/auth/revocation', () => ({ revocationStore: { close: resources.revocation } }));
vi.mock('../../src/utils/rateLimit', () => ({ closeRateLimiter: resources.limiter }));
vi.mock('../../src/wechat/observability', () => ({ flushMiniObservations: resources.observations }));
import { createShutdown } from '../../src/shutdown';

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
  vi.resetAllMocks();
});

describe('graceful shutdown', () => {
  it('drains a real HTTP request and an active job before closing module/SQL connections, once for both signals', async () => {
    const runtime = new ModuleRuntime();
    const stop = vi.fn(),
      dispose = vi.fn().mockResolvedValue(undefined);
    runtime.register({ manifest: sampleManifest, router: Router(), stop, dispose });
    let finishResponse!: () => void, finishJob!: () => void;
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const job = new Promise<void>((resolve) => {
      finishJob = resolve;
    });
    resources.queue.mockReturnValue(job);
    const server = createServer((_request, response) => {
      finishResponse = () => response.end('saved');
      requestStarted();
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const response = fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}`, {
      headers: { connection: 'close' },
    });
    await started;
    const shutdown = createShutdown(server, runtime),
      pending = shutdown();
    expect(shutdown()).toBe(pending);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(resources.queue).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    finishResponse();
    expect(await (await response).text()).toBe('saved');
    await vi.waitFor(() => expect(resources.queue).toHaveBeenCalledTimes(1));
    expect(dispose).not.toHaveBeenCalled();
    expect(resources.database).not.toHaveBeenCalled();
    finishJob();
    await pending;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(resources.database).toHaveBeenCalledTimes(1);
    expect(resources.revocation).toHaveBeenCalledTimes(1);
    expect(resources.limiter).toHaveBeenCalledTimes(1);
  });

  it('closes other modules and shared resources even if one module fails to release its connection', async () => {
    const runtime = new ModuleRuntime(),
      second = vi.fn().mockResolvedValue(undefined);
    runtime.register({
      manifest: sampleManifest,
      router: Router(),
      dispose: async () => {
        throw new Error('connection failure');
      },
    });
    runtime.register({ manifest: { ...sampleManifest, id: 'second' }, router: Router(), dispose: second });
    const server = createServer();
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    await expect(createShutdown(server, runtime)()).rejects.toThrow('Module shutdown failed');
    expect(second).toHaveBeenCalledTimes(1);
    expect(resources.database).toHaveBeenCalledTimes(1);
    expect(runtime.failures.get(sampleManifest.id)).toBe('dispose_failed');
  });
});
