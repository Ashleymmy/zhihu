const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process'),
  { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright'),
  XLSX = require('xlsx');
const root = path.resolve(__dirname, '../..'),
  out = path.resolve(root, '../.opc-work/work-registration-ui');
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
      const form = page.getByRole('search', { name: '搜索作品' }),
        report = page.getByRole('region', { name: '每日作品登记统计' });
      await form.waitFor();
      const canSeeStats=['admin','operations','developer'].includes(role);
      assert.equal(await form.getByRole('checkbox').isChecked(), true);
      const apply = async (from, to) => {
        await form.getByLabel('登记开始日期').fill(from);
        await form.getByLabel('登记结束日期').fill(to);
        const response = page.waitForResponse(
          (r) =>
            r.url().includes(canSeeStats?'/core/work-registrations?':'/workbench/works?') &&
            new URL(r.url()).searchParams.get('from') === from &&
            new URL(r.url()).searchParams.get('to') === to,
        );
        await form.getByRole('button', { name: '搜索', exact: true }).click();
        const r = await response;
        assert.equal(r.status(), 200);
        return (await r.json()).data;
      };
      assert.equal((await apply('2026-10-10', '2026-10-12')).total, count);
      if(!canSeeStats){
        assert.equal(await report.count(),0);
        assert.equal(await page.getByRole('button',{name:'导出 Excel（含回传链接）'}).count(),0);
        for(const width of [1440,375]){await page.setViewportSize({width,height:1050});if((await page.locator('.studio-app').getAttribute('data-menu-open'))==='true')await page.locator('.menu-toggle').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,role+'-'+width+'.png'),fullPage:true,animations:'disabled'});}
        assert.deepEqual(errors,[]);results.push({role,dateFilter:true,statisticsAndExportHidden:true,widths:[1440,375]});await context.close();continue;
      }
      await report.getByText(`所选范围共 ${count} 条成功登记的作品`, { exact: true }).waitFor();
      await report.getByRole('button', { name: '2026-10-11，0 条作品，查看明细', exact: true }).waitFor();
      const downloaded = page.waitForEvent('download');
      await report.getByRole('button', { name: '导出 Excel（含回传链接）', exact: true }).click();
      const download = await downloaded;
      assert.match(download.suggestedFilename(), /^作品登记_2026-10-10_2026-10-12\.xlsx$/);
      const file = path.join(out, role + '.xlsx');
      await download.saveAs(file);
      const workbook = XLSX.readFile(file),
        rows = XLSX.utils.sheet_to_json(workbook.Sheets['作品明细']);
      assert.equal(rows.length, count);
      assert(rows.every((row) => row['回传链接'].endsWith('&mst=complete-tail')));
      assert(rows.every((row) => row['登记状态'] === '成功登记'));
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1050 });
        if ((await page.locator('.studio-app').getAttribute('data-menu-open')) === 'true')
          await page.locator('.menu-toggle').click();
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          role + ' horizontal overflow',
        );
        assert(await form.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
        await page.screenshot({
          path: path.join(out, role + '-' + width + '.png'),
          fullPage: true,
          animations: 'disabled',
        });
        await page.screenshot({path:path.join(out,role+'-viewport-'+width+'.png'),animations:'disabled'});
      }
      await report.getByRole('button', { name: '2026-10-11，0 条作品，查看明细', exact: true }).click();
      await report.getByText('所选范围共 0 条成功登记的作品', { exact: true }).waitFor();
      assert.equal(await form.getByLabel('登记开始日期').inputValue(), '2026-10-11');
      assert.equal(await form.getByLabel('登记结束日期').inputValue(), '2026-10-11');
      await form.getByRole('checkbox').uncheck();
      assert.equal((await apply('2026-10-10', '2026-10-12')).total, count * 2);
      await report.getByText(`所选范围共 ${count * 2} 条作品记录`, { exact: true }).waitFor();
      await form.getByRole('button', { name: '清空筛选', exact: true }).click();
      assert.equal(await form.getByLabel('登记开始日期').inputValue(), '');
      assert.equal(await form.getByRole('checkbox').isChecked(), true);
      assert.deepEqual(errors, []);
      results.push({
        role,
        successful: count,
        all: count * 2,
        widths: [1440, 375],
        dateFilter: true,
        zeroDayDrilldown: true,
        excel: true,
        fullLinks: true,
      });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ status: 'passed', results }, null, 2));
    console.log('作品日期、成功筛选、逐日明细与 Excel 八角色验收通过');
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
