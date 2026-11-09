const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../..');
const out = path.resolve(root, '../.opc-work/report-scope-ui');
fs.mkdirSync(out, { recursive: true });

async function main() {
  const log = fs.createWriteStream(path.join(out, 'host.log'));
  const host = spawn(process.execPath, [
    '--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href,
    path.join(__dirname, 'review-host.ts'),
  ], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, REMEDIATION_REVIEW: '1', OPC_REVIEW_IMPORT_RECOVERY: '1' },
  });
  host.stdout.pipe(log);
  host.stderr.pipe(log);
  const sessions = {};
  let browser, db;
  try {
    const { port, importRecoveryDb } = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Disposable review host timed out')), 120000);
      host.once('message', value => { clearTimeout(timer); resolve(value); });
      host.once('exit', code => { clearTimeout(timer); reject(Error('Review host exited ' + code)); });
    });
    assert.equal(importRecoveryDb.database, 'remediation_review_test');
    assert(['localhost', '127.0.0.1'].includes(importRecoveryDb.host));
    db = await require('mysql2/promise').createConnection(importRecoveryDb);
    await db.query("INSERT INTO users(username,password_hash,role,display_name,is_active,must_change_pwd) VALUES('review_developer',?,'developer','开发测试',1,0)", [await require('bcryptjs').hash('Review123456', 4)]);
    const base = `http://127.0.0.1:${port}`;
    const scope = { projectId: '1', accountId: '1' };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    for (const [role, username, password] of [
      ['admin', 'admin', 'Admin123456!'], ['finance', 'review_finance', 'Review123456'],
      ['developer', 'review_developer', 'Review123456'], ['creator', 'creator_li', 'Review123456'],
      ['independent', 'creator_chen', 'Review123456'],
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
      const page = await context.newPage();
      const errors = [];
      page.setDefaultTimeout(20000);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto(base + '/app/login');
      await page.getByRole('button', { name: '使用原账号登录', exact: true }).click();
      await page.locator('input[autocomplete=username]').fill(username);
      await page.locator('input[type=password]').fill(password);
      const logging = page.waitForResponse(response => response.url().endsWith('/core/auth/login'));
      await page.locator('button[type=submit]').click();
      const response = await logging;
      assert.equal(response.status(), 200);
      const token = (await response.json()).data.token;
      await page.waitForURL(url => !url.pathname.endsWith('/login'));
      sessions[role] = { page, context, errors, headers: { Authorization: 'Bearer ' + token, 'X-Client-Id': response.request().headers()['x-client-id'] } };
    }
    const endpoint = tail => base + '/api/v1/modules/zhihu/' + tail;
    async function get(tail, params = {}, role = 'finance') {
      const session = sessions[role];
      const response = await session.context.request.get(endpoint(tail), { headers: session.headers, params: { ...scope, ...params } });
      assert.equal(response.status(), 200, await response.text());
      return (await response.json()).data;
    }
    async function post(tail, data = {}, role = 'finance') {
      const session = sessions[role];
      const response = await session.context.request.post(endpoint(tail), { headers: session.headers, data: { ...scope, requestKey: randomUUID(), ...data } });
      assert(response.ok(), await response.text());
      return (await response.json()).data;
    }
    async function upload(name, rows) {
      const session = sessions.finance;
      const buffer = Buffer.from('日期,渠道名称,关键词,订单量\n' + rows.map(([word, quantity]) => `${today},知乎故事一代渠道,${word},${quantity}`).join('\n'));
      const response = await session.context.request.post(endpoint('workbench/import/preview'), {
        headers: session.headers,
        multipart: { ...scope, reportType: 'new_user', requestKey: randomUUID(), file: { name, mimeType: 'text/csv', buffer } },
      });
      assert.equal(response.status(), 200, await response.text());
      const preview = (await response.json()).data;
      await post('workbench/import/' + preview.id + '/commit', { previewHash: preview.previewHash });
      await post('imports/' + preview.id + '/process');
      return preview;
    }
    async function shot(role, name) {
      const page = sessions[role].page;
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1050 });
        if (await page.locator('.studio-app').getAttribute('data-menu-open') === 'true') await page.locator('.menu-toggle').click();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${role} ${name} horizontal overflow`);
        if (width === 375) assert((await page.locator('.review-scope .grow').boundingBox()).width > 200, 'Report scope text must have a readable mobile width');
        await page.screenshot({ path: path.join(out, `${role}-${name}-${width}.png`), fullPage: true, animations: 'disabled' });
      }
      await page.setViewportSize({ width: 1440, height: 1050 });
    }
    // Every mutation below targets the disposable MySQL started above.
    const initial = await get('imports', { page: 1, pageSize: 100 });
    for (const batch of initial.list) {
      const removal = await get('imports/' + batch.id + '/withdrawal');
      await post('imports/' + batch.id + '/withdrawal', { reviewHash: removal.reviewHash });
    }
    const oldWords = ['范围旧团队词', '范围旧独立词'];
    const newWords = Array.from({ length: 5 }, (_, index) => '当前报表词' + (index + 1));
    const siblingWord = '同日其他报表词';
    for (const word of [...oldWords, ...newWords, siblingWord]) {
      const actor = word === oldWords[1] ? 'independent' : 'creator';
      const userId = actor === 'independent' ? '5' : '3';
      const keyword = await post('keywords', { keyword: word, taskId: '1', mappingId: '1', landingUrl: 'https://example.com/scope', popularizeType: 0 }, 'admin');
      await db.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?", ['scope-ui-' + keyword.id, keyword.planId]);
      const binding = await post('keywords/' + keyword.id + '/distribute', { targetId: userId }, 'admin');
      await post('bindings/' + binding.id + '/activate', {}, actor);
      const evidence = await post('evidence', { bindingId: binding.id, url: 'https://example.com/' + encodeURIComponent(word), description: '隔离报表核验作品' }, actor);
      await post('evidence/' + evidence.id + '/review', { accept: true, reason: '隔离核验' }, 'admin');
    }
    const old = await upload('上次报表.csv', [[oldWords[0], 6], [oldWords[1], 1]]);
    const oldPeriod = { from: today, to: today, importId: old.id, viewVersion: '2' };
    const oldView = await get('workbench', oldPeriod);
    assert.equal(oldView.summary.payable, '59.0000');
    await post('workbench/confirm', { ...oldPeriod, reviewHash: oldView.reviewHash, acknowledged: true });
    const oldLedger = JSON.stringify((await db.query('SELECT e.* FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.source_key IN (?) ORDER BY e.id', [oldView.entries.map(entry => 'fact:' + entry.factId)]))[0]);
    const financePage = sessions.finance.page;
    await financePage.goto(base + '/app/finance');
    await financePage.getByRole('button', { name: '上传报表', exact: true }).click();
    const currentBuffer = Buffer.from('日期,渠道名称,关键词,订单量\n' + newWords.map(word => `${today},知乎故事一代渠道,${word},1`).join('\n'));
    const inspecting = financePage.waitForResponse(response => response.url().endsWith('/workbench/import/preview'));
    await financePage.locator('.upload-step input[type=file]').setInputFiles({ name: '本次5单.csv', mimeType: 'text/csv', buffer: currentBuffer });
    const current = (await (await inspecting).json()).data;
    const preview = financePage.getByRole('dialog', { name: '确认报表内容', exact: true });
    await preview.getByRole('button', { name: '确认导入有效行', exact: true }).click();
    await preview.waitFor({ state: 'hidden' });
    await financePage.getByRole('region', { name: '当前报表分析' }).waitFor();
    await financePage.getByRole('button', { name: '去处理待办 →', exact: true }).click();
    await financePage.getByRole('button', { name: '去核对与确认 →', exact: true }).click();
    await financePage.getByRole('heading', { name: '本次报表核对', exact: true }).waitFor();
    async function assertCurrent(page) {
      await page.waitForFunction(() => document.querySelectorAll('.review-grid .fact').length === 10);
      const text = await page.locator('.review-grid').innerText();
      assert(text.includes('5 单') && text.includes('¥42.50'));
      assert(!oldWords.some(word => text.includes(word)));
      assert(!text.includes('¥101.50'));
    }
    await assertCurrent(financePage);
    await shot('finance', 'current-report');
    await financePage.getByRole('button', { name: '刷新结果', exact: true }).click();
    await assertCurrent(financePage);
    await financePage.getByRole('button', { name: '查看整月账单', exact: true }).click();
    await financePage.getByRole('heading', { name: '本月累计核对', exact: true }).waitFor();
    assert((await financePage.locator('.review-grid').innerText()).includes('12 单'));
    assert((await financePage.locator('.review-grid').innerText()).includes('¥101.50'));
    await shot('finance', 'month-total');
    await financePage.getByRole('button', { name: '只看这份报表', exact: true }).click();
    await assertCurrent(financePage);
    // History entry and role-specific layouts must retain the same report scope.
    for (const role of ['admin', 'developer']) {
      const page = sessions[role].page;
      await page.goto(base + '/app/finance');
      await page.getByRole('button', { name: '上传记录 / 撤销', exact: true }).click();
      await page.locator(`[data-report-id="${current.id}"]`).getByRole('button', { name: '查看处理结果', exact: true }).click();
      await page.getByRole('button', { name: '去处理待办 →', exact: true }).click();
      await page.getByRole('button', { name: '去核对与确认 →', exact: true }).click();
      await assertCurrent(page);
      await shot(role, 'current-report');
    }
    const sibling = await upload('同日另一份.csv', [[siblingWord, 2]]);
    let confirmBody;
    financePage.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/workbench/confirm')) confirmBody = request.postDataJSON(); });
    await financePage.getByRole('button', { name: /^核对并确认账单/ }).click();
    const confirming = financePage.getByRole('dialog', { name: '确认入账', exact: true });
    assert((await confirming.innerText()).includes('本次报表'));
    assert((await confirming.innerText()).includes('¥42.50'));
    await confirming.getByRole('checkbox', { name: '我已核对数量、单价和收款人' }).check();
    await confirming.getByRole('button', { name: '确认入账', exact: true }).click();
    await confirming.waitFor({ state: 'hidden' });
    assert.equal(confirmBody.importId, current.id);
    const after = await get('workbench', { from: today, to: today, importId: current.id, viewVersion: '2' });
    assert.equal(after.summary.confirmedPayable, '42.5000');
    assert.equal(after.summary.pendingPayable, '0.0000');
    const unconfirmed = await get('workbench', { from: today, to: today, importId: sibling.id, viewVersion: '2' });
    assert.equal(unconfirmed.summary.pendingPayable, '17.0000');
    assert(unconfirmed.entries.every(entry => entry.ready));
    assert.equal(JSON.stringify((await db.query('SELECT e.* FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.source_key IN (?) ORDER BY e.id', [oldView.entries.map(entry => 'fact:' + entry.factId)]))[0]), oldLedger);
    // The selected file may span two months. Its own date range must reach the API intact.
    const previousMonth = new Date(Date.parse(today.slice(0, 7) + '-01') - 86400000).toISOString().slice(0, 10);
    await financePage.getByRole('button', { name: '← 账期列表', exact: true }).click();
    await financePage.getByRole('button', { name: '上传报表', exact: true }).click();
    const crossBuffer = Buffer.from(`日期,渠道名称,关键词,订单量\n${previousMonth},知乎故事一代渠道,${newWords[0]},1\n${today},知乎故事一代渠道,${newWords[0]},1`);
    const crossPreviewResponse = financePage.waitForResponse(response => response.url().endsWith('/workbench/import/preview'));
    await financePage.locator('.upload-step input[type=file]').setInputFiles({ name: '跨月报表.csv', mimeType: 'text/csv', buffer: crossBuffer });
    const cross = (await (await crossPreviewResponse).json()).data;
    const crossViewResponse = financePage.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/workbench') && url.searchParams.get('importId') === cross.id && url.searchParams.get('from') === previousMonth && url.searchParams.get('to') === today;
    });
    await financePage.getByRole('dialog', { name: '确认报表内容', exact: true }).getByRole('button', { name: '确认导入有效行', exact: true }).click();
    assert.equal((await (await crossViewResponse).json()).data.period.importId, cross.id);
    let crossView;
    for (let attempt = 0; attempt < 40; attempt++) {
      crossView = await get('workbench', { from: previousMonth, to: today, importId: cross.id, viewVersion: '2' });
      if (!crossView.processingImports.length) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(crossView.summary.byType.newUser.quantity, '2');
    for (const session of Object.values(sessions)) assert.deepEqual(session.errors, []);
    const result = { passed: true, widths: [1440, 375], roles: ['finance', 'admin', 'developer'], currentOrders: 5, currentPayable: '42.50', monthOrders: 12, monthPayable: '101.50', historyScoped: true, confirmationScoped: true, sameDayOtherReportUnconfirmed: true, crossMonthRange: true, oldLedgerUnchanged: true };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    for (const [role, session] of Object.entries(sessions)) {
      await session.page.screenshot({ path: path.join(out, 'failed-' + role + '.png'), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(out, 'failed-' + role + '.txt'), await session.page.locator('body').innerText().catch(() => ''));
    }
    throw error;
  } finally {
    await db?.end();
    await browser?.close();
    if (host.connected) host.send('stop');
    await new Promise(resolve => {
      if (host.exitCode !== null) return resolve();
      const timer = setTimeout(() => { host.kill(); resolve(); }, 30000);
      host.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    log.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
