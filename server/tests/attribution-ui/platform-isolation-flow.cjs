const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
module.exports = async ({ browser, port, out, enabled }) => {
  const results = [],
    mode = enabled ? 'sample' : 'disabled';
  for (const [role, user] of [
    ['admin', 'admin'],
    ['operations', 'review_ops'],
    ['finance', 'review_finance'],
    ['leader', 'leader_wang'],
    ['creator', 'creator_li'],
    ['independent', 'creator_chen'],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }),
      page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()));
    try {
      await page.goto(`http://127.0.0.1:${port}/app/login`);
      await page.locator('input[autocomplete="username"]').fill(user);
      await page.locator('input[type="password"]').fill('Review123456');
      const logging = page.waitForResponse((r) => r.url().endsWith('/core/auth/login'));
      await page.locator('button[type="submit"]').click();
      const login = await logging;
      assert.equal(login.status(), 200, await login.text());
      await page.waitForURL((u) => !u.pathname.endsWith('/login'));
      const headers = {
        Authorization: 'Bearer ' + (await login.json()).data.token,
        'X-Client-Id': login.request().headers()['x-client-id'],
      };
      const routes =
        role === 'finance'
          ? ['dashboard']
          : [
              'dashboard',
              ...(role === 'creator' || role === 'leader' || role === 'independent'
                ? ['task-hall', 'tasks']
                : ['tasks']),
            ];
      for (const route of routes) {
        await page.goto(`http://127.0.0.1:${port}/app/${route}`);
        await page
          .locator(route === 'dashboard' ? '.home-page[aria-busy="false"]' : '.platform-tasks[aria-busy="false"]')
          .waitFor();
        const response = await context.request.get(
          `http://127.0.0.1:${port}/api/v1/core/${route === 'dashboard' ? 'dashboard' : 'tasks'}`,
          { headers },
        );
        assert.equal(response.status(), 200);
        const data = (await response.json()).data;
        if (!enabled) {
          assert.equal(data.projects.length, 0);
          assert.equal(data.groups.length, 0);
        } else {
          assert.equal(data.projects.length, role === 'independent' ? 1 : 2);
          assert(data.projects.every((p) => p.name.startsWith('示例')));
        }
        assert(!(await page.locator('body').innerText()).includes('知乎'));
        assert.equal(await page.locator('.home-error').count(), 0);
        for (const width of [1440, 375]) {
          await page.setViewportSize({ width, height: 1050 });
          if ((await page.locator('.studio-app').getAttribute('data-menu-open')) === 'true')
            await page.locator('.menu-toggle').click();
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          await page.screenshot({
            path: path.join(out, `${mode}-${role}-${route}-${width}.png`),
            fullPage: true,
            animations: 'disabled',
          });
        }
        if (enabled && role === 'creator' && route === 'task-hall') {
          await page.getByRole('button', { name: '示例甲可领取任务', exact: true }).click();
          const dialog = page.getByRole('dialog');
          await dialog.getByRole('button', { name: '领取任务', exact: true }).click();
          await dialog.getByRole('button', { name: '确认领取任务', exact: true }).click();
          await page.getByText('任务已领取', { exact: true }).waitFor();
          await dialog.waitFor({ state: 'hidden' });
        }
        results.push({ role, route, widths: [1440, 375] });
      }
      const staff = ['admin', 'finance'].includes(role);
      if (role === 'operations')
        assert.equal(
          (await context.request.get(`http://127.0.0.1:${port}/api/v1/core/finance/workspace`, { headers })).status(),
          403,
        );
      else {
        const target = staff ? 'finance' : 'income';
        await page.goto(`http://127.0.0.1:${port}/app/${target}`);
        await page
          .locator(staff ? '.public-finance[aria-busy="false"]' : '.platform-income[aria-busy="false"]')
          .waitFor();
        const response = await context.request.get(
          `http://127.0.0.1:${port}/api/v1/core/${staff ? 'finance/workspace' : 'earnings/mine'}`,
          { headers },
        );
        assert.equal(response.status(), 200);
        const data = (await response.json()).data;
        if (staff) {
          assert.equal(data.length, enabled ? 2 : 0);
          if (enabled) {
            await page.getByRole('heading', { name: '已确认收益', exact: true }).waitFor();
            await page.getByRole('button', { name: '示例甲本人任务', exact: true }).first().waitFor();
          }
        } else {
          assert.equal(data.scopes.length, enabled ? (role === 'independent' ? 1 : 2) : 0);
          assert.equal(
            data.summary.amount,
            enabled ? (role === 'creator' ? '40.0000' : role === 'leader' ? '5.0000' : '0.0000') : '0.0000',
          );
        }
        assert(!(await page.locator('body').innerText()).includes('知乎'));
        for (const width of [1440, 375]) {
          await page.setViewportSize({ width, height: 1050 });
          if ((await page.locator('.studio-app').getAttribute('data-menu-open')) === 'true')
            await page.locator('.menu-toggle').click();
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          await page.screenshot({
            path: path.join(out, `${mode}-${role}-${target}-${width}.png`),
            fullPage: true,
            animations: 'disabled',
          });
        }
        if (enabled && staff) {
          await page.getByRole('searchbox', { name: '搜索内容或人员' }).fill('小李');
          await page.locator('.grid-totals').getByText('¥16.00', { exact: true }).waitFor();
          await page.getByRole('searchbox', { name: '搜索内容或人员' }).fill('');
          for (const project of ['1', '2']) {
            await page.locator('.finance-controls select').selectOption(project + ':' + project);
            const name = project === '1' ? '示例甲本人任务' : '示例乙本人任务';
            await page.getByRole('button', { name, exact: true }).first().waitFor();
            await page.getByRole('button', { name, exact: true }).first().click();
            await page.getByRole('dialog').waitFor();
            await page.getByRole('button', { name: '关闭详情' }).click();
            if (role === 'finance') {
              await page.getByRole('button', { name: '登记到账并开放提现', exact: true }).click();
              await page.getByLabel('到账流水或核对说明').fill('隔离示例款项核对');
              await page.getByRole('button', { name: '确认款项可用', exact: true }).click();
              await page.getByText('已登记款项可用，相关人员可以申请提现。', { exact: true }).waitFor();
            }
          }
        }
        if (enabled && role === 'creator') {
          for (const project of ['1', '2']) {
            await page.getByLabel('收款项目').selectOption(project + ':' + project);
            await page.getByRole('button', { name: '申请提现', exact: true }).click();
            await page.getByLabel('提现金额（元）').fill('1.00');
            await page.getByLabel('收款人姓名').fill('隔离测试人员');
            await page.getByLabel('收款银行或支付渠道').fill('隔离测试银行');
            await page.getByLabel('收款账号').fill('SAMPLE-ONLY-' + project);
            const sent = page.waitForResponse(
              (r) => r.url().endsWith('/core/finance/withdrawals') && r.request().method() === 'POST',
            );
            await page.getByRole('button', { name: '提交申请', exact: true }).click();
            const result = await sent;
            assert.equal(result.status(), 201, await result.text());
            await page.getByText('提现申请已提交，财务处理后会更新进度。', { exact: true }).waitFor();
            const wallet = await context.request.get(
              `http://127.0.0.1:${port}/api/v1/core/finance?projectId=${project}&accountId=${project}&moduleId=sample-api`,
              { headers },
            );
            assert.equal(wallet.status(), 200);
            const balance = (await wallet.json()).data;
            assert.equal(balance.withdrawals.length, 1);
            assert.equal(balance.balance.available, project === '1' ? '15.0000' : '23.0000');
            await page.screenshot({
              path: path.join(out, `sample-creator-project-${project}-withdrawal-375.png`),
              fullPage: true,
              animations: 'disabled',
            });
          }
        }
        results.push({ role, route: target, widths: [1440, 375] });
      }
      assert.deepEqual(errors, []);
      console.log(mode + ' ' + role + ' verified');
    } catch (e) {
      await page.screenshot({ path: path.join(out, 'failed-' + mode + '.png'), fullPage: true });
      fs.writeFileSync(path.join(out, 'failed-' + mode + '.txt'), await page.locator('body').innerText());
      throw e;
    } finally {
      await context.close();
    }
  }
  fs.writeFileSync(path.join(out, mode + '-results.json'), JSON.stringify({ mode, results }, null, 2));
};
