// Runs against a disposable MySQL + real review-demo server. No deployed data or API is used.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process'),
  { pathToFileURL } = require('node:url');
const mysql = require('mysql2/promise'),
  bcrypt = require('bcryptjs');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..'),
  out = path.resolve(root, '../.opc-work/member-changes-ui');
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
      const timer = setTimeout(() => reject(Error('隔离演示启动超时')), 150000);
      host.once('message', (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      host.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error('隔离演示退出 ' + code));
      });
    });
    assert.equal(target.database, 'remediation_review_test');
    assert(['127.0.0.1', 'localhost', '::1'].includes(target.host));
    db = await mysql.createConnection(target);
    const hash = await bcrypt.hash('Review123456', 4);
    async function seed(name, role, parent = null, duty = 'all') {
      const [r] = await db.query(
        'INSERT INTO users(username,password_hash,display_name,role,parent_id,admin_duty,is_active,must_change_pwd) VALUES(?,?,?,?,?,?,1,0)',
        [name, hash, name, role, parent, duty],
      );
      await db.query('INSERT INTO project_members(project_id,user_id) VALUES(1,?)', [r.insertId]);
      return String(r.insertId);
    }
    const a = await seed('名单甲团长', 'leader'),
      b = await seed('名单乙团长', 'leader');
    const members = [];
    for (let i = 1; i <= 26; i++) members.push(await seed('名单成员' + String(i).padStart(2, '0'), 'creator', a));
    await db.query('UPDATE users SET is_active=0 WHERE id=?', [members[25]]);
    await seed('batch_developer', 'developer');
    await seed('batch_operator', 'operator', null, 'operations');
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const base = `http://127.0.0.1:${port}`;
    for (const [role, username, password, management] of [
      ['admin', 'admin', 'Admin123456!', true],
      ['developer', 'batch_developer', 'Review123456', true],
      ['operations', 'review_ops', 'Review123456', true],
      ['operator', 'batch_operator', 'Review123456', true],
      ['leader', 'leader_wang', 'Review123456', false],
      ['finance', 'review_finance', 'Review123456', false],
      ['creator', 'creator_li', 'Review123456', false],
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }),
        page = await context.newPage(),
        errors = [];
      page.setDefaultTimeout(20000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/*', (route) =>
        new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
      );
      await page.goto(base + '/app/login');
      await page.getByRole('button', { name: '使用原账号登录', exact: true }).click();
      await page.locator('input[autocomplete=username]').fill(username);
      await page.locator('input[type=password]').fill(password);
      const logging = page.waitForResponse((r) => r.url().endsWith('/core/auth/login'));
      await page.locator('button[type=submit]').click();
      assert.equal((await logging).status(), 200);
      await page.waitForURL((url) => !url.pathname.endsWith('/login'));
      await page.goto(base + '/app/team');
      if (management || role === 'leader') {
        await page.getByRole('heading', { name: '团队与成员', exact: true }).waitFor();
        await page.locator('.member-table tbody tr').first().waitFor();
      } else {
        await page.waitForURL((url) => url.pathname !== '/app/team');
      }
      async function screenshots(name) {
        for (const width of [1440, 375]) {
          await page.setViewportSize({ width, height: 1050 });
          if ((await page.locator('.studio-app').getAttribute('data-menu-open')) === 'true')
            await page.locator('.menu-toggle').click();
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: path.join(out, `${role}-${name}-${width}.png`),
            fullPage: true,
            animations: 'disabled',
          });
          assert(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            `${role} ${name} overflow ${width}`,
          );
          const scroll = await page
            .locator('.member-table')
            .evaluateAll((nodes) => nodes.some((n) => n.scrollWidth > n.clientWidth + 1));
          assert(!scroll, `${role} table overflow ${width}`);
        }
        await page.setViewportSize({ width: 1440, height: 1050 });
      }
      await screenshots('members');
      if (!management) assert.equal(await page.getByRole('button', { name: '批量变更', exact: true }).count(), 0);
      if (role === 'admin') {
        await page.getByPlaceholder('账号、昵称、ID、手机或邀请人').fill('名单甲团长');
        await page.getByLabel('角色', { exact: true }).selectOption('leader');
        await page.getByRole('button', { name: '详情', exact: true }).click();
        await page.getByRole('dialog', { name: '成员信息与权限' }).waitFor();
        await page.getByRole('button', { name: '下属成员 26 · 查看名单' }).click();
        await page.locator('.team-context').waitFor();
        assert.equal(await page.getByPlaceholder('账号、昵称、ID、手机或邀请人').inputValue(), '');
        assert.equal(await page.getByLabel('角色', { exact: true }).inputValue(), '');
        assert.equal(await page.locator('.member-table tbody tr').count(), 20);
        await page.getByRole('button', { name: '下一页', exact: true }).click();
        assert.equal(await page.locator('.member-table tbody tr').count(), 6);
        await screenshots('team');
        await page.getByRole('button', { name: '选择全部筛选结果（26 人）', exact: true }).click();
        await page.getByRole('button', { name: '批量变更', exact: true }).click();
        await page.getByLabel('成员的新归属', { exact: true }).selectOption(b);
        await page.getByRole('button', { name: '预览变更', exact: true }).click();
        await page.getByRole('button', { name: '确认执行 26 条', exact: true }).waitFor();
        assert.equal(await page.locator('.change-row').count(), 26);
        const [[before]] = await db.query('SELECT COUNT(*) n FROM users WHERE parent_id=?', [a]);
        assert.equal(Number(before.n), 26);
        await screenshots('preview');
        await page.getByRole('button', { name: '确认执行 26 条', exact: true }).click();
        await page
          .getByText('本次处理已结束。需要处理的成员可单独重新预览；已完成的不会重复执行。', { exact: true })
          .waitFor();
        assert.equal(await page.locator('[data-status=succeeded]').count(), 26);
        await screenshots('result');
        const [[after]] = await db.query('SELECT COUNT(*) n FROM users WHERE parent_id=?', [b]);
        assert.equal(Number(after.n), 26);
        await page.getByRole('button', { name: '返回成员列表', exact: true }).click();
        await page.getByRole('button', { name: '返回全部成员', exact: true }).click();
        assert.equal(await page.getByPlaceholder('账号、昵称、ID、手机或邀请人').inputValue(), '名单甲团长');
        await page.getByRole('button', { name: '粘贴账号 / 操作记录', exact: true }).click();
        await page.getByLabel('成员账号或固定 ID', { exact: true }).fill(`名单成员01\nnot-found\n名单成员01`);
        await page.getByLabel('要做什么', { exact: true }).selectOption('role');
        await page.getByRole('button', { name: '预览变更', exact: true }).click();
        await page.getByRole('button', { name: '确认执行 1 条', exact: true }).waitFor();
        assert.equal(await page.locator('[data-status=blocked]').count(), 2);
        await screenshots('partial');
        await page.getByRole('button', { name: '确认执行 1 条', exact: true }).click();
        await page
          .getByText('本次处理已结束。需要处理的成员可单独重新预览；已完成的不会重复执行。', { exact: true })
          .waitFor();
        const retryResponse = page.waitForResponse((r) => r.url().endsWith('/team/member-changes/preview') && r.request().method() === 'POST');
        await page.getByRole('button', { name: '重新预览未完成项', exact: true }).click();
        assert.equal((await (await retryResponse).json()).data.items.length, 1);
        await page.locator('.change-row').nth(1).waitFor({ state: 'detached' });
        await page.getByText('未找到该成员，请核对账号或固定 ID', { exact: true }).waitFor();
        assert.equal(await page.locator('.change-row').count(), 1);
        assert.equal(await page.locator('[data-status=succeeded]').count(), 0);
        assert.equal(await page.locator('.change-row').filter({ hasText: '名单成员01' }).count(), 0);
      } else if (management) {
        await page.getByRole('button', { name: '粘贴账号 / 操作记录', exact: true }).click();
        await page.getByLabel('成员账号或固定 ID', { exact: true }).fill('名单成员02');
        await page.getByLabel('要做什么', { exact: true }).selectOption('active');
        await page.getByLabel('账号状态', { exact: true }).selectOption('0');
        await page.getByRole('button', { name: '预览变更', exact: true }).click();
        await page.getByRole('button', { name: '确认执行 1 条', exact: true }).waitFor();
        await screenshots('preview');
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
