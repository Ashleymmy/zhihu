import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { db } from './db';
import { closeQueue } from './queue';
import { revocationStore } from './auth/revocation';
import { closeRateLimiter } from './utils/rateLimit';
import { flushMiniObservations } from './wechat/observability';

const app = createApp();
const server = app.listen(config.port, () => {
  if (config.runBackgroundJobs) app.locals.moduleRuntime.start();
  logger.info({ port: config.port }, 'opc listening');
});

async function shutdown() {
  app.locals.moduleRuntime.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await flushMiniObservations();
  await Promise.all([closeQueue(), revocationStore.close(), closeRateLimiter(), db.end()]);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
