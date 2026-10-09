const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
module.exports = async ({ browser, port, out, date }) => {
  const base = `http://127.0.0.1:${port}`,
    results = [];
  for (const [role, username, password] of [
    ['admin', 'admin', 'Admin123456!'],
    ['finance', 'review_finance', 'Review123456'],
    ['operations', 'review_ops', 'Review123456'],
    ['leader', 'leader_wang', 'Review123456'],
    ['creator', 'creator_li', 'Review123456'],
    ['independent', 'creator_chen', 'Review123456'],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }),
      page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(20000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()));
    async function shot(label) {
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1050 });
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        if ((await page.locator('.studio-app').getAttribute('data-menu-open')) === 'true')
          await page.locator('.menu-toggle').click();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const d = page.locator('dialog[open]');
        if (await d.count()) {
          assert.equal(await d.count(), 1);
          assert(await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
          await d.screenshot({ path: path.join(out, `income-${role}-${label}-${width}.png`), animations: 'disabled' });
        } else
          await page.screenshot({
            path: path.join(out, `income-${role}-${label}-${width}.png`),
            fullPage: true,
            animations: 'disabled',
          });
      }
    }
    async function loaded() {
      await page.waitForFunction(
        () => document.querySelector('.platform-income')?.getAttribute('aria-busy') === 'false',
      );
      assert.equal(await page.locator('.platform-income .income-error').count(), 0);
    }
    try {
      await page.goto(base + '/app/login');
      await page.locator('input[autocomplete="username"]').fill(username);
      await page.locator('input[type="password"]').fill(password);
      const logging = page.waitForResponse((r) => r.url().endsWith('/core/auth/login'));
      await page.locator('button[type="submit"]').click();
      const login = await logging;
      assert.equal(login.status(), 200);
      await page.waitForURL((u) => !u.pathname.endsWith('/login'));
      const headers = {
        Authorization: 'Bearer ' + (await login.json()).data.token,
        'X-Client-Id': login.request().headers()['x-client-id'],
      };
      if (role === 'admin') {
        await page.goto(base + '/app/finance');
        await page.getByRole('radio', { name: /^拉活/ }).check();
        await page
          .locator('input[type="file"]')
          .setInputFiles({
            name: '平台收益拉活.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from(`日期,渠道名称,关键词,拉活量\n${date},知乎故事一代渠道,重生千金,4`),
          });
        await page.getByRole('button', { name: '上传并自动分析', exact: true }).click();
        await page.getByText('拉活：可计费 4 个 ¥6.40', { exact: true }).waitFor();
        await page.getByRole('button', { name: '核对并确认账单', exact: true }).click();
        await page.getByRole('checkbox', { name: '我已核对报表、人员和计算金额', exact: true }).check();
        await page.getByRole('button', { name: '确认核对结果', exact: true }).click();
        await page.getByText(/确认 2 条账单/).waitFor();
        await page.getByRole('button', { name: '登记到账并开放提现', exact: true }).click();
        await page.getByLabel('到账流水或核对说明').fill('隔离演示资金已备妥');
        await page.getByRole('button', { name: '确认款项可用', exact: true }).click();
        await page.getByText('已登记款项可用，相关人员可以申请提现。', { exact: true }).waitFor();
        await shot('confirmed');
      } else if (['finance', 'operations'].includes(role)) {
        const response = await context.request.get(base + `/api/v1/core/earnings/mine?from=${date}&to=${date}`, {
          headers,
        });
        assert.equal(response.status(), role === 'operations' ? 403 : 200);
        await page.goto(base + '/app/income');
        assert.equal(await page.locator('.platform-income').count(), 0);
        await shot('restricted');
      } else {
        await page.goto(base + '/app/income');
        await loaded();
        const expected = { leader: '98.60', creator: '164.80', independent: '24.00' }[role];
        assert((await page.locator('.income-totals').innerText()).includes('¥' + expected));
        await shot('overview');
        if (role === 'leader') {
          await page.setViewportSize({ width: 1440, height: 1050 });
          let response = page.waitForResponse(
            (r) => r.url().includes('/core/earnings/mine') && r.url().includes('group=team'),
          );
          await page.getByRole('button', { name: /^团队分成/ }).click();
          await response;
          await loaded();
          const text = await page.locator('.income-details').innerText();
          assert(!text.includes('¥160.00'));
          assert(text.includes('小李'));
          await shot('team');
          response = page.waitForResponse(
            (r) => r.url().includes('/core/earnings/mine') && r.url().includes('group=self'),
          );
          await page.getByRole('button', { name: /^我的作品/ }).click();
          await response;
          await loaded();
          assert((await page.locator('.income-totals').innerText()).includes('¥85.00'));
          await page.getByRole('button', { name: /^全部/ }).click();
          await loaded();
        }
        if (role !== 'independent') {
          await page.setViewportSize({ width: 1440, height: 1050 });
          await page
            .locator('.grid-row')
            .filter({ hasText: '重生千金' })
            .filter({ hasText: '拉新' })
            .getByRole('button', { name: '重生千金', exact: true })
            .click();
          const d = page.getByRole('dialog', { name: '重生千金', exact: true });
          await d
            .getByText(role === 'leader' ? '20单 × ¥0.5000 = ¥10.00' : '20单 × ¥8.0000 = ¥160.00', { exact: true })
            .waitFor();
          await d.locator('.income-history li').first().waitFor();
          await shot('calculation');
          await d.getByRole('button', { name: '查看任务与作品' }).click();
          await page
            .getByRole('dialog', { name: '重生千金', exact: true })
            .getByRole('heading', { name: '任务进度' })
            .waitFor();
          await shot('task');
          await page.goto(base + '/app/income');
          await loaded();
          const response = page.waitForResponse(
            (r) => r.url().includes('/core/earnings/mine') && r.url().includes('metricType=activation'),
          );
          await page.getByLabel('业绩类型').selectOption('activation');
          await response;
          await loaded();
          assert((await page.locator('.income-totals').innerText()).includes(role === 'leader' ? '¥1.60' : '¥4.80'));
          await shot('activation');
        }
        if (role === 'creator') {
          await page.getByRole('button', { name: '申请提现', exact: true }).click();
          await page.getByLabel('提现金额（元）').fill('1.00');
          await page.getByLabel('收款人姓名').fill('隔离测试人员');
          await page.getByLabel('收款银行或支付渠道').fill('隔离测试银行');
          await page.getByLabel('收款账号').fill('TEST-ONLY-ACCOUNT');
          await page.getByRole('button', { name: '提交申请', exact: true }).click();
          await page.getByText('提现申请已提交，财务处理后会更新进度。', { exact: true }).waitFor();
          await shot('withdrawal');
        }
        await page.goto(base + '/app/modules/zhihu/wallet');
        await page.waitForURL((u) => u.pathname === '/app/income');
        await loaded();
        await page.locator('.history-links summary').click();
        await page.locator('.history-links a').first().click();
        await page.locator('.finance-history').waitFor();
      }
      assert.deepEqual(errors, []);
      results.push({ role, widths: [1440, 375], errors });
      console.log(role + ' 平台收益验收通过');
    } catch (error) {
      console.log(
        await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          overflow: [...document.querySelectorAll('body *')]
            .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
            .map((el) => ({
              tag: el.tagName,
              class: el.className,
              right: el.getBoundingClientRect().right,
              width: el.getBoundingClientRect().width,
            }))
            .slice(0, 40),
        })),
      );
      await page.screenshot({ path: path.join(out, 'failed-income-' + role + '.png'), fullPage: true });
      fs.writeFileSync(path.join(out, 'failed-income-' + role + '.txt'), await page.locator('body').innerText());
      throw error;
    } finally {
      await context.close();
    }
  }
  fs.writeFileSync(path.join(out, 'platform-income-result.json'), JSON.stringify(results, null, 2));
};
