const assert = require('node:assert/strict'),
  path = require('node:path');
module.exports = async function ({ browser, port, out }) {
  const credentials = {
    creator: ['creator_li', 'Review123456'],
    operations: ['review_ops', 'Review123456'],
    leader: ['leader_wang', 'Review123456'],
  };
  for (const [role, kind] of [
    ['creator', 'submit'],
    ['operations', 'return'],
    ['creator', 'resubmit'],
    ['leader', 'accept'],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }),
      page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.route('**/*', (route) =>
        new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
      );
      await page.goto(`http://127.0.0.1:${port}/app/login`);
      await page.locator('input[autocomplete="username"]').fill(credentials[role][0]);
      await page.locator('input[type="password"]').fill(credentials[role][1]);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL((url) => !url.pathname.endsWith('/login'));
      await page.goto(`http://127.0.0.1:${port}/app/tasks`);
      await page.waitForFunction(
        () => document.querySelector('.platform-tasks')?.getAttribute('aria-busy') === 'false',
      );
      await page.locator('.grid-row').getByRole('button', { name: '外部历史词', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: '外部历史词' });
      await drawer.getByRole('heading', { name: '任务进度' }).waitFor();
      const action =
        role === 'creator' ? '补登记历史作品' : role === 'operations' ? '退回补充历史作品' : '历史作品核验通过';
      await drawer.getByRole('button', { name: action, exact: true }).click();
      if (role === 'creator') {
        await drawer
          .getByLabel('作品链接', { exact: true })
          .fill('https://www.douyin.com/video/' + (kind === 'submit' ? '1234567' : '12345678'));
        await drawer.getByLabel('作品说明', { exact: true }).fill('补登记历史作品');
      }
      if (role === 'operations') await drawer.getByLabel('哪里需要补充', { exact: true }).fill('请补充完整发布链接');
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1050 });
        await page.screenshot({
          path: path.join(out, `history-task-${role}-${kind}-${width}.png`),
          animations: 'disabled',
        });
        assert(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      }
      await drawer.getByRole('button', { name: '确认' + action, exact: true }).click();
      await drawer.locator('.task-action-form').waitFor({ state: 'hidden' });
      assert.equal(await drawer.locator('[role="alert"]').count(), 0);
      if (role === 'creator')
        assert((await drawer.locator('.task-detail-status').innerText()).includes('历史作品待核验'));
      if (role === 'operations') assert((await drawer.innerText()).includes('请补充完整发布链接'));
      if (role === 'leader')
        assert.equal(
          await drawer
            .locator('.task-progress .done')
            .filter({ has: page.getByText('核验', { exact: true }) })
            .count(),
          1,
        );
      assert.deepEqual(errors, []);
      console.log(`Historical task ${role} ${kind} passed`);
    } catch (error) {
      await page.screenshot({ path: path.join(out, `history-task-failed-${role}.png`), fullPage: true });
      throw error;
    } finally {
      await context.close();
    }
  }
};
