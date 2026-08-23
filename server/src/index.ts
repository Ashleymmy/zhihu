import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { db } from './db';
import { startScheduler, stopScheduler } from './jobs';
import { closeQueue } from './queue';
import { revocationStore } from './auth/revocation';
import { closeRateLimiter } from './utils/rateLimit';

const server = createApp().listen(config.port, () => {
  startScheduler();
  logger.info({ port: config.port }, 'zhihu-bff listening');
});

async function shutdown() {
  stopScheduler();
  server.close();
  await Promise.all([closeQueue(), revocationStore.close(), closeRateLimiter(), db.end()]);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
