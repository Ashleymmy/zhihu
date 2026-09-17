import express, { type Express } from 'express';
import path from 'node:path';
import fs from 'node:fs';
export function mountStatic(app: Express) {
  /* ===== 营销门户与转化落地页（静态站点，公开访问）===== */
  // 静态资源以进程工作目录为锚（dev 与生产 dist 下均为 server/）
  const cwd = process.cwd();
  const publicDir = fs.existsSync(path.join(cwd, 'public')) ? path.join(cwd, 'public') : path.resolve(cwd, 'server/public');
  const portalDir = path.join(publicDir, 'portal');
  const landingDir = path.join(publicDir, 'landing');
  app.get('/', (_req, res) => res.redirect('/app/'));
  app.use('/portal', express.static(portalDir));
  app.get('/portal/*', (_req, res) => res.sendFile(path.join(portalDir, 'index.html')));
  app.use('/landing', express.static(landingDir));
  app.get('/landing/*', (_req, res) => res.sendFile(path.join(landingDir, 'index.html')));
  // 原型引用的 manus-storage 图片不在产物里：有真实文件则直接托管，缺失时回退品牌占位图
  app.use('/manus-storage', express.static(path.join(publicDir, 'manus-storage')));
  app.get('/manus-storage/:file', (_req, res) => {
    res
      .type('image/svg+xml')
      .send(
        `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">` +
          `<rect width="800" height="600" fill="#f7f5f1"/>` +
          `<rect x="376" y="276" width="48" height="48" fill="#20292f"/>` +
          `<text x="400" y="340" text-anchor="middle" font-family="monospace" font-size="14" letter-spacing="4" fill="#5a6368">OPC</text>` +
          `<rect x="352" y="360" width="96" height="2" fill="#e66b3a"/>` +
          `</svg>`,
      );
  });

  // One SPA; legacy URLs keep their deep link but never select an identity.
  for (const role of ['admin', 'leader', 'creator']) {
    app.get([`/${role}`, `/${role}/*`], (req, res) => {
      res.redirect(302, req.originalUrl.replace(/^\/(admin|leader|creator)(?=\/|\?|$)/, '/app'));
    });
  }
  const localDist = path.resolve(cwd, 'apps/platform-admin/dist');
  const distDir = fs.existsSync(path.join(localDist, 'index.html'))
    ? localDist
    : path.resolve(cwd, '../apps/platform-admin/dist');
  app.use('/app', express.static(distDir));
  app.get('/app/*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}
