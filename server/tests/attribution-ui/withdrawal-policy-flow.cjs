// Real Web pages and real HTTP/database; funds are synthetic in a disposable MySQL only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process'),
  { pathToFileURL } = require('node:url'),
  { randomUUID } = require('node:crypto');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..'),
  out = path.resolve(root, '../.opc-work/withdrawal-policy-ui');
fs.mkdirSync(out, { recursive: true });
async function main() {
  const log = fs.createWriteStream(path.join(out, 'host.log'));
  const host = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href,
      path.join(__dirname, '../opc-ui/withdrawal-host.ts'),
    ],
    {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, WITHDRAWAL_UI_TEST: '1' },
    },
  );
  host.stdout.pipe(log);
  host.stderr.pipe(log);
  let browser, db;
  const sessions = {};
  try {
    const { port, importRecoveryDb } = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('隔离演示启动超时')), 120000);
      host.once('message', (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      host.once('exit', (c) => {
        clearTimeout(timer);
        reject(Error('演示退出 ' + c));
      });
    });
    assert.equal(importRecoveryDb.database, 'withdrawal_ui_test');
    db = await require('mysql2/promise').createConnection(importRecoveryDb);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()),
      scope = { projectId: '1', accountId: '1', moduleId: 'withdrawal-test' },
      base = `http://127.0.0.1:${port}`;
    const [source] = await db.query(
      "INSERT INTO opc_income_sources(module_id,project_id,account_id,source_key,business_date,source_version,snapshot_hash,description) VALUES('withdrawal-test',1,1,'withdrawal-ui',?,'1',REPEAT('a',64),'隔离提现资金')",
      [day],
    );
    for (const user of [2, 3, 5])
      await db.query(
        "INSERT INTO opc_income_entries(source_id,source_version,user_id,amount,target_amount,availability,confirmed_by) VALUES(?,'1',?,2000,2000,'available',1)",
        [source.insertId, user],
      );
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    for (const [role, name] of [
      ['finance', 'review_finance'],
      ['creator', 'creator_li'],
      ['independent', 'creator_chen'],
      ['leader', 'leader_wang'],
      ['operations', 'review_ops'],
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }),
        page = await context.newPage();
      page.setDefaultTimeout(20000);
      await page.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()));
      await page.goto(base + '/app/login');
      await page.getByRole('button',{name:'使用原账号登录',exact:true}).click();
      await page.locator('input[autocomplete=username]').fill(name);
      await page.locator('input[type=password]').fill('Review123456');
      const logged = page.waitForResponse((r) => r.url().endsWith('/core/auth/login'));
      await page.locator('button[type=submit]').click();
      const response = await logged;
      assert.equal(response.status(), 200);
      await page.waitForURL((u) => !u.pathname.endsWith('/login'));
      sessions[role] = {
        page,
        context,
        headers: {
          Authorization: 'Bearer ' + (await response.json()).data.token,
          'X-Client-Id': response.request().headers()['x-client-id'],
        },
      };
    }
    const get = async (role, url) => {
      const s = sessions[role],
        r = await s.context.request.get(base + '/api/v1/' + url, { headers: s.headers });
      assert.equal(r.status(), 200, await r.text());
      return (await r.json()).data;
    };
    const post = async (role, url, data) => {
      const s = sessions[role],
        r = await s.context.request.post(base + '/api/v1/' + url, { headers: s.headers, data });
      assert(r.status() < 300, await r.text());
      return (await r.json()).data;
    };
    const shot = async (role, label) => {
      const p = sessions[role].page;
      for (const width of [1440, 375]) {
        await p.setViewportSize({ width, height: 1050 });
        if ((await p.locator('.studio-app').getAttribute('data-menu-open')) === 'true')
          await p.locator('.menu-toggle').click();
        assert(
          await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          role + ' horizontal overflow',
        );
        const d = p.locator('dialog[open]');
        if (await d.count()) {
          assert(await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
          await d.screenshot({ path: path.join(out, role + '-' + label + '-' + width + '.png') });
        } else
          await p.locator('.cash-box').screenshot({ path: path.join(out, role + '-' + label + '-' + width + '.png') });
      }
      await p.setViewportSize({ width: 1440, height: 1050 });
    };
    for (const [role, amount] of [
      ['creator', '100'],
      ['leader', '500'],
      ['independent', '100'],
    ]) {
      const p = sessions[role].page;
      await p.goto(base + '/app/income');
      await p.locator('.cash-box h3').filter({ hasText: '提现规则' }).waitFor();
      await shot(role, 'rules');
      await p.getByRole('button', { name: '申请提现', exact: true }).click();
      const d = p.locator('dialog[open]');
      await d.getByLabel('提现金额（元）').fill(amount);
      await d.getByLabel('收款账号', { exact: true }).fill('TEST-NO-TRANSFER');
      await d.getByLabel('收款人姓名').fill('隔离验收');
      await d.getByRole('button', { name: '核对到账金额' }).click();
      await d.getByText('预计到账 ¥' + (Number(amount) * 0.99).toFixed(2), { exact: true }).waitFor();
      await shot(role, 'quote');
      const attempts=[];
      if(role==='creator')await p.route('**/core/finance/withdrawals',async route=>{
        if(route.request().method()!=='POST')return route.continue();
        attempts.push(route.request().postDataJSON());
        if(attempts.length===1)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:40910,message:'提现规则已更新'})});
        if(attempts.length===2){await route.fetch();return route.abort();}
        return route.continue();
      });
      await d.getByRole('checkbox').check();
      await d.getByRole('button', { name: '确认申请提现' }).click();
      if(role==='creator'){
        await d.getByRole('alert').waitFor();assert.equal(await d.getByRole('checkbox').count(),0);
        await d.getByRole('button',{name:'核对到账金额'}).click();await d.getByRole('checkbox').check();await d.getByRole('button',{name:'确认申请提现'}).click();
        await d.getByRole('alert').waitFor();await d.getByRole('button',{name:'确认申请提现'}).click();assert.equal(attempts[1].requestKey,attempts[2].requestKey);await p.unroute('**/core/finance/withdrawals');
      }
      await d.waitFor({ state: 'hidden' });
      await shot(role, 'submitted');
      assert(await p.getByRole('button', { name: '申请提现', exact: true }).isDisabled());
      if(role!=='leader')assert.equal(await p.getByRole('button',{name:'查看要求 / 补充发票'}).count(),0);

    }
    const creatorRecord = (await get('creator', 'core/finance?' + new URLSearchParams(scope))).withdrawals[0];
    const leaderRecord = (await get('leader', 'core/finance?' + new URLSearchParams(scope))).withdrawals[0];
    const f = sessions.finance.page;
    await f.goto(base + '/app/finance');
    await f.locator('.cash-box').waitFor();
    await shot('finance', 'queue');
    const row = (id) =>
      f
        .locator('.cash-table tbody tr')
        .filter({
          hasText: id === creatorRecord.id ? '达人验收' : id === leaderRecord.id ? '团长验收' : '独立达人验收',
        })
        .filter({ hasNotText: id === creatorRecord.id ? '独立达人验收' : 'NOT-A-PERSON' });
    for (const id of [creatorRecord.id, leaderRecord.id]) {
      await row(id).getByRole('button', { name: '审核通过', exact: true }).click();
      await f.getByRole('button', { name: '确认审核通过', exact: true }).click();
      await f.locator('dialog[open]').waitFor({ state: 'hidden' });
    }
    await row(leaderRecord.id).getByRole('button', { name: '登记已线下发放' }).waitFor();
    await row(creatorRecord.id).getByRole('button', { name: '登记已线下发放' }).click();
    await shot('finance', 'net-payment');
    await f.getByRole('checkbox', { name: '已实际转账，核对了实付金额、手续费和收款账户' }).check();
    await f.getByRole('button', { name: '保存发放记录' }).click();
    await f.locator('dialog[open]').waitFor({ state: 'hidden' });
    const paid = await get('creator', 'core/finance?' + new URLSearchParams(scope));
    assert.equal(paid.balance.paid, '99.0000');
    assert.equal(paid.balance.available, '1900.0000');
    await f.getByLabel('处理期限').selectOption('overdue');
    await f.getByText('还没有提现申请。', { exact: true }).waitFor();
    await f.getByLabel('处理期限').selectOption('all');
    await row(leaderRecord.id).waitFor();
    await shot('finance', 'paid');
    const denied = await sessions.operations.context.request.get(base + '/api/v1/core/finance/withdrawal-policy', {
      headers: sessions.operations.headers,
    });
    assert.equal(denied.status(), 403);
    fs.writeFileSync(
      path.join(out, 'result.json'),
      JSON.stringify(
        {
          memberFlows: true,
          financeFlow: true,
          netPaid: paid.balance.paid,
          widths: [1440, 375],
          roles: Object.keys(sessions),
        },
        null,
        2,
      ),
    );
    console.log('WITHDRAWAL_UI_PASS: creator / independent / leader / finance, 1440px and 375px');
  } finally {
    await browser?.close();
    await db?.end();
    if (host.connected) {
      host.send('stop');
      await new Promise((resolve) => host.once('exit', resolve));
    }
    log.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
