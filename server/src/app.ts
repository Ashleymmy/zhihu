import express from 'express';
import { allianceRouter } from './routes/alliance';
import { authRouter } from './routes/auth';
import { callbacksRouter } from './routes/callbacks';
import { channelsRouter } from './routes/channels';
import { compositionsRouter } from './routes/compositions';
import { earningsRouter } from './routes/earnings';
import { metaRouter } from './routes/meta';
import { metricsRouter } from './routes/metrics';
import { plansRouter } from './routes/plans';
import { tasksRouter } from './routes/tasks';
import { teamRouter } from './routes/team';
import { withdrawalsRouter } from './routes/withdrawals';
import { errorHandler, notFound } from './middleware/errors';
import { registerJobs } from './jobs';

export function createApp() {
  registerJobs();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use('/api/alliance/api', allianceRouter); // 知乎联盟 API 透传必须先于全局 JSON parser
  app.use(express.json({ limit: '1mb' }));
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/meta', metaRouter);
  app.use('/api/v1/plans', plansRouter);
  app.use('/api/v1/metrics', metricsRouter);
  app.use('/api/v1/team', teamRouter);
  app.use('/api/v1/compositions', compositionsRouter);
  app.use('/api/v1/earnings', earningsRouter);
  app.use('/api/v1/withdrawals', withdrawalsRouter);
  app.use('/api/v1/channels', channelsRouter);
  app.use('/api/v1/tasks', tasksRouter);
  app.use('/api/v1/callbacks', callbacksRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
