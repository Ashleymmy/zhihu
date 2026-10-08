import type { Server } from 'node:http';
import type { ModuleRuntime } from './core/module-runtime';
import { db } from './db';
import { closeQueue } from './queue';
import { revocationStore } from './auth/revocation';
import { closeRateLimiter } from './utils/rateLimit';
import { flushMiniObservations } from './wechat/observability';

export function createShutdown(server: Server, runtime?: ModuleRuntime) {
  let pending: Promise<void> | undefined;
  return () =>
    (pending ??= (async () => {
      runtime?.stop();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      // Bull.close waits for in-flight jobs. They still need SQL and module clients.
      await closeQueue();
      await flushMiniObservations();
      try {
        await runtime?.dispose();
      } finally {
        await Promise.all([revocationStore.close(), closeRateLimiter(), db.end()]);
      }
    })());
}
