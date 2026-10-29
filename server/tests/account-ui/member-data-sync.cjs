// Isolated browser acceptance: creates a disposable database via the existing review host.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process'),
  { pathToFileURL } = require('node:url');
const mysql = require('mysql2/promise'),
  bcrypt = require('bcryptjs'),
  XLSX = require('xlsx');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..'),
  out = path.resolve(root, '../.opc-work/member-data-ui');
fs.mkdirSync(out, { recursive: true });
async function main() {
  const log = fs.createWriteStream(path.join(out, 'host.log'));
  const host = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href,
      path.resolve(__dirname, '../attribution-ui/review-host.ts'),
    ],
    {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, REMEDIATION_REVIEW: '1', OPC_REVIEW_IMPORT_RECOVERY: '1' },
    },
  );
  host.stdout.pipe(log);
  host.stderr.pipe(log);
  let browser, db;
  const results = [];
  try {
    const { port, importRecoveryDb: target } = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Review startup timeout')), 150000);
      host.once('message', (v) => {
        clearTimeout(timer);
        resolve(v);
      });
      host.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error('Review exited ' + code));
      });
    });
    assert.equal(target.database, 'remediation_review_test');
    assert(['localhost', '127.0.0.1', '::1'].includes(target.host));
    db = await mysql.createConnection(target);
    const hash = await bcrypt.hash('Review123456', 4);
    async function seed(name, role, parent = null) {
      const [r] = await db.query(
        'INSERT INTO users(username,password_hash,display_name,role,parent_id,is_active,must_change_pwd) VALUES(?,?,?,?,?,1,0)',
        [name, hash, name, role, parent],
      );
      return String(r.insertId);
    }
    const leader = await seed('关系测试团长', 'leader');
    for (let i = 1; i <= 25; i++) await seed('导出成员' + String(i).padStart(2, '0'), 'creator', leader);
    await seed('data_developer', 'developer');
    await seed('data_operator', 'operator');
    await seed('data_independent', 'creator');
    await db.query(
      "INSERT INTO member_referrals(user_id,channel,registered_at) SELECT u.id,'migration',u.created_at FROM users u LEFT JOIN member_referrals r ON r.user_id=u.id WHERE r.user_id IS NULL",
    );
    await db.query(
      "INSERT INTO team_memberships(user_id,leader_id,source,effective_from,reason) SELECT u.id,IF(p.role='leader',p.id,NULL),'migration',NOW(3),'隔离演示关系基线' FROM users u LEFT JOIN users p ON p.id=u.parent_id LEFT JOIN team_memberships m ON m.open_user=u.id WHERE m.id IS NULL",
    );
    await db.query(
      "INSERT INTO member_role_history(user_id,to_role,reason,effective_at) SELECT u.id,u.role,'migration',NOW(3) FROM users u LEFT JOIN member_role_history h ON h.user_id=u.id WHERE h.id IS NULL",
    );
    const base = 'http://127.0.0.1:' + port;
    browser = await chromium.launch({ headless: true });
    for (const [role, username, password, manage, exportable] of [
      ['admin', 'admin', 'Admin123456!', true, true],
      ['developer', 'data_developer', 'Review123456', true, true],
      ['operations', 'review_ops', 'Review123456', true, true],
      ['operator', 'data_operator', 'Review123456', true, false],
      ['leader', 'leader_wang', 'Review123456', false, false],
      ['finance', 'review_finance', 'Review123456', false, false],
      ['creator', 'data_independent', 'Review123456', false, false],
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }),
        page = await context.newPage(),
        errors = [];
      page.setDefaultTimeout(20000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()));
      await page.goto(base + '/app/login');
      await page.getByRole('button', { name: '使用原账号登录', exact: true }).click();
      await page.locator('input[autocomplete=username]').fill(username);
      await page.locator('input[type=password]').fill(password);
      const logging = page.waitForResponse((r) => r.url().endsWith('/core/auth/login'));
      await page.locator('button[type=submit]').click();
      assert.equal((await logging).status(), 200);
      await page.waitForURL((u) => !u.pathname.endsWith('/login'));
      async function shots(label) {
        for (const width of [1440, 375]) {
          await page.setViewportSize({ width, height: 1050 });
          const shell = page.locator('.studio-app');
          if ((await shell.count()) && (await shell.getAttribute('data-menu-open')) === 'true')
            await page.locator('.menu-toggle').click();
          await page.screenshot({
            path: path.join(out, `${role}-${label}-${width}.png`),
            fullPage: false,
            animations: 'disabled',
          });
          assert(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            `${role} ${label} overflow ${width}`,
          );
          for (const dialog of await page.locator('dialog[open]').all())
            assert(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth + 1), 'dialog overflow');
        }
        await page.setViewportSize({ width: 1440, height: 1050 });
      }
      await page.goto(base + '/app/me');
      await page.getByRole('link', { name: /帮助与客服/ }).click();
      await page.getByRole('heading', { name: '帮助与客服', exact: true }).waitFor();
      await page.locator('.support-cards').waitFor();
      if (role === 'admin') {
        await page.getByRole('button', { name: '设置联系方式' }).click();
        await page
          .getByLabel('客服飞书链接', { exact: true })
          .fill('https://applink.feishu.cn/client/contact/local-demo');
        await page
          .getByLabel('商务合作飞书链接', { exact: true })
          .fill('https://applink.feishu.cn/client/contact/business-demo');
        await page.getByLabel('服务时间', { exact: true }).fill('工作日 9:00–18:00');
        await page.getByRole('checkbox').check();
        await shots('support-settings');
        await page.getByRole('button', { name: '保存设置', exact: true }).click();
        await page.getByText('联系方式已保存', { exact: true }).waitFor();
      }
      if (!['admin', 'developer'].includes(role))
        assert.equal(await page.getByRole('button', { name: '设置联系方式' }).count(), 0);
      assert.equal(
        await page.getByRole('link', { name: '在飞书联系客服 ↗' }).getAttribute('href'),
        'https://applink.feishu.cn/client/contact/local-demo',
      );
      await shots('support');
      if (manage || role === 'leader') {
        await page.goto(base + '/app/team');
        await page.getByRole('heading', { name: '团队与成员', exact: true }).waitFor();
        await page.locator('.member-table tbody tr').first().waitFor();
        assert.equal(await page.getByRole('button', { name: '导出成员资料', exact: true }).count(), exportable ? 1 : 0);
        if (manage) {
          await page.getByRole('button', { name: '成员关系', exact: true }).click();
          await page
            .locator('.nodes li')
            .filter({ hasText: '关系测试团长' })
            .getByRole('button', { name: '25 人 · 查看', exact: true })
            .click();
          await page
            .locator('.nodes li')
            .filter({ hasText: '导出成员01' })
            .getByRole('button', { name: '关系记录', exact: true })
            .click();
          await page.getByRole('heading', { name: '关系变更记录', exact: true }).waitFor();
          await shots('relations');
          await page.getByRole('button', { name: '关闭详情', exact: true }).click();
          await page.getByRole('button', { name: /^全部成员/ }).click();
        }
        if (exportable) {
          await page.getByPlaceholder('账号、昵称、ID、手机或邀请人').fill('导出成员');
          await page.getByRole('button', { name: '导出成员资料', exact: true }).click();
          await page.getByText('导出当前筛选的 25 位成员', { exact: false }).waitFor();
          assert.equal(await page.getByRole('checkbox', { name: /同时导出/ }).count(), role === 'operations' ? 0 : 1);
          await shots('export');
          const pending = page.waitForEvent('download');
          await page.getByRole('button', { name: '下载 Excel', exact: true }).click();
          const download = await pending,
            file = path.join(out, role + '.xlsx');
          await download.saveAs(file);
          const book = XLSX.readFile(file);
          assert.equal(XLSX.utils.sheet_to_json(book.Sheets['成员与归属']).length, 25);
        }
      }
      if (role === 'creator') {
        await page.goto(base + '/app/join-team');
        await page.getByPlaceholder('搜索团长名字').fill('关系测试团长');
        await page.locator('.leader-option').filter({ hasText: '关系测试团长' }).waitFor();
        const text = await page.locator('.leader-options').innerText();
        assert(!text.includes('leader_wang'));
        assert(!text.includes('位成员'));
        await shots('join-team');
        await page.locator('.leader-option').filter({ hasText: '关系测试团长' }).click();
        assert.equal(await page.getByPlaceholder('搜索团长名字').inputValue(), '关系测试团长');
      }
      assert.deepEqual(errors, []);
      results.push({ role, widths: [1440, 375], status: 'passed' });
      console.log('PASS', role);
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ status: 'passed', results }, null, 2));
  } finally {
    if (db) await db.end();
    if (browser) await browser.close();
    if (host.connected) host.send('stop');
    await new Promise((resolve) => {
      if (host.exitCode !== null) return resolve();
      host.once('exit', resolve);
      setTimeout(() => {
        host.kill();
        resolve();
      }, 10000).unref();
    });
    log.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
