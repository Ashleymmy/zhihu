// Real role sessions against a disposable database; never touches a deployed account.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), { pathToFileURL } = require('node:url');
const mysql = require('mysql2/promise'), bcrypt = require('bcryptjs');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..'), out = path.resolve(root, '../.opc-work/member-visibility-ui');
fs.mkdirSync(out, { recursive: true });
async function main() {
  const log = fs.createWriteStream(path.join(out, 'host.log'));
  const host = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href, path.join(__dirname, 'review-host.ts')], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, REMEDIATION_REVIEW: '1', OPC_REVIEW_IMPORT_RECOVERY: '1' },
  });
  host.stdout.pipe(log); host.stderr.pipe(log);
  let browser; const results = [];
  try {
    const { port, importRecoveryDb: target } = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('隔离演示启动超时')), 150000);
      host.once('message', r => { clearTimeout(timer); resolve(r); });
      host.once('exit', code => { clearTimeout(timer); reject(Error('演示退出 ' + code)); });
    });
    assert.equal(target.database, 'remediation_review_test');
    assert(['localhost', '127.0.0.1', '::1'].includes(target.host));
    const db = await mysql.createConnection(target);
    try {
      const hash = await bcrypt.hash('Review123456', 4);
      await db.query("INSERT INTO users(username,password_hash,role,admin_duty,display_name,is_active,must_change_pwd) VALUES('visibility_dev',?,'developer','all','开发验收',1,0),('visibility_operator',?,'operator','operations','运营角色验收',1,0)", [hash, hash]);
    } finally { await db.end(); }
    const base = `http://127.0.0.1:${port}`, modulePath = '/modules/zhihu';
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const actors = [
      ['admin', 'admin', 'Admin123456!', true, true], ['developer', 'visibility_dev', 'Review123456', true, true],
      ['operations', 'review_ops', 'Review123456', true, false], ['operator', 'visibility_operator', 'Review123456', false, false],
      ['finance', 'review_finance', 'Review123456', true, true], ['leader', 'leader_wang', 'Review123456', false, false],
      ['creator', 'creator_li', 'Review123456', false, false], ['independent', 'creator_chen', 'Review123456', false, false],
    ];
    for (const [role, username, password, stats, prices] of actors) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }), page = await context.newPage(), errors = [];
      page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto(base + '/app/login');
      await page.locator('input[autocomplete="username"]').fill(username);
      await page.locator('input[type="password"]').fill(password);
      const logging = page.waitForResponse(r => r.url().endsWith('/core/auth/login'));
      await page.locator('button[type="submit"]').click(); const login = await logging;
      assert.equal(login.status(), 200); const token = (await login.json()).data.token;
      await page.waitForURL(url => !url.pathname.endsWith('/login'));
      const headers = { Authorization: 'Bearer ' + token, 'X-Client-Id': login.request().headers()['x-client-id'] };
      const get = async (endpoint, params = {}) => {
        const response = await context.request.get(base + '/api/v1' + endpoint + '?' + new URLSearchParams(params), { headers });
        assert.equal(response.status(), 200, role + ' ' + endpoint + ': ' + await response.text());
        return (await response.json()).data;
      };
      const scope = { projectId: '1', accountId: '1' }, period = { from: '2026-01-01', to: '2026-12-31' };
      const activity = await get(modulePath + '/workbench/work-activity', { ...scope, ...period, view: 'all' });
      if (stats) assert(activity.summary); else {
        assert.equal(activity.summary, null);
        assert(activity.list.every(row => !('registered' in row) && !('submitted' in row)));
      }
      const options = await get(modulePath + '/attribution-options', scope);
      if (!prices) { assert(options.tasks.every(task => task.unitPrice == null)); assert(options.currentNewUserPrice == null); }
      const keywords = await get(modulePath + '/keywords', scope);
      if (!stats) assert(keywords.list.every(word => word.compositionCount == null));
      const dashboard = await get('/core/dashboard');
      if (!stats) assert(dashboard.groups.every(g => g.services.every(s => s.metrics.every(m => !m.key.startsWith('works.')))));
      let taskCount = 0;
      if (role !== 'finance') {
        const tasks = await get('/core/tasks', { view: ['admin','developer','operations','operator'].includes(role) ? 'all' : 'owned' });
        for (const group of tasks.groups) for (const task of group.list) {
          taskCount++;
          const detail = await get(`/core/tasks/${group.moduleId}/${group.accountId}/${task.id}`, { projectId: group.projectId });
          for (const value of [task, detail]) {
            if (!stats) assert(value.metrics.every(m => m.label !== '已交作品'));
            if (!prices) assert(value.metrics.every(m => !/单价|分成/.test(m.label)));
          }
        }
        assert(taskCount > 0, role + ' needs visible task fixtures');
        await page.goto(base + '/app/tasks'); await page.getByRole('heading', { name: /任务/ }).first().waitFor();
        await page.waitForFunction(() => !document.body.textContent.includes('正在加载任务'));
        const text = await page.locator('body').innerText();
        if (!stats) assert(!text.includes('已交作品'));
        if (!prices) assert(!/当前拉新单价|当前拉活单价|当前拉新分成|当前拉活分成/.test(text));
      } else { await page.goto(base + '/app/finance'); }
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1050 });
        if (await page.locator('.studio-app').getAttribute('data-menu-open') === 'true') await page.locator('.menu-toggle').click();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), role + ' overflow');
        await page.screenshot({ path: path.join(out, `${role}-${width}.png`), fullPage: true, animations: 'disabled' });
      }
      if (!['operations', 'operator'].includes(role)) {
        const earnings = await get('/core/earnings/mine', period);
        if (!prices) assert(earnings.list.every(line => line.unitPrice === null && line.calculationAmount === null));
        const bills = await get(modulePath + '/workbench', { ...scope, ...period, viewVersion: '2' });
        if (!prices) assert(bills.entries.every(entry => !entry.calculation));
        for (const entry of bills.entries.filter(entry => entry.factId).slice(0, 2)) {
          const trace = await get(modulePath + '/attributions/' + entry.factId + '/trace', scope);
          if (!prices) assert(trace.results.every(r => r.obligations.every(o => o.unitPrice == null)));
        }
        if (!prices) {
          await page.goto(base + '/app/income'); await page.locator('.platform-income').waitFor();
          await page.locator('.platform-income[aria-busy="false"]').waitFor();
          for (const width of [1440, 375]) {
            await page.setViewportSize({ width, height: 1050 });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            await page.screenshot({ path: path.join(out, `${role}-income-${width}.png`), fullPage: true, animations: 'disabled' });
          }
        }
      }
      assert.deepEqual(errors, []); results.push({ role, stats, prices, taskCount, widths: [1440, 375] });
      console.log('PASS', role); await context.close();
    }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ status: 'passed', results }, null, 2));
  } finally {
    await browser?.close();
    if (host.connected) { host.send('stop'); await new Promise(resolve => { const timer = setTimeout(() => { host.kill(); resolve(); }, 20000); host.once('exit', () => { clearTimeout(timer); resolve(); }); }); }
    log.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
