const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..'), out = process.env.OPC_REVIEW_OUTPUT ? path.resolve(process.env.OPC_REVIEW_OUTPUT) : path.resolve(root, '../改造/截图_2026-10-09/P2-home');
fs.mkdirSync(out, { recursive: true });
async function main() {
  const log = fs.createWriteStream(path.resolve(root, '../.opc-work/release/p2-home-host.log'));
  const host = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href, path.join(__dirname, 'review-host.ts')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, REMEDIATION_REVIEW: '1' } });
  host.stdout.pipe(log); host.stderr.pipe(log);
  let browser, activePage, activeErrors, activeRole;
  try {
    const port = await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(Error('演示环境启动超时')), 120000); host.once('message', data => { clearTimeout(timeout); resolve(data.port); }); host.once('exit', code => { clearTimeout(timeout); reject(Error('演示环境退出 ' + code)); }); });
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const results = [];
    const roles = [['admin','admin','Admin123456!'],['operations','review_ops','Review123456'],['finance','review_finance','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456']];
    for (const [role, username, password] of roles.filter(([role]) => !process.env.OPC_REVIEW_ROLES || process.env.OPC_REVIEW_ROLES.split(',').includes(role))) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }), page = await context.newPage(), errors = [];
      activePage = page; activeErrors = errors; activeRole = role;
      page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000);
      page.on('response', async response => { if(response.status()>=400) console.log('HTTP_ERROR',response.status(),role,new URL(response.url()).pathname,(await response.text().catch(()=>'' )).slice(0,500)); });
      page.on('requestfailed', request => { if(request.url().includes('/api/')) console.log('REQUESTFAILED',role,new URL(request.url()).pathname,request.failure()?.errorText); });
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto(`http://127.0.0.1:${port}/app/login`);
      await page.locator('input[autocomplete="username"]').fill(username); await page.locator('input[type="password"]').fill(password);
      const loginResponse = page.waitForResponse(response => response.url().endsWith('/core/auth/login'));
      await page.locator('button[type="submit"]').click(); const login = await loginResponse, identity = (await login.json()).data;
      const headers = { Authorization: 'Bearer ' + identity.token, 'X-Client-Id': login.request().headers()['x-client-id'] };
      await page.waitForURL(url => !url.pathname.endsWith('/login'));
      await page.getByRole('heading', { name: '现在要做', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('.home-page')?.getAttribute('aria-busy') === 'false');
      const response = await context.request.get(`http://127.0.0.1:${port}/api/v1/core/dashboard`, { headers });
      assert.equal(response.status(), 200); const data = (await response.json()).data;
      assert(data.groups.length > 0); assert(data.groups.every(group => group.services.every(service => service.status === 'ready')), JSON.stringify(data));
      const metrics = data.groups.flatMap(group => group.services.flatMap(service => service.metrics));
      if (role === 'operations') assert(!metrics.some(metric => metric.unit === '元'), JSON.stringify(data));
      else assert(metrics.some(metric => metric.unit === '元'));
      if (['creator','independent','leader'].includes(role)) {
        const refused = await context.request.get(`http://127.0.0.1:${port}/api/v1/core/dashboard?projectId=999999`, { headers }); assert.equal(refused.status(), 403);
        const words = await context.request.get(`http://127.0.0.1:${port}/api/v1/modules/zhihu/keywords?projectId=1&accountId=1&view=owned`, { headers });
        assert.equal(words.status(), 200); assert((await words.json()).data.list.every(word => word.executorId === identity.user.id || word.leaderId === identity.user.id));
      }
      const nav = await page.locator('.studio-nav-scroll').innerText();
      assert(!/已接入业务|更多功能|业务模块|工作台/.test(nav), nav);
      if (role === 'operations') assert(!/财务|计费规则|我的收益/.test(nav), nav);
      if (role === 'finance') assert(!/任务管理|作品管理|成员与团队/.test(nav), nav);
      const todo = page.locator('.home-todo').first();
      if (await todo.count()) {
        const target = new URL(await todo.getAttribute('href'), page.url());
        await todo.click(); await page.waitForURL(url=>url.pathname===target.pathname && url.search===target.search);
        await page.locator('h1').first().waitFor();
        assert.equal(new URL(page.url()).pathname, target.pathname);
      }
      const destinations = role === 'finance' ? ['dashboard','finance','rates','me'] : role === 'operations' ? ['dashboard','tasks','works','projects','data-issues','me'] : role === 'admin' ? ['dashboard','tasks','works','projects','rates','me'] : ['dashboard','task-hall','tasks','income','academy','me'];
      for (const destination of destinations) {
        const navLabels={dashboard:'首页',finance:'财务',rates:'计费规则',me:'我的',tasks:role==='leader'?'团队任务':['creator','independent'].includes(role)?'我的任务':'任务管理',works:'作品管理',projects:'项目设置','task-hall':'任务大厅',income:'我的收益',academy:'学院'};
        const button=navLabels[destination]&&page.locator('.studio-nav-scroll').getByRole('button',{name:navLabels[destination],exact:true});
        if(button && await button.count()) { await button.click(); await page.waitForURL(url=>url.pathname==='/app/'+destination); }
        else await page.goto(`http://127.0.0.1:${port}/app/${destination}`);
        if(destination==='dashboard')await page.reload();
        await page.locator('h1').first().waitFor(); assert.equal(new URL(page.url()).pathname, '/app/' + destination);
        if (destination === 'dashboard') await page.waitForFunction(() => document.querySelector('.home-page')?.getAttribute('aria-busy') === 'false');
        if (['tasks','task-hall','works','finance','income','data-issues'].includes(destination)) await page.waitForFunction(() => !!document.querySelector('.work-card,.financial-review,.finance-work,.issues,.platform-tasks .data-grid'));
        for (const width of [1440, 375]) {
          await page.setViewportSize({ width, height: 1050 });
          if (width===375) { if (await page.locator('.studio-app').getAttribute('data-menu-open')==='true') await page.locator('.menu-toggle').click(); await page.waitForFunction(()=>getComputedStyle(document.querySelector('.studio-backdrop')).opacity==='0'); }
          await page.evaluate(()=>window.scrollTo(0,0));
          await page.screenshot({ path: path.join(out, `${role}-${destination}-${width}.png`), fullPage: true, animations: 'disabled' });
          const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, window: innerWidth }));
          assert(widths.scroll <= widths.window + 1, `${role}/${destination}/${width}: ${JSON.stringify(widths)}`);
          if (destination === 'dashboard') assert.equal(await page.locator('.home-error').count(), 0);
        }
        await page.setViewportSize({ width: 1440, height: 1050 });
      }
      assert.deepEqual(errors, []); results.push({ role, destinations, widths: [1440, 375], projectScopeDenied: !['admin','operations','finance'].includes(role), todoNavigation: true, metrics: metrics.map(m => m.key), errors });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
  } catch (error) {
    if (activePage) { console.log('FAILURE', activeRole, activePage.url(), JSON.stringify(activeErrors), (await activePage.locator('body').innerText()).slice(0,1800)); await activePage.screenshot({path:path.join(out,'failure.png'),fullPage:true}); }
    throw error;
  } finally {
    await browser?.close(); if (host.connected) host.send('stop');
    await new Promise(resolve => { const timeout = setTimeout(() => { host.kill(); resolve(); }, 10000); host.once('exit', () => { clearTimeout(timeout); resolve(); }); }); log.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
