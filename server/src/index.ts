import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { createShutdown } from './shutdown';
import { startRelationCheck } from './core/relation-check-job';

const app = createApp();
const server = app.listen(config.port, () => {
  if (config.runBackgroundJobs) {
    app.locals.moduleRuntime.start();
    startRelationCheck();
  }
  logger.info({ port: config.port }, 'opc listening');
});

const shutdown = createShutdown(server, app.locals.moduleRuntime);

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
