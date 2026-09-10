import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { httpLoggerOptions } from '../utils/logger';
import { metricsHandler, metricsMiddleware } from '../utils/metrics';
import { apiRateLimit } from '../middleware/apiRateLimit';
import { errorHandler, notFound } from '../middleware/errors';
import { authRouter } from '../routes/auth';
import { teamRouter } from '../routes/team';
import { projectsRouter } from '../routes/projects';
import { mcnRouter } from '../routes/mcn';
import { adminToolsRouter, announcementsRouter, auditLogsRouter } from '../routes/admin-tools';
import { createPlatformRouter } from './routes';
import { ModuleRuntime } from './module-runtime';
import { setModulePermissions } from '../auth/permissions';

export function createCoreApp(runtime = new ModuleRuntime(), mountStatic?: (app: Express) => void) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(pinoHttp(httpLoggerOptions));
  app.use(metricsMiddleware);
  app.get('/healthz', (_req, res) => res.json({ status: 'ok', service: 'opc' }));
  app.get('/metrics', metricsHandler);
  setModulePermissions(runtime.all().map((m) => m.manifest));
  for (const module of runtime.all()) {
    const before = express();
    before.disable('x-powered-by');
    module.beforeJson?.(before);
    app.use((req, res, next) => (runtime.get(module.manifest.id) ? before(req, res, next) : next()));
  }
  app.use(express.json({ limit: '1mb' }));
  const publicRoutes: Array<[string, express.Router]> = [
    ['auth', authRouter],
    ['team', teamRouter],
    ['projects', projectsRouter],
    ['mcn-accounts', mcnRouter],
    ['admin-tools', adminToolsRouter],
    ['announcements', announcementsRouter],
    ['audit-logs', auditLogsRouter],
  ];
  // Login/refresh also retain their own dedicated limiter.
  app.use('/api/v1', apiRateLimit());
  for (const [name, router] of publicRoutes) app.use('/api/v1/core/' + name, router);
  app.use('/api/v1/core', createPlatformRouter(runtime));
  for (const module of runtime.all()) {
    app.use('/api/v1/modules/' + module.manifest.id, (req, res, next) =>
      runtime.get(module.manifest.id) ? module.router(req, res, next) : next(),
    );
    const legacy = express();
    legacy.disable('x-powered-by');
    module.mountLegacy?.(legacy);
    app.use((req, res, next) => (runtime.get(module.manifest.id) ? legacy(req, res, next) : next()));
  }
  for (const [name, router] of publicRoutes) app.use('/api/v1/' + name, router);
  mountStatic?.(app);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
