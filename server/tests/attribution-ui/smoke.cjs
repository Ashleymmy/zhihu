const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const XLSX = require('xlsx');
const serverRoot = path.resolve(__dirname, '../..'),
  out = path.resolve(serverRoot, '../.opc-work/attribution-ui');
fs.mkdirSync(out, { recursive: true });
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
async function main() {
  const log = fs.createWriteStream(path.join(out, 'host.log'));
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
      env: { ...process.env, ATTRIBUTION_UI_TEST: '1' },
    },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let browser;
  const pages = {};
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('隔离 UI 启动超时')), 90000);
      child.once('message', (m) => {
        clearTimeout(timer);
        resolve(m.port);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error('测试主机提前退出 ' + code));
      });
    });
    browser = await chromium.launch({ headless: true, channel: process.env.OPC_BROWSER_CHANNEL || 'msedge' });
    const errors = [];
    for (const role of ['admin', 'leader', 'creator']) {
      const context = await browser.newContext({
          viewport: { width: 1440, height: 1100 },
          extraHTTPHeaders: { 'X-Forwarded-For': '127.0.0.' + { admin: 2, leader: 3, creator: 4 }[role] },
        }),
        page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/*', (route) =>
        new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
      );
      await page.goto(`http://127.0.0.1:${port}/${role}/login`);
      await page.locator('input[autocomplete="username"]').fill(role);
      await page.locator('input[type="password"]').fill('isolated_password');
      await page.locator('button[type="submit"]').click();
      await page.waitForURL('**/dashboard');
      await page.goto(`http://127.0.0.1:${port}/${role}/modules/zhihu/keywords`);
      await page.getByRole('heading', { name: '知乎归因与对账', exact: true }).waitFor();
      await page.getByRole('button', { name: '任务报价', exact: true }).waitFor();
      pages[role] = page;
      page.on('response', async (r) => {
        if (r.url().includes('/api/v1/modules/zhihu/')) {
          try {
            fs.appendFileSync(
              path.join(out, role + '-http.log'),
              r.request().method() +
                ' ' +
                r.url() +
                ' ' +
                r.status() +
                ' ' +
                (r.request().postData() || '') +
                '\n' +
                (await r.text()) +
                '\n',
            );
          } catch (e) {
            fs.appendFileSync(path.join(out, role + '-http.log'), String(e) + '\n');
          }
        }
      });
    }
    const a = pages.admin,
      l = pages.leader,
      c = pages.creator;
    const tab = (p, name) => p.getByRole('button', { name, exact: true }).click();
    const panel = (p, title) => p.getByRole('heading', { name: title, exact: true }).locator('..');
    const noError = async (p) => {
      const errors = await p.locator('.engine-error').allTextContents();
      assert.deepEqual(errors, []);
    };
    const submit = async (p, button) => {
      const response = p.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes('/api/v1/modules/zhihu/'),
      );
      await button.click();
      const r = await response;
      assert.ok(r.ok(), `${r.url()} ${r.status()} ${await r.text()}`);
    };
    await tab(a, '试算与切换');
    await a.getByLabel('新引擎起始日期').fill(day);
    await a.getByLabel('核对或变更依据').fill('隔离浏览器试算');
    await submit(a, a.getByRole('button', { name: '保存边界与状态' }));
    await tab(a, '关键词');
    const mapping = panel(a, '维护报表渠道映射');
    await mapping.locator('select').first().selectOption('1');
    await mapping.getByLabel('报表中的渠道名称').fill('测试渠道');
    await submit(a, mapping.getByRole('button', { name: '保存映射' }));
    const create = panel(a, '创建关键词');
    await create.getByLabel('推广任务').selectOption('1');
    await create.locator('select').nth(1).selectOption({ label: '测试渠道' });
    await create.getByLabel('关键词', { exact: true }).fill('浏览器独占词');
    await create.getByLabel('内容链接').fill('https://www.zhihu.com/market/test');
    await submit(a, create.getByRole('button', { name: '提交上游创建' }));
    await l.getByRole('button', { name: '查询', exact: true }).click();
    await submit(l, l.getByRole('button', { name: '领取', exact: true }));
    await l.getByRole('button', { name: '分配执行人' }).click();
    await l.getByLabel('执行人').selectOption('3');
    await submit(l, l.getByRole('button', { name: '确认保存' }));
    await c.getByRole('button', { name: '查询', exact: true }).click();
    await submit(c, c.getByRole('button', { name: '声明开始使用' }));
    for (const [page, payee, price] of [
      [a, '2', '15'],
      [l, '3', '13'],
    ]) {
      await tab(page, '任务报价');
      await page.getByLabel('推广任务').selectOption('1');
      await page.getByLabel('收款成员').selectOption(payee);
      await page.getByLabel('每单金额').fill(price);
      await page.getByLabel('生效日').fill(day);
      await page.getByLabel('报价或调价原因').fill('隔离报价样例');
      await submit(page, page.getByRole('button', { name: '保存草稿' }));
      await submit(page, page.getByRole('button', { name: '发布报价' }));
    }
    await tab(a, '报告与归因');
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['日期时间', '渠道名称', '关键词', '推广任务', '风险判定', '搜索量', '订单量', '搜索转化率（单位%）'],
        [day, '测试渠道', '浏览器独占词', 'KOC—会员订单', null, 1000, 100, 10],
      ]),
      '日报',
    );
    const file = path.join(out, 'report.xlsx');
    XLSX.writeFile(book, file);
    const legacyPage = await a.context().newPage();
    await require('./legacy-import.cjs')(legacyPage, `http://127.0.0.1:${port}`, file);
    await legacyPage.close();
    await a.getByLabel('报告类型').selectOption('combined');
    await a.getByLabel('Excel 附件').setInputFiles(file);
    await submit(a, a.getByRole('button', { name: '上传并预览' }));
    await a.getByRole('cell', { name: 'KOC—会员订单', exact: true }).waitFor();
    await a.getByRole('columnheader', { name: '搜索转化率（原表显示）', exact: true }).waitFor();
    await submit(a, a.getByRole('button', { name: '确认导入全部有效行' }));
    await a.getByText('代理 → 团长：1500.0000', { exact: true }).waitFor();
    await a.getByRole('cell', { name: '未提供 / 无法计算', exact: true }).waitFor();
    await a.screenshot({ path: path.join(out, 'feedback-report.png'), fullPage: true });
    await tab(c, '作品与对账');
    await c.getByLabel('绑定编号').fill('1');
    await c.getByLabel('作品链接').fill('https://example.com/work/1');
    await c.getByLabel('使用说明').fill('首次作品使用关键词');
    await submit(c, c.getByRole('button', { name: '登记作品' }));
    await tab(l, '作品与对账');
    await l.getByRole('button', { name: '核验或争议' }).click();
    await l.getByLabel('核验或争议依据').fill('核对关键词与作者');
    await submit(l, l.getByRole('button', { name: '通过核验' }));
    await tab(a, '试算与切换');
    await a.getByLabel('状态').selectOption('enabled');
    await a.getByLabel('核对或变更依据').fill('仅隔离浏览器样例验收');
    await a.getByRole('checkbox').check();
    await submit(a, a.getByRole('button', { name: '保存边界与状态' }));
    for (const page of [l, a]) {
      await tab(page, '作品与对账');
      await page.getByLabel('归因编号').fill('1');
      await submit(page, page.getByRole('button', { name: '生成本人付款草稿' }));
      await page.getByRole('checkbox', { name: /选择对账/ }).check();
      await submit(page, page.getByRole('button', { name: '确认所选 1 条应付', exact: true }));
    }
    await tab(c, '作品与对账');
    await c.getByRole('button', { name: '刷新', exact: true }).click();
    await c.getByText('已确认', { exact: true }).waitFor();
    assert.ok(!(await c.locator('.engine').innerText()).includes('1500.0000'));
    for (const [role, page] of Object.entries(pages)) {
      await noError(page);
      await page.screenshot({ path: path.join(out, role + '.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, 'result.json'),
      JSON.stringify(
        {
          status: 'passed',
          roles: 3,
          orders: 100,
          agencyPayable: '1500.0000',
          leaderPayable: '1300.0000',
          sourceRevenue: null,
          agencyMargin: null,
          report: '真实八列表头，合成数据，风险判定为空',
          database: 'disposable MySQL',
          upstream: 'local simulated handler',
        },
        null,
        2,
      ),
    );
    console.log('三端完整流程通过：创建、领取、分配、两级报价、上传、核验、顺序确认；达人价格隔离通过。');
  } catch (error) {
    for (const [role, page] of Object.entries(pages)) {
      await page.screenshot({ path: path.join(out, role + '-failure.png'), fullPage: true });
      fs.writeFileSync(path.join(out, role + '-failure.txt'), await page.locator('body').innerText());
    }
    throw error;
  } finally {
    await browser?.close();
    if (child.connected) {
      child.send('stop');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 30000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } else child.kill();
    log.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
