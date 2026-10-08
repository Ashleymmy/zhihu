const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../..');
const out=path.resolve(root,'../.opc-work/remediation-review');
fs.mkdirSync(out,{recursive:true});
async function main(){
 const log=fs.createWriteStream(path.join(out,'host.log'));
 const host=spawn(process.execPath,['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(__dirname,'review-host.ts')],{
  cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,REMEDIATION_REVIEW:'1'},
 });
 host.stdout.pipe(log);host.stderr.pipe(log);
 let browser;
 try{
  const port=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('隔离演示环境启动超时，查看 host.log')),120000);
   host.once('message',message=>{clearTimeout(timer);resolve(message.port)});
   host.once('exit',code=>{clearTimeout(timer);reject(Error('隔离演示环境退出 '+code))});
  });
  browser=await chromium.launch({headless:true,channel:process.env.OPC_BROWSER_CHANNEL||'msedge'});
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
  const results=[];
  const roles=[['admin','admin','Admin123456!'],['finance','review_finance','Review123456'],['operations','review_ops','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456']];
  for(const [role,username,password] of roles){
   const context=await browser.newContext({viewport:{width:1440,height:1100}});
   const page=await context.newPage();page.setDefaultTimeout(15000);
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   await page.goto(`http://127.0.0.1:${port}/app/login`);
   await page.locator('input[autocomplete="username"]').fill(username);
   await page.locator('input[type="password"]').fill(password);
   const loginResponse=page.waitForResponse(response=>response.url().endsWith('/core/auth/login'));
   await page.locator('button[type="submit"]').click();
   const login=await loginResponse;assert.equal(login.status(),200,await login.text());
   const token=(await login.json()).data.token;
   const client=login.request().headers()['x-client-id'];
   await page.waitForURL(url=>!url.pathname.endsWith('/login'));
   const endpoint=`http://127.0.0.1:${port}/api/v1/modules/zhihu/workbench?projectId=1&accountId=1&from=${date}&to=${date}`;
   const response=await context.request.get(endpoint,{headers:{Authorization:'Bearer '+token,'X-Client-Id':client}});
   assert.equal(response.status(),role==='operations'?403:200,await response.text());
   const body=await response.json();
   if(role==='operations')assert.equal(body.message,'这里需要财务权限');
   if(role==='admin'||role==='finance'){
    assert.equal(body.data.summary.orders,'42');
    assert.equal(body.data.summary.totalOrders,'44');
    assert.equal(body.data.summary.billableOrders,'37');
    assert.equal(body.data.summary.pendingOrders,'7');
    assert.equal(body.data.summary.payable,'313.0000');
    assert.equal(body.data.entries[0].status,'pending');
    assert.equal(body.data.entries.find(e=>e.keyword==='悬疑短篇').amount,null);
   }
   if(role==='leader'){
    assert(body.data.entries.every(entry=>entry.payeeId==='2'));
    assert(body.data.groups.every(group=>group.payeeId==='2'));
    assert.equal(body.data.summary.receivable,'97.0000');
    assert(body.data.teamPerformance.some(member=>member.name==='小李'&&member.orders==='20'&&member.commission==='10.0000'));
   }
   const destination=role==='operations'?'dashboard':role==='admin'||role==='finance'?'modules/zhihu/finance':'modules/zhihu/wallet';
   await page.goto(`http://127.0.0.1:${port}/app/${destination}`);
   if(role!=='operations')await page.getByText(role==='leader'?'团队业绩与分成':role==='admin'||role==='finance'?'上传知乎报表，自动计算每个人的金额':'我的收入明细',{exact:true}).waitFor();
   if(role==='admin'||role==='finance'){
    await page.getByText('读取 6 行、44 单。可计费 37 单 ¥313.00；还有 7 单在等处理。',{exact:true}).waitFor();
    await page.getByText('报表问题与更正',{exact:true}).click();
    const missing=page.locator('.issues tbody tr').filter({hasText:'悬疑短篇'});
    assert.equal(await missing.getByRole('button').count(),0);
    assert((await missing.innerText()).includes('运营：指定执行人'));
   }
   for(const width of [1440,375]){
    await page.setViewportSize({width,height:1100});
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    if(width===375){
     if(await page.locator('.studio-app').getAttribute('data-menu-open')==='true')await page.locator('.menu-toggle').click();
     await page.waitForFunction(()=>getComputedStyle(document.querySelector('.studio-backdrop')).opacity==='0');
    }
    await page.screenshot({path:path.join(out,`${role}-${width}.png`),fullPage:true,animations:'disabled'});
    if(role==='finance')await page.locator('.bill-details').screenshot({path:path.join(out,`finance-details-${width}.png`),animations:'disabled',style:'.studio-header { visibility: hidden; }'});
    const dimensions=await page.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth}));
    assert(dimensions.body<=dimensions.viewport+1,`${role} ${width}: 横向溢出 ${dimensions.body}`);
   }
   if(role==='finance'){
    const buffer=Buffer.from(`日期,渠道名称,关键词,订单量\n${date},知乎故事一代渠道,重生千金,20\n错日期,知乎故事一代渠道,错误词,1\n合计,,,21`);
    await page.locator('input[type="file"]').setInputFiles({name:'行容错验收.csv',mimeType:'text/csv',buffer});
    await page.getByRole('button',{name:'上传并自动分析',exact:true}).click();
    await page.getByText('第 3 行日期写成了“错日期”，请改成 2026-09-14 这样的格式',{exact:true}).waitFor();
    await page.getByText('汇总行，已跳过',{exact:true}).waitFor();
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:path.join(out,'finance-upload-375.png'),fullPage:true,animations:'disabled'});
   }
   assert.deepEqual(errors,[]);
   results.push({role,status:response.status(),widths:[1440,375]});
   await context.close();
  }
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({date,results},null,2));
  console.log('角色验收通过：'+JSON.stringify(results));
 }finally{
  await browser?.close();
  if(host.connected)host.send('stop');
  await new Promise(resolve=>{if(host.exitCode!==null)return resolve();const timeout=setTimeout(()=>{host.kill();resolve()},30000);host.once('exit',()=>{clearTimeout(timeout);resolve()})});
  log.end();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
