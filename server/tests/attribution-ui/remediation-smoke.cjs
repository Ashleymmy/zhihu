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
 let browser,activePage,activeRole='';
 try{
  const port=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('隔离演示环境启动超时，查看 host.log')),120000);
   host.once('message',message=>{clearTimeout(timer);resolve(message.port)});
   host.once('exit',code=>{clearTimeout(timer);reject(Error('隔离演示环境退出 '+code))});
  });
  browser=await chromium.launch({headless:true,channel:process.env.OPC_BROWSER_CHANNEL||'msedge'});
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
  if(process.env.OPC_REVIEW_ROLE_PRICES_ONLY==='1'){
   await require('./role-prices-flow.cjs')({browser,port,out,date});
   console.log('拉新角色计价与旧入口六角色验收通过');return;
  }
  if(process.env.OPC_REVIEW_INCOME_ONLY==='1'){
   await require('./platform-income-flow.cjs')({browser,port,out,date});
   console.log('平台收益与任务、提现全流程通过');return;
  }
  if(process.env.OPC_REVIEW_STAFF_ONLY==='1'){
   await require('./staff-self-flow.cjs')({browser,port,out,date});
   console.log('管理员本人执行与业绩隔离全流程通过');return;
  }
  if(process.env.OPC_REVIEW_RATES_ONLY==='1'){
   await require('./finance-rates-flow.cjs')({browser,port,out,date});
   console.log('财务单价入口与未来价格发布全流程通过');return;
  }
  if(process.env.OPC_REVIEW_COMPARISON_ONLY==='1'){
   await require('./comparison-flow.cjs')({browser,port,out,date});
   await require('./risk-review-flow.cjs')({browser,port,out,date});
   console.log('原值新值、金额表格与风险回归通过');return;
  }
  if(process.env.OPC_REVIEW_RISK_ONLY==='1'){
   await require('./risk-review-flow.cjs')({browser,port,out,date});
   console.log('风险核实与不计费更正全流程通过');return;
  }
  if(process.env.OPC_REVIEW_HISTORY_ONLY==='1'){
   await require('./name-matching-flow.cjs')({browser,port,out,date});
   await require('./historical-work-flow.cjs')({browser,port,out,date});
   console.log('历史登记与作品核验全流程通过');return;
  }
  const results=[];
  const roles=process.env.OPC_REVIEW_REPAIR_ONLY==='1'?[]:[['admin','admin','Admin123456!'],['finance','review_finance','Review123456'],['operations','review_ops','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456']];
  for(const [role,username,password] of roles.filter(([role])=>!process.env.OPC_REVIEW_ROLES||process.env.OPC_REVIEW_ROLES.split(',').includes(role))){
   const roleStarted=Date.now();activeRole=role;
   const context=await browser.newContext({viewport:{width:1440,height:1100}});
   const page=await context.newPage();activePage=page;page.setDefaultTimeout(15000);
   page.on('response',response=>{if(response.status()===429)console.log(role+' 请求达到频率限制：'+new URL(response.url()).pathname)});
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   if(role==='operations')page.on('request',req=>{if(new URL(req.url()).pathname.endsWith('/price-agreements'))errors.push('运营页面不应读取报价');});
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
   const endpoint=`http://127.0.0.1:${port}/api/v1/modules/zhihu/workbench?projectId=1&accountId=1&from=${date}&to=${date}&viewVersion=2`;
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
   if(role==='operations'){await page.locator('.studio-app').waitFor();await page.getByRole('heading',{level:1}).waitFor();}
   if(role!=='operations')await page.getByText(role==='leader'?'团队业绩与分成':role==='admin'||role==='finance'?'上传知乎报表，自动计算每个人的金额':'我的收入明细',{exact:true}).first().waitFor();
   if(role==='admin'||role==='finance')await page.getByText('按角色单价',{exact:true}).first().waitFor({state:'attached'});
   if(role==='admin'||role==='finance'){
    await page.getByText('拉新：可计费 37 单 ¥313.00',{exact:true}).waitFor();
    await page.getByText('报表问题与更正',{exact:true}).click();
    const missing=page.locator('.issues tbody tr').filter({hasText:'悬疑短篇'});
    assert.equal(await missing.getByRole('button',{name:'指定执行人',exact:true}).count(),0);
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
    await page.locator('.analysis-run').getByRole('heading',{name:'读取报表',exact:true}).waitFor();
    assert((await page.locator('.analysis-run').innerText()).includes('1 行格式需要修正'));
    await page.locator('.analysis-run').screenshot({path:path.join(out,'analysis-read-375.png'),animations:'disabled',style:'.studio-header { visibility: hidden; }'});
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:path.join(out,'finance-upload-375.png'),fullPage:true,animations:'disabled'});
    const activation=Buffer.from(`日期,渠道名称,关键词,拉活量,结算金额\n${date},知乎故事一代渠道,重生千金,1,3.00\n${date},知乎故事一代渠道,都市逆袭小说,2,4.00\n${date},知乎故事一代渠道,古言虐恋,3,6.00`);
    await page.locator('input[type="file"]').setInputFiles({name:'拉活验收.csv',mimeType:'text/csv',buffer:activation});
    await page.getByRole('button',{name:'上传并自动分析',exact:true}).click();
    await page.getByText('这份文件有“拉活量”列，看起来是拉活表。',{exact:true}).waitFor();
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:path.join(out,'finance-type-mismatch-375.png'),fullPage:true,animations:'disabled'});
    const switched=page.waitForResponse(r=>r.url().endsWith('/workbench/import')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'按拉活处理',exact:true}).click();
    const uploaded=await switched;assert.equal(uploaded.status(),202,await uploaded.text());
    await page.getByText('拉活验收.csv · 读取结果',{exact:true}).waitFor();
    const after=await context.request.get(endpoint,{headers:{Authorization:'Bearer '+token,'X-Client-Id':client}});
    const afterData=(await after.json()).data;
    assert.equal(afterData.summary.orders,'42');
    assert(afterData.entries.some(e=>e.keyword==='重生千金'&&e.metricType==='activation'));
    assert(afterData.entries.some(e=>e.keyword==='重生千金'&&e.amount==='1.2000'&&e.settlementMismatch?.actual==='3.0000'));
    await page.getByText('拉活：可计费 6 个 ¥8.40',{exact:true}).waitFor();
    await page.locator('.type-filter select').selectOption('activation');
    assert((await page.locator('.bill-details .mobile-groups').innerText()).includes('结算金额对不上：报表 ¥3.00，按拉活量应为 ¥2.00'));
    for(const width of [1440,375]){
     await page.setViewportSize({width,height:1100});
     await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
     await page.screenshot({path:path.join(out,`finance-activation-${width}.png`),fullPage:true,animations:'disabled'});
     await page.locator('.bill-details').screenshot({path:path.join(out,`finance-activation-details-${width}.png`),animations:'disabled',style:'.studio-header { visibility: hidden; }'});
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }
    const legacyResponse=await context.request.get(endpoint.replace('&viewVersion=2',''),{headers:{Authorization:'Bearer '+token,'X-Client-Id':client}});
    assert.equal(legacyResponse.status(),200);
    const legacyData=(await legacyResponse.json()).data;
    assert(legacyData.entries.every(e=>e.amount!==null&&e.metricType==='new_user'));
    assert(legacyData.pendingEntries.some(e=>e.amount===null));
    assert.notEqual(legacyData.reviewHash,afterData.reviewHash);
    const legacyConfirm=await context.request.post(`http://127.0.0.1:${port}/api/v1/modules/zhihu/workbench/confirm`,{headers:{Authorization:'Bearer '+token,'X-Client-Id':client},data:{projectId:'1',accountId:'1',from:date,to:date,reviewHash:legacyData.reviewHash,acknowledged:true,requestKey:crypto.randomUUID()}});
    assert.equal(legacyConfirm.status(),200,await legacyConfirm.text());
    const refreshed=await context.request.get(endpoint,{headers:{Authorization:'Bearer '+token,'X-Client-Id':client}});
    const refreshedData=(await refreshed.json()).data;
    assert.equal(refreshedData.summary.byType.activation.confirmedPayable,'0.0000');
    assert(refreshedData.entries.some(e=>e.keyword==='重生千金'&&e.metricType==='new_user'&&e.status==='confirmed'));
    await page.reload();await page.locator('input[name="reportType"][value="activation"]').waitFor();
    assert(await page.locator('input[name="reportType"][value="activation"]').isChecked());
    const orders=Buffer.from(`日期,渠道名称,关键词,订单量\n${date},知乎故事一代渠道,重生千金,20`);
    await page.locator('input[type="file"]').setInputFiles({name:'切回拉新.csv',mimeType:'text/csv',buffer:orders});
    await page.getByRole('button',{name:'上传并自动分析',exact:true}).click();
    await page.getByRole('button',{name:'按拉新订单处理',exact:true}).click();
    await page.getByText('切回拉新.csv · 读取结果',{exact:true}).waitFor();
    assert(await page.locator('input[name="reportType"][value="new_user"]').isChecked());
   }
   if(role!=='finance'){
    await page.goto(`http://127.0.0.1:${port}/app/modules/zhihu/operations`);
    await page.getByRole('heading',{name:role==='admin'||role==='operations'?'关键词管理':role==='leader'?'团队关键词':'我的关键词',level:2,exact:true}).waitFor();
    if(role!=='independent')await page.getByText('已登记 1 个作品',{exact:true}).waitFor();
    assert(!(await page.locator('body').innerText()).includes('已登记作品，查看提交结果'));
    for(const width of [1440,375]){
     await page.setViewportSize({width,height:1100});await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
     await page.screenshot({path:path.join(out,`${role}-keyword-count-${width}.png`),fullPage:true,animations:'disabled'});
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }
   }
   assert.deepEqual(errors,[]);
   results.push({role,status:response.status(),widths:[1440,375]});
   await context.close();
   activePage=null;
   console.log(role+' 页面验收通过');
   // Keep the six real logins and uploads within the application's normal rate
   // limit. This harness must not weaken or bypass the production limiter.
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,20000-(Date.now()-roleStarted))));
  }
  if(process.env.OPC_REVIEW_BASE_ONLY==='1'){
   fs.writeFileSync(path.join(out,'base-result.json'),JSON.stringify({date,results},null,2));
   console.log('基础角色验收通过：'+JSON.stringify(results));return;
  }
  // Repair the unowned demo keyword through the real finance page, then verify
  // its keyword page. This runs after baseline role checks so their totals stay stable.
  const repairContext=await browser.newContext({viewport:{width:375,height:1100}});
  const repair=await repairContext.newPage();activePage=repair;activeRole='retro-assignment';repair.setDefaultTimeout(15000);
  const repairErrors=[];repair.on('pageerror',e=>repairErrors.push(e.message));
  await repair.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await repair.goto(`http://127.0.0.1:${port}/app/login`);
  await repair.locator('input[autocomplete="username"]').fill('admin');await repair.locator('input[type="password"]').fill('Admin123456!');
  await repair.locator('button[type="submit"]').click();await repair.waitForURL(url=>!url.pathname.endsWith('/login'));
  await repair.goto(`http://127.0.0.1:${port}/app/modules/zhihu/finance`);
  const unowned=repair.locator('.bill-details .grid-card').filter({hasText:'悬疑短篇'});
  await unowned.getByRole('button',{name:'指定执行人',exact:true}).click();
  const dialog=repair.getByRole('dialog',{name:'指定执行人 · 悬疑短篇',exact:true});
  await dialog.getByLabel('执行人',{exact:true}).selectOption('3');
  assert.equal(await dialog.getByLabel('从这天起的订单算给 TA',{exact:true}).inputValue(),date);
  const earlier=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
  await dialog.getByLabel('从这天起的订单算给 TA',{exact:true}).fill(earlier);
  for(const width of [1440,375]){
   await repair.setViewportSize({width,height:1100});
   await repair.screenshot({path:path.join(out,`retro-dialog-${width}.png`),fullPage:false,animations:'disabled'});
   assert(await repair.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  await dialog.getByRole('button',{name:'确定',exact:true}).click();
  await repair.getByText('已指定给 小李，相关金额已重新计算。',{exact:true}).waitFor();
  const repaired=repair.locator('.bill-details .grid-card').filter({hasText:'悬疑短篇'}).filter({hasText:'小李'});
  assert((await repaired.innerText()).includes('¥40.00'));
  for(const width of [1440,375]){
   await repair.setViewportSize({width,height:1100});await repair.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
   await repair.screenshot({path:path.join(out,`retro-finance-${width}.png`),fullPage:true,animations:'disabled'});
  }
  await repair.locator('input[name="reportType"][value="new_user"]').check();
  await repair.locator('input[type="file"]').setInputFiles({name:'默认单价验收.csv',mimeType:'text/csv',buffer:Buffer.from(`日期,渠道名称,关键词,订单量\n${earlier},知乎故事一代渠道,悬疑短篇,10`)});
  await repair.getByRole('button',{name:'上传并自动分析',exact:true}).click();
  await repair.getByText('拉新：可计费 10 单 ¥85.00',{exact:true}).waitFor();
  const rateCard=repair.locator('.bill-details .grid-card').filter({hasText:'悬疑短篇'}).filter({hasText:'小李'});
  assert((await rateCard.innerText()).includes('¥80.00'));assert((await rateCard.innerText()).includes('按角色单价'));
  for(const width of [1440,375]){
   await repair.setViewportSize({width,height:1100});await repair.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
   await repair.screenshot({path:path.join(out,`admin-default-rate-${width}.png`),fullPage:true,animations:'disabled'});
   await repair.locator('.bill-details').screenshot({path:path.join(out,`default-rate-details-${width}.png`),animations:'disabled',style:'.studio-header { visibility: hidden; }'});
   assert(await repair.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  await repair.locator('input[type="file"]').setInputFiles({name:'分析选择验收.csv',mimeType:'text/csv',buffer:Buffer.from(`日期,渠道名称,关键词,订单量\n${date},知乎故事一代渠道,重生千金,21`)});
  await repair.getByRole('button',{name:'上传并自动分析',exact:true}).click();
  const question=repair.locator('.analysis-run').getByRole('group',{name:new RegExp('原来 20 单，这份报表是 21 单')});
  await question.waitFor();assert.equal(await question.getByRole('button').count(),3);
  for(const width of [1440,375]){
   await repair.setViewportSize({width,height:1100});await repair.locator('.analysis-run').screenshot({path:path.join(out,`analysis-ask-${width}.png`),animations:'disabled',style:'.studio-header { visibility: hidden; }'});
   assert(await repair.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  await question.getByRole('button',{name:'暂时跳过',exact:true}).click();
  await repair.getByText('已暂时跳过，这项记录仍保留在待处理中。',{exact:true}).waitFor();
  assert((await question.innerText()).includes('已暂时跳过，仍可在这里处理'));
  await question.getByRole('button',{name:'采用这份报表',exact:true}).click();
  await repair.getByText('已保存选择，相关金额已自动更新。',{exact:true}).waitFor();
  assert.equal(await repair.locator('.analysis-run .ask-box').count(),0);
  await repair.locator('.analysis-run').getByText('¥178.50',{exact:true}).waitFor();
  for(const width of [1440,375]){
   await repair.setViewportSize({width,height:1100});await repair.locator('.analysis-run').screenshot({path:path.join(out,`analysis-done-${width}.png`),animations:'disabled',style:'.studio-header { visibility: hidden; }'});
   assert(await repair.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  await repair.goto(`http://127.0.0.1:${port}/app/modules/zhihu/operations?keyword=悬疑短篇`);
  await repair.getByRole('heading',{name:'关键词管理',exact:true}).waitFor();
  await repair.getByPlaceholder('输入关键词或小说原名').fill('悬疑短篇');await repair.getByRole('button',{name:'搜索',exact:true}).click();
  const word=repair.locator('.engine-table tbody tr').filter({hasText:'悬疑短篇'});
  await word.waitFor();assert((await word.innerText()).includes('使用中'));assert(!(await word.innerText()).includes('历史计划'));
  for(const width of [1440,375]){
   await repair.setViewportSize({width,height:1100});await repair.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
   await repair.screenshot({path:path.join(out,`retro-keywords-${width}.png`),fullPage:true,animations:'disabled'});
   assert(await repair.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  assert.deepEqual(repairErrors,[]);await repairContext.close();activePage=null;
  results.push({role:'admin-retro-assignment',status:200,widths:[1440,375]});
  for(const [role,username,amount] of [['finance','review_finance','80.00'],['leader','leader_wang','5.00'],['creator','creator_li','80.00']]){
   await new Promise(resolve=>setTimeout(resolve,20000));activeRole=role+'-default-rate';
   const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();activePage=page;
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   await page.goto(`http://127.0.0.1:${port}/app/login`);await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[type="password"]').fill('Review123456');
   await page.locator('button[type="submit"]').click();await page.waitForURL(url=>!url.pathname.endsWith('/login'));
   await page.goto(`http://127.0.0.1:${port}/app/modules/zhihu/${role==='finance'?'finance':'wallet'}`);
   if(role==='finance'){
    await page.locator('.period-filter input[type="date"]').first().fill(earlier);await page.locator('.period-filter input[type="date"]').last().fill(earlier);await page.getByRole('button',{name:'查看账单',exact:true}).click();
    await page.getByText('按角色单价',{exact:true}).first().waitFor({state:'attached'});
    const card=page.locator('.bill-details .grid-card').filter({hasText:'悬疑短篇'}).filter({hasText:'¥'+amount});
    await card.waitFor({state:'attached'});assert((await card.innerText()).includes('按角色单价'));
   }else{
    await page.getByLabel('开始日期').fill(earlier);await page.getByLabel('结束日期').fill(earlier);await page.getByRole('button',{name:'查看收益',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.platform-income')?.getAttribute('aria-busy')==='false');
    const row=page.locator('.income-details .grid-row').filter({hasText:'悬疑短篇'});assert((await row.innerText()).includes('¥'+amount));
    await row.getByRole('button',{name:'悬疑短篇',exact:true}).click();await page.locator('.income-calculation').getByText(role==='leader'?'10单 × ¥0.5000 = ¥5.00':'10单 × ¥8.0000 = ¥80.00',{exact:true}).waitFor();await page.keyboard.press('Escape');
   }
   for(const width of [1440,375]){
    await page.setViewportSize({width,height:1100});await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:path.join(out,`${role}-default-rate-${width}.png`),fullPage:true,animations:'disabled'});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   }
   assert.deepEqual(errors,[]);await context.close();activePage=null;results.push({role:role+'-default-rate',status:200,widths:[1440,375]});
  }
  await require('./name-matching-flow.cjs')({browser,port,out,date});
  await require('./historical-work-flow.cjs')({browser,port,out,date});
  results.push({role:'admin-finance-operations-names',status:200,widths:[1440,375]});
  fs.writeFileSync(path.join(out,process.env.OPC_REVIEW_REPAIR_ONLY==='1'?'repair-result.json':'result.json'),JSON.stringify({date,results},null,2));
  console.log('角色验收通过：'+JSON.stringify(results));
 }catch(error){
  if(activePage&&!activePage.isClosed()){
   await activePage.screenshot({path:path.join(out,'failed-'+activeRole+'.png'),fullPage:true,animations:'disabled'});
   fs.writeFileSync(path.join(out,'failed-'+activeRole+'.txt'),await activePage.locator('body').innerText());
  }
  throw error;
 }finally{
  await browser?.close();
  if(host.connected)host.send('stop');
  await new Promise(resolve=>{if(host.exitCode!==null)return resolve();const timeout=setTimeout(()=>{host.kill();resolve()},30000);host.once('exit',()=>{clearTimeout(timeout);resolve()})});
  log.end();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
