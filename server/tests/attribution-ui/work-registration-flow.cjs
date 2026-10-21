const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process'),
  { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright'),
  XLSX = require('xlsx');
const root = path.resolve(__dirname, '../..'),
  out = path.resolve(root, '../.opc-work/keyword-callback-ui');
fs.mkdirSync(out, { recursive: true });
async function main() {
  const log = fs.createWriteStream(path.join(out, 'host.log'));
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
      env: { ...process.env, REMEDIATION_REVIEW: '1', OPC_REVIEW_WORK_REGISTRATIONS: '1' },
    },
  );
  host.stdout.pipe(log);
  host.stderr.pipe(log);
  let browser;
  const results = [];
  try {
    const { port } = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Error('隔离演示启动超时')), 120000);
      host.once('message', (r) => {
        clearTimeout(t);
        resolve(r);
      });
      host.once('exit', (c) => {
        clearTimeout(t);
        reject(Error('演示退出 ' + c));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    for (const [role, username, password, count] of [
      ['admin', 'admin', 'Admin123456!', 6],
      ['operations', 'review_ops', 'Review123456', 6],
      ['developer', 'review_developer', 'Review123456', 6],
      ['operator', 'review_operator', 'Review123456', 6],
      ['leader', 'leader_wang', 'Review123456', 4],
      ['creator', 'creator_li', 'Review123456', 2],
      ['independent', 'creator_chen', 'Review123456', 2],
      ['finance', 'review_finance', 'Review123456', 0],
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }),
        page = await context.newPage(),
        errors = [];
      page.setDefaultTimeout(20000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()));
      await page.goto(base + '/app/login');
      await page.getByRole('button', { name: '使用原账号登录', exact: true }).click();
      await page.locator('input[autocomplete="username"]').fill(username);
      await page.locator('input[type="password"]').fill(password);
      const logging = page.waitForResponse((r) => r.url().endsWith('/core/auth/login'));
      await page.locator('button[type="submit"]').click();
      assert.equal((await logging).status(), 200);
      await page.waitForURL((u) => !u.pathname.endsWith('/login'));
      await page.goto(base + '/app/works');
      if (role === 'finance') {
        await page.waitForURL((u) => u.pathname !== '/app/works');
        results.push({ role, workPageRemainsRestricted: true });
        await context.close();
        continue;
      }
      const form = page.getByRole('search', { name: '搜索作品' });
      const report = page.getByRole('region', { name: '作品回传导出' });
      const canExport = ['admin', 'operations', 'developer'].includes(role);
      await form.waitFor();
      assert.equal(await form.getByRole('checkbox').isChecked(), false);
      const apply = async (from, to) => {
        await form.getByLabel('回传开始日期').fill(from);
        await form.getByLabel('回传结束日期').fill(to);
        const response = page.waitForResponse(
          (r) =>
            r.url().includes('/workbench/works?') &&
            new URL(r.url()).searchParams.get('from') === from &&
            new URL(r.url()).searchParams.get('to') === to,
        );
        await form.getByRole('button', { name: '搜索', exact: true }).click();
        const r = await response;
        assert.equal(r.status(), 200);
        return (await r.json()).data;
      };
      assert.equal((await apply('2026-10-10', '2026-10-12')).total, count * 2);
      assert.equal(await report.count(), canExport ? 1 : 0);
      const capture = async (prefix) => {
        for (const width of [1440, 375]) {
          await page.setViewportSize({ width, height: 1050 });
          if ((await page.locator('.studio-app').getAttribute('data-menu-open')) === 'true')
            await page.locator('.menu-toggle').click();
          assert(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            prefix + ' overflow',
          );
          await page.screenshot({
            path: path.join(out, role + '-' + prefix + '-' + width + '.png'),
            fullPage: true,
            animations: 'disabled',
          });
        }
      };
      if (canExport) {
        const downloaded = page.waitForEvent('download');
        await report.getByRole('button', { name: '导出回传 Excel', exact: true }).click();
        const download = await downloaded;
        assert.match(download.suggestedFilename(), /^作品回传_2026-10-10_2026-10-12\.xlsx$/);
        const file = path.join(out, role + '-works.xlsx');
        await download.saveAs(file);
        const rows = XLSX.utils.sheet_to_json(XLSX.readFile(file).Sheets['作品明细']);
        assert.equal(rows.length, count * 2);
        assert(rows.some((r) => r['登记状态'] === '提交失败'));
        assert(rows.every((r) => r['回传链接'].endsWith('&mst=complete-tail')));
        assert(
          rows.every((r) => r['原著小说名'] && r['作品分类'] === '图文' && r['作品子分类'] === '实拍' && r['提交账号']),
        );
        assert(rows.some((r) => r['团长名'] === '王团长'));
      }
      await capture('works');
      if (canExport) {
        await form.getByLabel('回传开始日期').fill('2026-10-11');
        await form.getByLabel('回传结束日期').fill('2026-10-11');
        const downloaded = page.waitForEvent('download');
        await report.getByRole('button', { name: '导出回传 Excel', exact: true }).click();
        const file = path.join(out, role + '-empty-day.xlsx');
        await (await downloaded).saveAs(file);
        assert.equal(XLSX.utils.sheet_to_json(XLSX.readFile(file).Sheets['作品明细']).length, 0);
      }
      await form.getByRole('checkbox').check();
      assert.equal((await apply('2026-10-10', '2026-10-12')).total, count);
      await form.getByRole('button', { name: '清空筛选', exact: true }).click();
      assert.equal(await form.getByRole('checkbox').isChecked(), false);
      const taskResponse = page.waitForResponse((r) => r.url().includes('/core/tasks?'));
      await page.goto(base + '/app/tasks');
      const keywordReport = page.getByRole('region', { name: '关键词日期导出' });
      await page.getByPlaceholder('输入任务名称或说明').waitFor();
      const taskResult = await taskResponse;
      assert.equal(taskResult.status(), 200);
      if (canExport) await keywordReport.waitFor();
      assert.equal(await keywordReport.count(), canExport ? 1 : 0);
      if (canExport) {
        await keywordReport.getByLabel('绑定开始日期').fill('2026-10-10');
        await keywordReport.getByLabel('绑定结束日期').fill('2026-10-12');
        const downloaded = page.waitForEvent('download');
        await keywordReport.getByRole('button', { name: '导出关键词 Excel', exact: true }).click();
        const download = await downloaded;
        assert.match(download.suggestedFilename(), /^关键词绑定_2026-10-10_2026-10-12\.xlsx$/);
        const file = path.join(out, role + '-keywords.xlsx');
        await download.saveAs(file);
        const rows = XLSX.utils.sheet_to_json(XLSX.readFile(file).Sheets['关键词绑定明细']);
        assert(rows.some((r) => r['关键词'] === '日期导出失败验收' && r['创建状态'] === '创建失败'));
        assert.equal(rows.filter((r) => r['关键词'].startsWith('每日登记验收')).length, 3);
        await keywordReport.getByRole('button', { name: '本周至今', exact: true }).click();
        assert(await keywordReport.getByLabel('绑定开始日期').inputValue());
        await keywordReport.getByLabel('绑定开始日期').fill('2026-10-13');
        await keywordReport.getByLabel('绑定结束日期').fill('2026-10-10');
        await keywordReport.getByRole('button', { name: '导出关键词 Excel', exact: true }).click();
        await keywordReport.getByRole('alert').getByText('开始日期不能晚于结束日期', { exact: false }).waitFor();
        await keywordReport.getByLabel('绑定开始日期').fill('2026-10-10');
        await keywordReport.getByLabel('绑定结束日期').fill('2026-10-12');
      }
      await capture('keywords');
      assert.deepEqual(errors, []);
      results.push({
        role,
        widths: [1440, 375],
        dateFilter: true,
        keywordExport: canExport,
        callbackExport: canExport,
        failuresIncluded: canExport,
      });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ status: 'passed', results }, null, 2));
    console.log('关键词绑定日期、首次回传日期和两种 Excel 八角色验收通过');
  } finally {
    await browser?.close();
    if (host.connected) {
      host.send('stop');
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          host.kill();
          resolve();
        }, 20000);
        host.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    log.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
