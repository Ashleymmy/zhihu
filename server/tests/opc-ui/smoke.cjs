const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const serverRoot = path.resolve(__dirname, '../..'),
  root = path.resolve(serverRoot, '..'),
  out = path.join(root, '.opc-work/ui');
fs.mkdirSync(out, { recursive: true });
async function host(modules) {
  const log = fs.createWriteStream(path.join(out, (modules || 'core') + '-server.log'));
  const child = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(path.join(serverRoot, 'node_modules/tsx/dist/loader.mjs')).href,
      path.join(__dirname, 'host.ts'),
    ],
    {
      cwd: serverRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        OPC_UI_SMOKE: '1',
        NODE_ENV: 'development',
        DEV_DEMO_AUTH: '1',
        OPC_MODULES: modules,
        DB_HOST: '127.0.0.1',
        DB_PORT: '1',
        DB_NAME: 'opc_ui_test',
        DB_USER: 'test',
        DB_PASS: 'test',
        QUEUE_DRIVER: 'memory',
        JWT_SECRET: 'test_only_ui_isolated_secret_32_chars',
        ZHIHU_ACCESS_TOKEN: 'mock_access_token',
        ZHIHU_SECRET_KEY: 'mock_secret_key',
        ZHIHU_API_BASE: 'https://open.zhihu.com',
        LOG_LEVEL: 'silent',
        DEV_DEMO_USERNAME: 'admin',
        DEV_DEMO_PASSWORD: 'admin123456',
        DEV_DEMO_LEADER_USERNAME: 'leader',
        DEV_DEMO_LEADER_PASSWORD: 'leader123456',
        DEV_DEMO_CREATOR_USERNAME: 'creator',
        DEV_DEMO_CREATOR_PASSWORD: 'creator123456',
      },
    },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('UI host timeout'));
    }, 15000);
    child.once('message', (msg) => {
      clearTimeout(timer);
      resolve(msg.port);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(Error('UI host exit ' + code));
    });
  });
  return {
    url: 'http://127.0.0.1:' + port,
    async close() {
      await new Promise((resolve) => {
        const timer = setTimeout(() => child.kill(), 3000);
        child.once('exit', () => {
          clearTimeout(timer);
          log.end();
          resolve();
        });
        child.send('stop');
      });
    },
  };
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.OPC_BROWSER_CHANNEL || 'msedge' }),
    results = [];
  try {
    for (const modules of ['', 'zhihu']) {
      for (const role of ['admin', 'leader', 'creator']) {
        const h = await host(modules);
        try {
          const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
            page = await context.newPage(),
            errors = [];
          page.on('pageerror', (e) => errors.push(e.message));
          await page.route('**/*', (route) =>
            new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
          );
          const base = h.url + '/app';
          const login = async () => {
            await page.locator('input[autocomplete="username"]').fill(role);
            await page.locator('input[type="password"]').fill(role + '123456');
            await page.locator('button[type="submit"]').click();
            await page.waitForURL('**/dashboard');
            await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
          };
          await page.goto(h.url + '/' + role + '/login');
          await login();
          assert.equal(await page.locator('.studio-nav').getByText('邮件 / Excel 导入', { exact: true }).count(), 0);
          await page.screenshot({
            path: path.join(out, (modules || 'core') + '-' + role + '-desktop.png'),
            fullPage: true,
          });
          await page.goto(base + '/modules');
          await page.getByRole('heading', { name: '业务模块', exact: true }).waitFor();
          if (modules) {
            await page.getByRole('link', { name: '进入业务', exact: true }).click();
            await page.getByRole('navigation', { name: '知乎业务导航' }).waitFor();
            await page.getByRole('navigation', { name: '知乎业务导航' }).getByRole('link', { name: '推广计划', exact: true }).click();
            await page.waitForURL('**/modules/zhihu/plans');
            if (role === 'admin') {
              await page.goto(base + '/modules/zhihu/data-import');
              await page.waitForURL('**/modules/zhihu/data-import');
              await page.screenshot({ path: path.join(out, 'zhihu-email.png'), fullPage: true });
            }
          } else {
            await page.getByText('未启用', { exact: true }).waitFor();
            await page.goto(base + '/plans');
            await page.waitForURL('**/app/dashboard');
            await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
          }
          await page.goto(base + '/finance');
          await page.getByRole('heading', { name: role === 'admin' ? '财务中心' : '收入与提现', exact: true }).waitFor();
          await page.goto(base + '/projects');
          await page.getByRole('heading', { name: /项目/ }).first().waitFor();
          await page.goto(base + '/dashboard');
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
          assert(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
            'mobile overflow',
          );
          await page.screenshot({
            path: path.join(out, (modules || 'core') + '-' + role + '-mobile.png'),
            fullPage: true,
          });
          await page.setViewportSize({ width: 1440, height: 1000 });
          await page.getByRole('button', { name: '退出登录' }).click();
          await page.waitForURL('**/login');
          await login();
          await page.goto(base + '/modules');
          await page.getByRole('heading', { name: '业务模块', exact: true }).waitFor();
          if (modules) await page.getByRole('link', { name: '进入业务', exact: true }).waitFor();
          assert.deepEqual(errors, []);
          results.push({ mode: modules || 'core', role, status: 'passed' });
          console.log('PASS', modules || 'core', role);
          await context.close();
        } finally {
          await h.close();
        }
      }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
