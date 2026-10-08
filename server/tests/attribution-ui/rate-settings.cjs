// Real authentication, seeded review-demo service and RateSettings component.
// The independent Vite fixture serves only the shared drawer, without mocking APIs.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process'),
  { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..'),
  out = path.resolve(root, '../改造/截图_2026-10-09/P1-8-rates');
fs.mkdirSync(out, { recursive: true });
async function main() {
  const log = fs.createWriteStream(path.resolve(root, '../.opc-work/release/rate-settings-host.log'));
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
      env: { ...process.env, REMEDIATION_REVIEW: '1' },
    },
  );
  host.stdout.pipe(log);
  host.stderr.pipe(log);
  let browser;
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Review service start timeout')), 120000);
      host.once('message', (m) => {
        clearTimeout(timer);
        resolve(m.port);
      });
      host.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error('Review host exited ' + code));
      });
    });
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const results = [];
    for (const [role, username, password] of [
      ['admin', 'admin', 'Admin123456!'],
      ['finance', 'review_finance', 'Review123456'],
      ['operations', 'review_ops', 'Review123456'],
      ['leader', 'leader_wang', 'Review123456'],
      ['creator', 'creator_li', 'Review123456'],
      ['independent', 'creator_chen', 'Review123456'],
    ]) {
      const context = await browser.newContext(),
        page = await context.newPage(),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${port}/app/login`);
      await page.locator('input[autocomplete="username"]').fill(username);
      await page.locator('input[type="password"]').fill(password);
      const logged = page.waitForResponse((r) => r.url().endsWith('/core/auth/login'));
      await page.locator('button[type="submit"]').click();
      const response = await logged;
      assert.equal(response.status(), 200);
      const token = (await response.json()).data.token,
        client = response.request().headers()['x-client-id'];
      await page.waitForURL((url) => !url.pathname.endsWith('/login'));
      await page.addInitScript(
        (value) => {
          window.rateTest = value;
        },
        { token, client },
      );
      await page.route('**/api/v1/core/rates**', async (route) => {
        const incoming = new URL(route.request().url());
        const result = await route.fetch({ url: `http://127.0.0.1:${port}${incoming.pathname}${incoming.search}` });
        await route.fulfill({ response: result });
      });
      await page.goto((process.env.RATE_COMPONENT_URL || 'http://127.0.0.1:34421') + '/?rates=1');
      await page.getByRole('button', { name: '查看与设置单价' }).click();
      const dialog = page.getByRole('dialog', { name: '单价设置' }),
        allowed = ['admin', 'finance'].includes(role);
      if (allowed) await dialog.getByRole('heading', { name: '新增未来单价' }).waitFor();
      else await dialog.getByText('这里需要财务权限', { exact: true }).waitFor();
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.screenshot({ path: path.join(out, `${role}-${width}.png`), fullPage: true });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        assert(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      }
      if (role === 'finance') {
        await dialog.getByLabel('业绩类型').selectOption('activation');
        await dialog.getByLabel('达人单价（元 / 个）').fill('1.25');
        await dialog.getByLabel('团长单价（元 / 个）').fill('1.65');
        const published = page.waitForResponse((r) => r.url().includes('/rates') && r.request().method() === 'POST');
        await dialog.getByRole('button', { name: '发布新单价', exact: true }).click();
        const result = await published;
        assert.equal(result.status(), 201, await result.text());
        await dialog.getByText(/^已发布，/).waitFor();
        const listing = await context.request.get(
          `http://127.0.0.1:${port}/api/v1/core/rates?projectId=1&moduleId=zhihu`,
          { headers: { Authorization: 'Bearer ' + token, 'X-Client-Id': client } },
        );
        const values = (await listing.json()).data.versions;
        const latest = values
          .filter((v) => v.metricType === 'activation' && v.ruleCode === 'creator')
          .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
        assert.equal(latest.unitPrice, '1.2500');
        await page.waitForFunction(() => {
          const drawer = document.querySelector('dialog');
          return drawer?.querySelector('.rate-settings')?.getAttribute('aria-busy') === 'false' && drawer.scrollTop === 0;
        });
        for (const width of [1440, 375]) {
          await page.setViewportSize({ width, height: 1100 });
          const message = await dialog.getByText(/^已发布，/).boundingBox(), header = await dialog.locator('header').boundingBox();
          assert(message && header && message.y >= header.y + header.height, '发布结果不能被固定标题遮挡');
          await page.screenshot({ path: path.join(out, `published-${width}.png`), fullPage: true });
        }
        await dialog.locator('summary').click();
        assert((await dialog.getByText('¥1.25 / 个', { exact: true }).count()) > 0);
      }
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(
        await page.getByRole('button', { name: '查看与设置单价' }).evaluate((el) => el === document.activeElement),
        true,
      );
      assert.deepEqual(errors, []);
      results.push({ role, allowed, widths: [1440, 375], consoleErrors: errors.length });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally {
    if (browser) await browser.close();
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
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
