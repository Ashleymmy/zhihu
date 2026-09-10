import { projectsRouter } from './routes/projects';
import { Router } from 'express';
import type { BusinessModule } from '../../core/contracts';
import { zhihuManifest } from './manifest';
import { allianceRouter } from './routes/alliance';
import { callbacksRouter } from './routes/callbacks';
import { channelsRouter } from './routes/channels';
import { compositionsRouter } from './routes/compositions';
import { earningsRouter } from './routes/earnings';
import { metaRouter } from './routes/meta';
import { metricsRouter } from './routes/metrics';
import { plansRouter } from './routes/plans';
import { tasksRouter } from './routes/tasks';
import { storyItemsRouter } from './routes/story-items';
import { relayRouter } from './routes/relay';
import { zhihuContentRouter } from './routes/zhihu-content';
import { withdrawalsRouter } from './routes/withdrawals';
import { appealsRouter } from './routes/appeals';
import { dataImportRouter } from './routes/data-import';
import { toolsRouter } from './routes/tools';
import { registerJobs, startScheduler, stopScheduler } from './jobs';
import { logger } from '../../utils/logger';
export function createZhihuModule(): BusinessModule {
  const router = Router();
  const routes: Array<[string, Router]> = [
    ['projects', projectsRouter],
    ['plans', plansRouter],
    ['channels', channelsRouter],
    ['tasks', tasksRouter],
    ['compositions', compositionsRouter],
    ['meta', metaRouter],
    ['metrics', metricsRouter],
    ['earnings', earningsRouter],
    ['withdrawals', withdrawalsRouter],
    ['appeals', appealsRouter],
    ['callbacks', callbacksRouter],
    ['story-items', storyItemsRouter],
    ['finance', relayRouter],
    ['zhihu-content', zhihuContentRouter],
    ['data-import', dataImportRouter],
    ['admin-tools', toolsRouter],
  ];
  for (const [name, child] of routes) router.use('/' + name, child);
  registerJobs();
  return {
    manifest: zhihuManifest,
    router,
    beforeJson(app) {
      app.use('/api/v1/modules/zhihu/alliance/api', allianceRouter);
      app.use('/api/alliance/api', allianceRouter);
    },
    mountLegacy(app) {
      for (const [name, child] of routes)
        app.use(
          '/api/v1/' + name,
          (req, _res, next) => {
            logger.debug({ moduleId: 'zhihu', path: req.path }, 'legacy_route_used');
            next();
          },
          child,
        );
    },
    start: startScheduler,
    stop: stopScheduler,
  };
}
