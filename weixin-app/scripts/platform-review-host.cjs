// Disposable real API + loopback-only transport copy for WeChat IDE acceptance.
// Does not deploy cloud functions or change the checked-in mini-program transport.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const work = path.join(root, '.opc-work/p2-mini-ui');
const project = path.join(work, 'project');
const secret = 'isolated_mini_ui_bridge_secret_only_2026';
const mode = process.env.MINI_REVIEW_MODE || 'zhihu';
if (!['zhihu', 'sample', 'disabled'].includes(mode)) throw Error('Invalid isolated review mode');
fs.mkdirSync(work, { recursive: true });
const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'server/node_modules/tsx/dist/loader.mjs')).href,
  path.join(root, 'server/tests/attribution-ui/' + (mode === 'zhihu' ? 'review-host.ts' : 'platform-isolation-host.ts'))], {
  cwd: path.join(root, 'server'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: { ...process.env, REMEDIATION_REVIEW: '1', OPC_REVIEW_FINANCE_HISTORY: '1',
    WECHAT_BRIDGE_SECRET: secret, WECHAT_APP_ID: 'wx22b91776ccf37354', MINI_CONTENT_SAFETY_REQUIRED: '1',
    OPC_REVIEW_SAMPLE: mode === 'sample' ? '1' : '0' },
});
const log = fs.createWriteStream(path.join(work, 'host.log'));
child.stdout.pipe(log); child.stderr.pipe(log);
let proxy, stopping = false;
function stop() { if (stopping) return; stopping = true; proxy?.close(); if (child.connected) child.send('stop'); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
child.on('exit', code => { proxy?.close(); process.exitCode = stopping ? 0 : code || 1; });
child.once('message', async ({ port }) => {
  if (!Number.isInteger(port) || port < 1) throw Error('Invalid isolated API port');
  const bridge = require('../cloudfunctions/opc-bridge/bridge').createBridge({
    context: () => ({ APPID: 'wx22b91776ccf37354', OPENID: 'isolated_mini_ui_openid_2026' }), secret,
    environment: 'isolated-local-review', version: 'local',
    // The only external-service double: never send demo text to Tencent.
    check: async () => ({ errCode: 0, result: { suggest: 'pass' }, traceId: 'isolated-only' }),
    send: async (_productionUrl, payload, headers) => {
      const response = await fetch('http://127.0.0.1:' + port + '/api/v1/mini/bridge', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'User-Agent': 'isolated-review' }, body: payload,
      });
      return { ...(await response.json()), statusCode: response.status };
    },
  });
  proxy = http.createServer(async (req, res) => {
    if (req.url === '/stop' && req.method === 'POST') { res.end('stopping'); stop(); return; }
    if (req.url !== '/rpc' || req.method !== 'POST') { res.writeHead(404).end(); return; }
    try {
      let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 1000000) throw Error('Too large'); }
      const { path: route, method = 'GET', data = {}, token } = JSON.parse(text);
      if (!/^\/(core|modules\/zhihu)\/[A-Za-z0-9_/%.-]+$/.test(route) || route.includes('..') || !['GET','POST','PATCH','PUT','DELETE'].includes(method)) throw Error('Invalid review route');
      const body = await bridge({ path: route, method, data, token });
      log.write(JSON.stringify({ method, route, status: body.statusCode }) + '\n');
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ statusCode: body.statusCode || (body.code === 0 ? 200 : 500), data: body }));
    } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ statusCode: 500, data: { message: error.message } })); }
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const proxyPort = proxy.address().port;
  require('./platform-review-project.cjs')(proxyPort);
  fs.writeFileSync(path.join(work, 'session.json'), JSON.stringify({ port, proxyPort, project, mode, endpoint: 'ws://127.0.0.1:9423' }, null, 2));
  console.log('ISOLATED_MINI_READY', JSON.stringify({ port, proxyPort, project }));
});
