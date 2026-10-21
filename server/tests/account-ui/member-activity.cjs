// Real browser acceptance against a disposable MySQL container. No production traffic.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process'),
  { pathToFileURL } = require('node:url');
const mysql = require('mysql2/promise'),
  bcrypt = require('bcryptjs');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..'),
  out = path.resolve(root, '../.opc-work/member-activity-ui');
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
    async function seed(username, role, display = username) {
      const [r] = await db.query(
        'INSERT INTO users(username,password_hash,display_name,role,is_active,must_change_pwd) VALUES(?,?,?,?,1,0)',
        [username, hash, display, role],
      );
      return String(r.insertId);
    }
    const member = await seed('activity_member', 'creator', '任务验收成员');
    await seed('activity_zero', 'creator', '空记录成员');
    await seed('activity_developer', 'developer');
    await seed('activity_operator', 'operator');
    const [[leader]] = await db.query("SELECT id,display_name FROM users WHERE username='leader_wang'");
    const [[task]] = await db.query('SELECT * FROM tasks WHERE project_id=1 ORDER BY id LIMIT 1');
    const [[mapping]] = await db.query('SELECT * FROM zh_channel_mappings WHERE project_id=1 ORDER BY id LIMIT 1');
    const [[channel]] = await db.query('SELECT * FROM channels WHERE project_id=1 ORDER BY id LIMIT 1');
    for (let i = 1; i <= 23; i++) {
      const word = '验收春山' + String(i).padStart(2, '0');
      const [plan] = await db.query(
        "INSERT INTO plans(project_id,zhihu_task_id,channel_id,keyword,landing_url,novel_title,popularize_type,owner_id,created_by,status,sync_status,zhihu_plan_id) VALUES(1,?,?,?,'https://example.com/novel',?,1,?,1,'active','synced',?)",
        [
          task.zhihu_task_id,
          channel.zhihu_channel_id,
          word,
          i === 1 ? '检索小说原名' : '原著' + i,
          member,
          'activity-' + i,
        ],
      );
      const [keyword] = await db.query(
        "INSERT INTO zh_keywords(account_id,project_id,task_id,channel_mapping_id,plan_id,keyword,created_by,lifecycle_status) VALUES(?,1,?,?,?,?,1,'assigned')",
        [mapping.account_id, task.id, mapping.id, plan.insertId, word],
      );
      const [binding] = await db.query(
        "INSERT INTO zh_keyword_bindings(keyword_id,path_type,leader_id,executor_id,relation_snapshot,claimed_at,assigned_at,verification_status,released_at) VALUES(?,'team_creator',?,?,'{}','2026-10-01','2026-10-01',?,?)",
        [keyword.insertId, leader.id, member, i === 1 ? 'passed' : 'pending', i === 23 ? '2026-10-02' : null],
      );
      if (i !== 23)
        await db.query('UPDATE zh_keywords SET current_binding_id=? WHERE id=?', [binding.insertId, keyword.insertId]);
      if (i <= 2) {
        const url = `https://example.com/works/${i}?source=${'x'.repeat(180)}`;
        await db.query(
          "INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,composition_sub_type,title,promo_url,release_time,created_at,sync_status,zhihu_composition_id,zhihu_status_json) VALUES(?,?,'KOC抖音','123456',1,1,?,?,'2026-10-01','2026-10-02',?,?,?)",
          [
            plan.insertId,
            member,
            i === 1 ? '已核验的长链接作品' : '失败作品',
            url,
            i === 1 ? 'synced' : 'failed',
            i === 1 ? 'activity-work-1' : null,
            i === 1 ? JSON.stringify({ auditStatus: 'approved' }) : null,
          ],
        );
        if (i === 1)
          for (let duplicate = 0; duplicate < 2; duplicate++)
            await db.query(
              "INSERT INTO zh_evidence(binding_id,submitted_by,work_url,description,status) VALUES(?,?,?,'平台核验凭据','approved')",
              [binding.insertId, member, url],
            );
      }
    }
    // The member currently has no parent/project. Historical task ownership must still be visible.
    const base = 'http://127.0.0.1:' + port;
    browser = await chromium.launch({ headless: true });
    for (const [role, username, password, allowed] of [
      ['admin', 'admin', 'Admin123456!', true],
      ['developer', 'activity_developer', 'Review123456', true],
      ['operations', 'review_ops', 'Review123456', true],
      ['operator', 'activity_operator', 'Review123456', false],
      ['leader', 'leader_wang', 'Review123456', false],
      ['finance', 'review_finance', 'Review123456', false],
      ['creator', 'activity_member', 'Review123456', false],
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
      const page = await context.newPage(),
        errors = [],
        activityRequests = [];
      page.setDefaultTimeout(20000);
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('request', (r) => {
        if (r.url().includes('/core/member-activity')) activityRequests.push(r.url());
      });
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
      await page.goto(base + '/app/team');
      if (allowed) {
        await page.getByPlaceholder('账号、昵称、ID、手机或邀请人').fill('任务验收成员');
        const row = page.locator('.member-table tbody tr').filter({ hasText: '任务验收成员' });
        await row.getByRole('button', { name: '累计任务 23', exact: true }).waitFor();
        assert.equal(await row.getByRole('button', { name: '在手 22', exact: true }).count(), 1);
        assert.equal(await row.getByRole('button', { name: '已核验 1', exact: true }).count(), 1);
        assert.equal(await row.getByRole('button', { name: '作品记录 2', exact: true }).count(), 1);
        await shots('list');
        await row.getByRole('button', { name: '累计任务 23', exact: true }).click();
        const panel = page.locator('.member-activity');
        await panel.getByText('共 23 条 · 第 1 / 2 页', { exact: true }).waitFor();
        assert.equal(await panel.locator('.activity-record').count(), 20);
        await panel.getByRole('button', { name: '下一页', exact: true }).click();
        await panel.getByText('共 23 条 · 第 2 / 2 页', { exact: true }).waitFor();
        assert.equal(await panel.locator('.activity-record').count(), 3);
        await panel.getByPlaceholder('输入关键词、小说名或作品信息').fill('检索小说原名');
        await panel.getByRole('button', { name: '搜索', exact: true }).click();
        await panel.getByText('共 1 条 · 第 1 / 1 页', { exact: true }).waitFor();
        await panel.locator('summary').click();
        assert((await panel.locator('dl').innerText()).includes(leader.display_name));
        await shots('task-detail');
        await panel.getByRole('button', { name: '查看该词作品', exact: true }).click();
        await panel.locator('.activity-record').filter({ hasText: '已核验的长链接作品' }).waitFor();
        await panel.locator('summary').click();
        assert((await panel.locator('dl').innerText()).includes('已通过'));
        assert((await panel.locator('dl').innerText()).includes('已核验'));
        assert(
          (await panel.getByRole('link', { name: '打开作品 ↗', exact: true }).getAttribute('href')).startsWith(
            'https://example.com/works/1',
          ),
        );
        await shots('work-detail');
        await panel.getByRole('button', { name: '当前在手任务 22', exact: true }).click();
        await panel.getByText('共 22 条 · 第 1 / 2 页', { exact: true }).waitFor();
        await panel.getByRole('button', { name: '已核验任务 1', exact: true }).click();
        await panel.getByText('共 1 条 · 第 1 / 1 页', { exact: true }).waitFor();
        await page.getByRole('button', { name: '关闭详情', exact: true }).click();
        await row.getByRole('button', { name: '详情', exact: true }).click();
        await page.getByRole('button', { name: '资料与权限', exact: true }).waitFor();
        await page.getByRole('button', { name: '任务与作品', exact: true }).click();
        await panel.getByText('共 23 条 · 第 1 / 2 页', { exact: true }).waitFor();
        if (role === 'admin') {
          await page.route('**/core/member-activity/summary', (r) =>
            r.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ code: 50300, message: '隔离测试：统计暂不可用' }),
            }),
          );
          await panel.getByRole('button', { name: '刷新记录', exact: true }).click();
          await panel.getByRole('alert').waitFor();
          assert.equal(await panel.getByText('共 0 条 · 第 1 / 1 页', { exact: true }).count(), 0);
          await page.unroute('**/core/member-activity/summary');
          await panel.getByRole('button', { name: '重新加载', exact: true }).click();
          await panel.getByText('共 23 条 · 第 1 / 2 页', { exact: true }).waitFor();
        }
        await page.getByRole('button', { name: '关闭详情', exact: true }).click();
        await page.getByPlaceholder('账号、昵称、ID、手机或邀请人').fill('空记录成员');
        await page.getByRole('button', { name: '累计任务 0', exact: true }).click();
        await panel.getByText('该成员还没有领取／分配记录，领取任务后会显示在这里。', { exact: true }).waitFor();
        await shots('empty');
      } else {
        await page.locator('.studio-app').waitFor();
        assert.equal(await page.locator('.member-activity-counts').count(), 0);
        assert.equal(await page.locator('.member-activity').count(), 0);
        if (['operator', 'leader'].includes(role)) {
          await page
            .locator('.member-table tbody tr')
            .first()
            .getByRole('button', { name: '详情', exact: true })
            .click();
          assert.equal(await page.getByRole('button', { name: '任务与作品', exact: true }).count(), 0);
        }
        assert.deepEqual(activityRequests, []);
        await shots('no-activity-access');
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
