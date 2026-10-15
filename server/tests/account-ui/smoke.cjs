const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict'),
  { spawn } = require('child_process'),
  { pathToFileURL } = require('url');
const repo = path.resolve(__dirname, '../../..'),
  serverRoot = path.join(repo, 'server');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const out = path.join(repo, '.opc-work/account-review');
fs.mkdirSync(out, { recursive: true });
const log = fs.createWriteStream(path.join(out, 'web-host.log'));
const host = spawn(
  process.execPath,
  [
    '--import',
    pathToFileURL(path.join(serverRoot, 'node_modules/tsx/dist/loader.mjs')).href,
    path.join(serverRoot, 'tests/account-ui/host.ts'),
  ],
  {
    cwd: serverRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ACCOUNT_UI_TEST: '1' },
  },
);
host.stdout.pipe(log);
host.stderr.pipe(log);
const messages = [],
  waiters = [];
host.on('message', (m) => {
  messages.push(m);
  for (const w of [...waiters])
    if (w.test(m)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(m);
    }
});
function wait(test) {
  const old = messages.find(test);
  if (old) return Promise.resolve(old);
  return new Promise((resolve, reject) => {
    const w = {
      test,
      resolve: (m) => {
        clearTimeout(t);
        resolve(m);
      },
    };
    const t = setTimeout(() => reject(Error('Host timeout')), 90000);
    waiters.push(w);
  });
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true, animations: 'disabled' });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'horizontal overflow: ' + name,
  );
}
(async () => {
  let browser;
  try {
    const { port } = await wait((m) => m.port),
      base = 'http://127.0.0.1:' + port + '/app';
    browser = await chromium.launch({
      headless: true,
      ...(process.env.OPC_BROWSER_EXECUTABLE ? { executablePath: process.env.OPC_BROWSER_EXECUTABLE } : {}),
    });
    for (const width of [375, 1440]) {
      for (const role of ['creator', 'leader', 'admin']) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' }),
          page = await context.newPage();
        await page.goto(base + '/login');
        await shot(page, role + '-phone-login-' + width);
        await page.getByRole('button', {name:'使用原账号登录',exact:true}).click();
        await page.locator('#username').fill(role);
        await page.locator('#password').fill('Legacy_password_more_than16!');
        await page.locator('button[type=submit]').click();
        await page.waitForURL((u) => !u.pathname.endsWith('/login'));
        await page.goto(base + '/account/security');
        await page.getByText('用户 ID：', { exact: false }).waitFor();
        assert.match(await page.locator('.page-header').innerText(), /用户 ID：timo\d{6}/);
        await shot(page, role + '-security-' + width);
        await page.goto(base + '/me');
        await page.getByText('用户 ID：', { exact: false }).waitFor();
        assert.match(await page.locator('.page-header').innerText(), /用户 ID：timo\d{6}/);
        await shot(page, role + '-me-' + width);
        await context.close();
      }
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' }),
        page = await context.newPage(),
        phone = width === 375 ? '13900000375' : '13900001440';
      await page.goto(base + '/register');
      await page.locator('#phone').fill(phone);
      await page.locator('input[type=checkbox]').check();
      await page.getByRole('button', { name: '获取验证码', exact: true }).click();
      const sms = await wait((m) => m.sms?.phone === phone);
      await page.locator('#sms-code').fill(sms.sms.code);
      await page.locator('#display-name').fill('验证码验收');
      await shot(page, 'registration-' + width);
      await page.locator('button[type=submit]').click();
      await page.waitForURL('**/account/security');
      await page.getByRole('button', { name: '稍后设置', exact: true }).waitFor();
      assert.match(await page.locator('.page-header').innerText(), /用户 ID：timo\d{6}/);
      await shot(page, 'initial-password-' + width);
      await page.locator('input[autocomplete=new-password]').nth(0).fill('weakword');
      await page.locator('input[autocomplete=new-password]').nth(1).fill('weakword');
      await page.getByRole('button', { name: '保存密码并重新登录', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '字母和数字' }).waitFor();
      await page.locator('input[autocomplete=new-password]').nth(0).fill('abc12345');
      await page.locator('input[autocomplete=new-password]').nth(1).fill('abc12345');
      await page.getByRole('button', { name: '保存密码并重新登录', exact: true }).click();
      await page.waitForURL('**/login?passwordChanged=1');
      await page.locator('#username').fill(phone);
      await page.locator('#password').fill('abc12345');
      await shot(page, 'phone-password-' + width);
      await page.locator('button[type=submit]').click();
      await page.waitForURL((u) => !u.pathname.endsWith('/login'));
      if (width === 375) await page.locator('.menu-toggle').click();
      await page.getByRole('button', {name:'退出登录',exact:true}).click();
      await page.waitForURL('**/login');
      messages.splice(0, messages.length);
      host.send('reset-limits');
      await wait((m) => m.reset);
      await page.getByRole('button', { name: '手机号验证码登录', exact: true }).click();
      await page.locator('#phone').fill(phone);
      await page.getByRole('button', { name: '获取验证码', exact: true }).click();
      const loginSms = await wait((m) => m.sms?.phone === phone);
      await page.locator('#sms-code').fill(loginSms.sms.code);
      await shot(page, 'sms-login-' + width);
      await page.locator('button[type=submit]').click();
      await page.waitForURL((u) => !u.pathname.endsWith('/login'));
      await context.close();
    }
    console.log(
      'ACCOUNT_WEB_UI_PASS 375/1440: 3 legacy roles, registration, first password, strength rejection, verified phone/password relogin, SMS relogin',
    );
  } finally {
    await browser?.close();
    host.send('stop');
    await new Promise((r) => host.once('exit', r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
