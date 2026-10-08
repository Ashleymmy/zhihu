const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process'),
  { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..'),
  out = process.env.OPC_REVIEW_OUTPUT ? path.resolve(process.env.OPC_REVIEW_OUTPUT) : path.resolve(root, '../改造/截图_2026-10-09/P2-tasks');
fs.mkdirSync(out, { recursive: true });
async function main() {
  const log = fs.createWriteStream(path.resolve(root, '../.opc-work/release/p2-tasks-host.log'));
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
    const results = [];
    for (const [role, username, password, word] of process.env.OPC_REVIEW_TASK_HISTORY_ONLY === '1'
      ? []
      : [
          ['admin', 'admin', 'Admin123456!', '悬疑短篇'],
          ['operations', 'review_ops', 'Review123456', '重生千金'],
          ['leader', 'leader_wang', 'Review123456', '修仙爽文'],
          ['creator', 'creator_li', 'Review123456', '重生千金'],
          ['independent', 'creator_chen', 'Review123456', '古言虐恋'],
        ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
      page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.setDefaultTimeout(15000);
      await page.route('**/*', (route) =>
        new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
      );
      await page.goto(`http://127.0.0.1:${port}/app/login`);
      await page.locator('input[autocomplete="username"]').fill(username);
      await page.locator('input[type="password"]').fill(password);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL((url) => !url.pathname.endsWith('/login'));
      await page.goto(`http://127.0.0.1:${port}/app/tasks`);
      await page.waitForFunction(
        () => document.querySelector('.platform-tasks')?.getAttribute('aria-busy') === 'false',
      );
      assert.equal(await page.locator('.platform-tasks [role="alert"]').count(), 0);
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1050 });
        if (width === 375) {
          if ((await page.locator('.studio-app').getAttribute('data-menu-open')) === 'true')
            await page.locator('.menu-toggle').click();
          await page.waitForFunction(
            () => getComputedStyle(document.querySelector('.studio-backdrop')).opacity === '0',
          );
        }
        await page.screenshot({
          path: path.join(out, `${role}-list-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page
          .locator(width === 375 ? '.grid-card' : '.grid-row')
          .filter({ has: page.getByRole('button', { name: word, exact: true }) })
          .getByRole('button', { name: word, exact: true })
          .click();
        const drawer = page.getByRole('dialog', { name: word, exact: true });
        await drawer.getByRole('heading', { name: '任务进度' }).waitFor();
        assert.equal(await drawer.locator('.task-progress li').count(), role === 'operations' ? 5 : 8);
        assert.equal(await drawer.locator('[role="alert"]').count(), 0);
        await page.screenshot({
          path: path.join(out, `${role}-detail-${width}.png`),
          fullPage: false,
          animations: 'disabled',
        });
        assert(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
        await drawer.getByRole('button', { name: '关闭详情' }).click();
      }
      const card = page.locator('.grid-card').filter({ has: page.getByRole('button', { name: word, exact: true }) });
      await card.getByRole('button', { name: word, exact: true }).click();
      const drawer = page.getByRole('dialog', { name: word, exact: true });
      await drawer.getByRole('heading', { name: '任务进度' }).waitFor();
      if (role === 'admin' || role === 'leader') {
        const label = role === 'admin' ? '指定执行人' : '分配执行人';
        await drawer.getByRole('button', { name: label, exact: true }).click();
        await drawer.getByLabel('执行人', { exact: true }).selectOption(role === 'admin' ? '5' : '4');
        await page.screenshot({
          path: path.join(out, `${role}-inline-action-375.png`),
          fullPage: false,
          animations: 'disabled',
        });
        await drawer.getByRole('button', { name: '确认' + label, exact: true }).click();
        await page.waitForFunction(() =>
          document.querySelector('.platform-tasks [role="status"]')?.textContent?.includes('更新'),
        );
        await drawer.locator('.task-action-form').waitFor({ state: 'hidden' });
        assert((await drawer.locator('.task-detail-status').innerText()).includes(role === 'admin' ? '小陈' : '小张'));
      } else {
        await drawer.getByRole('button', { name: '编辑小说资料', exact: true }).click();
        await drawer.getByLabel('小说原名', { exact: true }).fill('任务详情验收小说');
        await drawer.getByLabel('小说原文链接', { exact: true }).fill('https://www.zhihu.com/market/test');
        await page.screenshot({
          path: path.join(out, `${role}-inline-action-375.png`),
          fullPage: false,
          animations: 'disabled',
        });
        await drawer.getByRole('button', { name: '确认编辑小说资料', exact: true }).click();
        await drawer.locator('.task-action-form').waitFor({ state: 'hidden' });
        assert((await drawer.locator('.task-facts').innerText()).includes('任务详情验收小说'));
      }
      assert.equal(await drawer.locator('[role="alert"]').count(), 0);
      await drawer.getByRole('button', { name: '关闭详情' }).click();
      await page.locator('.platform-tasks .primary-action').click();
      await page.locator('form.confirm-box').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('create'), '1');
      assert.deepEqual(errors, []);
      results.push({ role, widths: [1440, 375], detail: true, inlineAction: true, createEntry: true, errors });
      await context.close();
    }
    if (process.env.OPC_REVIEW_TASK_HISTORY_ONLY === '1') {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
      await require('./name-matching-flow.cjs')({ browser, port, out, date });
      await require('./historical-task-flow.cjs')({ browser, port, out });
      fs.writeFileSync(
        path.join(out, 'historical-results.json'),
        JSON.stringify({
          roles: ['creator', 'operations', 'leader'],
          widths: [1440, 375],
          historySubmitReturnAccept: true,
        }),
      );
      return;
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } catch (error) {
    if (page) {
      console.log('FAILURE', page.url(), (await page.locator('body').innerText()).slice(-1800));
      await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true });
    }
    throw error;
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
