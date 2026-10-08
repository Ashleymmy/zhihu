const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process'),
  { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..'),
  out = path.resolve(root, '../改造/截图_2026-10-09/P2-history');
fs.mkdirSync(out, { recursive: true });
async function main() {
  const log = fs.createWriteStream(path.resolve(root, '../.opc-work/release/p2-history-host.log'));
  const host = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href,
      path.join(__dirname, 'review-host.ts'),
    ],
    {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, REMEDIATION_REVIEW: '1', OPC_REVIEW_FINANCE_HISTORY: '1' },
    },
  );
  host.stdout.pipe(log);
  host.stderr.pipe(log);
  let browser, page;
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('演示环境启动超时')), 120000);
      host.once('message', (data) => {
        clearTimeout(timer);
        resolve(data.port);
      });
      host.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error('演示环境退出 ' + code));
      });
    });
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    await require('./finance-history-flow.cjs')({ browser, port, out });
  } finally {
    await browser?.close();
    if (host.connected) host.send('stop');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        host.kill();
        resolve();
      }, 10000);
      host.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    log.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
