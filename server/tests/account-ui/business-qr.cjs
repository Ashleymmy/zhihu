// Real Web/API acceptance against a disposable database. Fixtures encode test text only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), { pathToFileURL } = require('node:url');
const mysql = require('mysql2/promise'), bcrypt = require('bcryptjs');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..'), out = path.resolve(root, '../.opc-work/business-qr-ui');
fs.mkdirSync(out, { recursive: true });
async function main() {
  const log = fs.createWriteStream(path.join(out, 'host.log'));
  const host = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href, path.resolve(__dirname, '../attribution-ui/review-host.ts')], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, REMEDIATION_REVIEW: '1', OPC_REVIEW_IMPORT_RECOVERY: '1' },
  });
  host.stdout.pipe(log); host.stderr.pipe(log);
  let browser, db;
  try {
    const { port, importRecoveryDb: target } = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Review startup timeout')), 150000);
      host.once('message', value => { clearTimeout(timeout); resolve(value); });
      host.once('exit', code => { clearTimeout(timeout); reject(Error('Review host exited ' + code)); });
    });
    assert.equal(target.database, 'remediation_review_test');
    assert(['localhost', '127.0.0.1', '::1'].includes(target.host));
    db = await mysql.createConnection(target);
    const hash = await bcrypt.hash('Review123456', 4);
    for (const [name, role] of [['qr_developer', 'developer'], ['qr_operator', 'operator'], ['qr_independent', 'creator']])
      await db.query('INSERT INTO users(username,password_hash,display_name,role,is_active,must_change_pwd) VALUES(?,?,?,?,1,0)', [name, hash, name, role]);
    const base = 'http://127.0.0.1:' + port;
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const results = [];
    for (const [role, username, password, configure] of [
      ['admin', 'admin', 'Admin123456!', true], ['developer', 'qr_developer', 'Review123456', true],
      ['operations', 'review_ops', 'Review123456', false], ['operator', 'qr_operator', 'Review123456', false],
      ['finance', 'review_finance', 'Review123456', false], ['leader', 'leader_wang', 'Review123456', false],
      ['creator', 'creator_li', 'Review123456', false], ['independent', 'qr_independent', 'Review123456', false],
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }), page = await context.newPage(), errors = [];
      page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto(base + '/app/login');
      await page.getByRole('button', { name: '使用原账号登录', exact: true }).click();
      await page.locator('input[autocomplete=username]').fill(username);
      await page.locator('input[type=password]').fill(password);
      await page.locator('button[type=submit]').click();
      await page.waitForURL(url => !url.pathname.endsWith('/login'));
      await page.goto(base + '/app/me');
      await page.getByRole('link', { name: /帮助与客服/ }).click();
      await page.getByRole('heading', { name: '帮助与客服', exact: true }).waitFor();
      await page.locator('.support-cards').waitFor();
      async function shots(label, focus) {
        for (const width of [1440, 375]) {
          await page.setViewportSize({ width, height: 1050 });
          const shell = page.locator('.studio-app');
          if ((await shell.count()) && await shell.getAttribute('data-menu-open') === 'true') await page.locator('.menu-toggle').click();
          if (focus) await focus.scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(out, `${role}-${label}-${width}.png`), animations: 'disabled' });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), role + ' overflow');
        }
      }
      const settings = page.getByRole('button', { name: '设置联系方式' });
      assert.equal(await settings.count(), configure ? 1 : 0);
      await shots('support');
      if (configure) {
        await settings.click();
        if (role === 'admin') {
          await page.getByLabel('服务时间', { exact: true }).fill('工作日 10:00–18:00');
          for (const [channel, label] of [['wechat', '微信'], ['feishu', '飞书']]) {
            await page.getByLabel(label + '二维码图片', { exact: true }).setInputFiles(path.join(root, 'tests/fixtures/business-' + channel + '-test.png'));
            await page.getByLabel(label + '联系人名称', { exact: true }).fill('TIMO ' + label + '商务（隔离测试）');
          }
        }
        await page.locator('.qr-preview').first().waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('.qr-preview')].length === 2 && [...document.querySelectorAll('.qr-preview')].every(image => image.complete && image.naturalWidth > 100));
        await shots('qr-settings', page.locator('.qr-settings'));
        const saving = page.waitForResponse(response => response.url().endsWith('/core/support') && response.request().method() === 'PUT');
        await page.getByRole('button', { name: '保存设置', exact: true }).click();
        assert.equal((await saving).status(), 200);
        await page.getByText('联系方式已保存', { exact: true }).waitFor();
        if (role === 'admin') {
          await settings.click();
          await page.waitForFunction(() => document.querySelectorAll('.qr-preview').length === 2);
          await page.getByRole('button', { name: '移除微信二维码', exact: true }).click();
          const removed = page.waitForResponse(response => response.url().endsWith('/core/support') && response.request().method() === 'PUT');
          await page.getByRole('button', { name: '保存设置', exact: true }).click();
          assert.deepEqual((await (await removed).json()).data.businessQrCodes.map(q => q.channel), ['feishu']);
          await settings.click();
          await page.getByLabel('微信二维码图片', { exact: true }).setInputFiles(path.join(root, 'tests/fixtures/business-wechat-test.png'));
          await page.getByLabel('微信联系人名称', { exact: true }).fill('TIMO 微信商务（隔离测试）');
          const restored = page.waitForResponse(response => response.url().endsWith('/core/support') && response.request().method() === 'PUT');
          await page.getByRole('button', { name: '保存设置', exact: true }).click();
          assert.equal((await restored).status(), 200);
        }
      }
      assert.deepEqual(errors, []); results.push({ role, widths: [1440, 375], configure });
      await context.close(); console.log('PASS', role);
    }
    const [images] = await db.query('SELECT channel,content FROM platform_support_qrcodes');
    for (const image of images) assert.deepEqual(image.content, fs.readFileSync(path.join(root, 'tests/fixtures/business-' + image.channel + '-test.png')));
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ status: 'passed', results, originalBytesPreserved: true }, null, 2));
    console.log('BUSINESS_QR_UI_PASS');
  } finally {
    if (db) await db.end(); if (browser) await browser.close();
    if (host.connected) host.send('stop');
    await new Promise(resolve => { if (host.exitCode !== null) return resolve(); host.once('exit', resolve); setTimeout(() => { host.kill(); resolve(); }, 10000).unref(); });
    log.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
