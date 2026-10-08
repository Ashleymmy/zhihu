const assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs');
module.exports = async ({ browser, port, out }) => {
  const results = [];
  for (const [role, username, password] of [
    ['admin', 'admin', 'Admin123456!'],
    ['finance', 'review_finance', 'Review123456'],
    ['operations', 'review_ops', 'Review123456'],
    ['leader', 'leader_wang', 'Review123456'],
    ['creator', 'creator_li', 'Review123456'],
    ['independent', 'creator_chen', 'Review123456'],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1050 } }),
      p = await ctx.newPage(),
      errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.setDefaultTimeout(15000);
    await p.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()));
    await p.goto(`http://127.0.0.1:${port}/app/login`);
    await p.locator('input[autocomplete="username"]').fill(username);
    await p.locator('input[type="password"]').fill(password);
    await p.locator('button[type="submit"]').click();
    await p.waitForURL((u) => !u.pathname.endsWith('/login'));
    const staff = ['admin', 'finance'].includes(role);
    for (const kind of role === 'operations'
      ? ['earnings']
      : staff
        ? ['earnings', 'withdrawals', 'appeals', 'settlements', 'data-import']
        : ['earnings', 'withdrawals', 'appeals']) {
      await p.goto(`http://127.0.0.1:${port}/app/modules/zhihu/${kind}`);
      if (role === 'operations') {
        await p.waitForURL((u) => !u.pathname.endsWith('/earnings'));
        assert.equal(await p.locator('.finance-history').count(), 0);
        results.push({ role, restricted: true });
        continue;
      }
      await p.waitForFunction(() => document.querySelector('.finance-history')?.getAttribute('aria-busy') === 'false');
      assert.equal(await p.locator('.finance-history [role="alert"]').count(), 0);
      assert.equal(await p.getByRole('button', { name: /上传|确认|审批|打款|生成结算|提交申诉|申请提现/ }).count(), 0);
      if (!staff) assert.match(await p.locator('.history-paging').first().innerText(), /共 1 条/);
      for (const width of [1440, 375]) {
        await p.setViewportSize({ width, height: 1050 });
        if (width === 375 && (await p.locator('.studio-app').getAttribute('data-menu-open')) === 'true')
          await p.locator('.menu-toggle').click();
        assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await p.screenshot({
          path: path.join(out, `${role}-${kind}-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
        await p
          .locator(width === 375 ? '.grid-card .row-title' : '.grid-row .row-title')
          .first()
          .click();
        const d = p.getByRole('dialog');
        await d.getByText('历史记录 · 只读').waitFor();
        if (['settlements', 'data-import'].includes(kind)) {
          await d.locator('.history-line').first().waitFor();
          assert.equal(await d.locator('[role="alert"]').count(), 0);
        }
        assert.equal(await d.locator('input,select,textarea').count(), 0);
        await p.screenshot({
          path: path.join(out, `${role}-${kind}-detail-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
        await d.getByRole('button', { name: '关闭详情' }).click();
      }
      results.push({ role, kind, widths: [1440, 375], readOnly: true });
    }
    assert.deepEqual(errors, []);
    await ctx.close();
    console.log(role + ' history verified');
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
};
