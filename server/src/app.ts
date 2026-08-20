import express from 'express';
import path from 'node:path';
import { allianceRouter } from './routes/alliance';
import { authRouter } from './routes/auth';
import { callbacksRouter } from './routes/callbacks';
import { channelsRouter } from './routes/channels';
import { compositionsRouter } from './routes/compositions';
import { earningsRouter } from './routes/earnings';
import { metaRouter } from './routes/meta';
import { metricsRouter } from './routes/metrics';
import { mcnRouter } from './routes/mcn';
import { plansRouter } from './routes/plans';
import { projectsRouter } from './routes/projects';
import { tasksRouter } from './routes/tasks';
import { teamRouter } from './routes/team';
import { storyItemsRouter } from './routes/story-items';
import { zhihuContentRouter } from './routes/zhihu-content';
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
  app.use('/api/v1/mcn-accounts', mcnRouter);
  app.use('/api/v1/projects', projectsRouter);
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
  app.use('/api/v1/story-items', storyItemsRouter);
  app.use('/api/v1/zhihu-content', zhihuContentRouter);

  /* ===== 营销门户与转化落地页（静态站点，公开访问）===== */
  const publicDir = path.resolve(__dirname, '../public');
  const portalDir = path.join(publicDir, 'portal');
  const landingDir = path.join(publicDir, 'landing');
  app.get('/', (_req, res) => res.redirect('/portal/'));
  app.use('/portal', express.static(portalDir));
  app.get('/portal/*', (_req, res) => res.sendFile(path.join(portalDir, 'index.html')));
  app.use('/landing', express.static(landingDir));
  app.get('/landing/*', (_req, res) => res.sendFile(path.join(landingDir, 'index.html')));
  // 原型引用的 manus-storage 图片不在产物里：有真实文件则直接托管，缺失时回退品牌占位图
  app.use('/manus-storage', express.static(path.join(publicDir, 'manus-storage')));
  app.get('/manus-storage/:file', (_req, res) => {
    res.type('image/svg+xml').send(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">` +
        `<rect width="800" height="600" fill="#f7f5f1"/>` +
        `<rect x="376" y="276" width="48" height="48" fill="#20292f"/>` +
        `<text x="400" y="340" text-anchor="middle" font-family="monospace" font-size="14" letter-spacing="4" fill="#5a6368">OPC</text>` +
        `<rect x="352" y="360" width="96" height="2" fill="#e66b3a"/>` +
      `</svg>`,
    );
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
