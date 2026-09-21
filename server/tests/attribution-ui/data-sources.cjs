// Isolated database and localhost browser regression. Never contacts a live account.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..'), serverRoot = path.join(root, 'server');
const out = path.join(root, '.opc-work/data-source-ui');
fs.mkdirSync(out, { recursive: true });
const json = data => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'ok', data }) });
async function main() {
  const log = fs.createWriteStream(path.join(out, 'host.log'));
  const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(serverRoot, 'node_modules/tsx/dist/loader.mjs')).href, path.join(__dirname, 'data-sources-host.ts')], {
    cwd: serverRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ATTRIBUTION_UI_TEST: '1', ATTRIBUTION_LINKAGE_TEST: '1' },
  });
  child.stdout.pipe(log); child.stderr.pipe(log);
  let browser; const errors = [], inventory = [], failedResponses = [];
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('UI host timeout')), 90000);
      child.once('message', m => { clearTimeout(timer); resolve(m.port); });
      child.once('exit', code => { clearTimeout(timer); reject(Error('UI host exited '+code)); });
    });
    const base = `http://127.0.0.1:${port}`;
    await new Promise(resolve => { child.once('message', resolve); child.send('seed-audit-data'); });
    async function resetAuditLimit() {
      await new Promise(resolve => { child.once('message', resolve); child.send('reset-audit-limit'); });
    }
    browser = await chromium.launch({ headless: true, channel: process.env.OPC_BROWSER_CHANNEL || 'msedge' });
    for (const role of ['admin', 'leader', 'creator']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', e => errors.push({ role, url: page.url(), error: e.message }));
      page.on('response', r => { if (r.status() >= 400 && r.url().includes('/api/')) failedResponses.push({ role, url: r.url(), status: r.status() }); });
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto(base+'/app/login');
      await page.locator('input[autocomplete="username"]').fill(role);
      await page.locator('input[type="password"]').fill('isolated_password');
      await page.locator('button[type="submit"]').click();
      await page.waitForURL('**/dashboard');
      const roleDir = path.join(root, `apps/platform-${role}/src`);
      const moduleText = fs.readFileSync(path.join(roleDir, 'modules/zhihu/routes.ts'), 'utf8').split('export const zhihuRoutes')[0];
      const workspaceText = fs.readFileSync(path.join(roleDir, 'workspace-routes.ts'), 'utf8');
      const paths = [...workspaceText.matchAll(/path:\s*'([^']+)'/g)].map(m=>m[1]).concat([...moduleText.matchAll(/path:\s*'([^']+)'/g)].map(m=>'modules/zhihu/'+m[1]));
      let visit = 0;
      for (const routePath of [...new Set(paths)]) {
        await resetAuditLimit();
        // Separate automated cold-load visits from the production per-IP request limiter.
        await context.setExtraHTTPHeaders({ 'X-Forwarded-For': `127.0.${['admin','leader','creator'].indexOf(role)+1}.${++visit}` });
        await page.goto(base+'/app/'+routePath);
        await page.waitForLoadState('networkidle');
        assert(!new URL(page.url()).pathname.endsWith('/login'), 'unexpected logout at '+role+' '+routePath);
        const body = await page.locator('body').innerText();
        assert(!body.includes('NaN') && !body.includes('Invalid Date'), role+' '+routePath+' invalid data');
        inventory.push({ role, path: routePath, finalPath: new URL(page.url()).pathname, headings: await page.locator('h1').allTextContents(), alerts: await page.locator('[role="alert"]').allTextContents() });
      }
      console.log(role+' routes checked: '+paths.length);
      await resetAuditLimit();
      await page.goto(base+'/app/modules/zhihu/earnings');
      await page.getByRole('cell',{name:'旧版作品联动词',exact:true}).waitFor();
      await page.getByRole('cell',{name:'测试渠道',exact:true}).waitFor();
      await page.getByRole('cell',{name:'达人',exact:true}).waitFor();
      assert((await page.locator('body').innerText()).includes('123.45'));
      await context.setExtraHTTPHeaders({ 'X-Forwarded-For': `127.0.${['admin','leader','creator'].indexOf(role)+1}.200` });
      await page.goto(base+'/app/modules/zhihu/works');
      await page.getByRole('button', { name: '登记作品', exact: true }).waitFor();
      let count=205, failPage=false;
      const requestedPages=[];
      const plansHandler=async route=>{
        const url=new URL(route.request().url()), n=Number(url.searchParams.get('page')||1), size=Number(url.searchParams.get('pageSize')||20);
        requestedPages.push(n);
        if(failPage&&n===2) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:50300,message:'测试分页失败'})});
        const plans=Array.from({length:count},(_,i)=>({id:String(i+1),keyword:i===204?'末页关键词':i===203?'重名词':i===202?'重名词':'测试词'+(i+1),channelName:i===204?'末页渠道':'测试渠道',status:'active',syncStatus:'synced'}));
        return route.fulfill(json({list:plans.slice((n-1)*size,n*size),total:count,page:n,pageSize:size}));
      };
      await page.route('**/api/v1/modules/zhihu/plans?*',plansHandler);
      await page.getByRole('button',{name:'登记作品',exact:true}).click();
      await page.getByText('共 205 条可选计划',{exact:false}).waitFor();
      assert.deepEqual(requestedPages,[1,2,3]);
      const picker=page.getByRole('combobox',{name:'所属计划'}), submit=page.getByRole('button',{name:'确认登记',exact:true});
      await picker.fill('末页关键词');
      await page.getByRole('option',{name:/末页关键词/}).click();
      assert.equal(await submit.isEnabled(),true);
      await picker.fill('不存在的关键词');
      await page.getByText('没有匹配的计划，请更换关键词').waitFor();
      assert.equal(await submit.isDisabled(),true,'typing must invalidate previous selection');
      await picker.fill('重名词'); assert.equal(await page.locator('#work-plan-options').getByRole('option').count(),2);
      await picker.press('ArrowUp'); await picker.press('Enter');
      assert.equal(await submit.isEnabled(),true);
      await picker.fill('末页渠道'); await picker.press('ArrowDown'); await picker.press('Enter');
      await page.locator('.dialog-card').getByPlaceholder('发布作品的媒体账号名').fill('分页回归账号');
      await page.locator('.dialog-card input[type="url"]').fill('https://example.com/regression');
      await page.locator('.dialog-card input[type="datetime-local"]').fill('2026-09-20T10:30');
      let submitted;
      const postHandler=async route=>{ if(route.request().method()!=='POST')return route.fallback(); submitted=route.request().postDataJSON(); return route.fulfill(json({id:'test-work'})); };
      await page.route('**/api/v1/modules/zhihu/compositions',postHandler);
      await submit.click(); await page.locator('.dialog-overlay').waitFor({state:'hidden'});
      assert.equal(submitted.planId,'205');
      count=206; requestedPages.length=0;
      await page.getByRole('button',{name:'登记作品',exact:true}).click();
      await page.getByText('共 206 条可选计划',{exact:false}).waitFor();
      assert.deepEqual(requestedPages,[1,2,3]);
      await picker.fill('206'); await page.getByRole('option',{name:/计划编号：206/}).waitFor();
      await page.screenshot({path:path.join(out,role+'-search.png'),fullPage:false,animations:'disabled'});
      await page.locator('.dialog-close').click();
      failPage=true;
      await page.getByRole('button',{name:'登记作品',exact:true}).click();
      await page.getByRole('button',{name:'重新加载',exact:true}).waitFor(); assert.equal(await submit.isDisabled(),true);
      failPage=false; await page.getByRole('button',{name:'重新加载',exact:true}).click();
      await page.getByText('共 206 条可选计划',{exact:false}).waitFor();
      await page.locator('.dialog-close').click();
      await page.unroute('**/api/v1/modules/zhihu/plans?*',plansHandler);
      await page.unroute('**/api/v1/modules/zhihu/compositions',postHandler);
      // Submit a real composition to the isolated database using a visible, real plan.
      await page.getByRole('button',{name:'登记作品',exact:true}).click();
      await page.getByText('共 2 条可选计划',{exact:false}).waitFor();
      await picker.fill('旧版作品联动词'); await page.getByRole('option',{name:/旧版作品联动词/}).click();
      await page.locator('.dialog-card').getByPlaceholder('发布作品的媒体账号名').fill(role+'回归账号');
      await page.locator('.dialog-card input[maxlength="255"]').fill(role+'登记流程回归');
      await page.locator('.dialog-card input[type="url"]').fill('https://example.com/real-'+role);
      await page.locator('.dialog-card input[type="datetime-local"]').fill('2026-09-20T10:30');
      const responsePromise=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/compositions'));
      await submit.click(); const response=await responsePromise; assert.equal(response.status(),201,await response.text());
      await page.locator('.dialog-overlay').waitFor({state:'hidden'});
      await page.getByText(role+'登记流程回归',{exact:true}).waitFor();
      console.log(role+' searchable picker and persisted registration passed');
      if(role==='admin') {
        const officialHandler=async route=>{
          const url=new URL(route.request().url());
          if(url.pathname.endsWith('/salt/boards')) return route.fulfill(json({data:[{id:'board-1',name:'测试榜单'}]}));
          const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||100);
          const data=Array.from({length:205},(_,i)=>({id:String(i+1),title:'内容'+(i+1),keyword:'词'+(i+1),status:3,dramaId:String(i+1)}));
          return route.fulfill(json({data:data.slice(offset,offset+limit),pagination:{total:205,offset,limit}}));
        };
        await page.route('**/api/v1/modules/zhihu/zhihu-content/**',officialHandler);
        for(const [routePath,last] of [['salt','内容205'],['comments','词205'],['risk','词205'],['media','内容205']]) {
          await resetAuditLimit();
          await page.goto(base+'/app/modules/zhihu/'+routePath);
          await page.getByText(last,{exact:true}).waitFor();
          assert.equal(await page.locator('tbody tr').count(),205);
        }
        await page.getByRole('button',{name:'漫剧',exact:true}).click();
        await page.getByText('内容205',{exact:true}).waitFor();
        assert.equal(await page.locator('tbody tr').count(),205);
        console.log('Official content pagination: salt, intercept, risk, audio and comic passed');
      }
      await context.close();
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({inventory,failedResponses,errors},null,2));
    console.log('PASS '+inventory.length+' route visits; all three registration flows persisted');
  } catch(error) {
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({inventory,failedResponses,errors,error:String(error)},null,2));
    if(browser) for(const context of browser.contexts()) for(const page of context.pages()) await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
    throw error;
  } finally {
    await browser?.close();
    if(child.connected){ child.send('stop'); await new Promise(resolve=>{ const timer=setTimeout(()=>{child.kill();resolve()},30000);child.once('exit',()=>{clearTimeout(timer);resolve()})}); }
    else child.kill();
    log.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
