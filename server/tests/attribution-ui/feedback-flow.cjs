const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async function feedbackFlow({browser,port,out,date}){
 const base=`http://127.0.0.1:${port}`,day=new Date(Date.parse(date)-2*86400000).toISOString().slice(0,10);
 for(const [role,username,password] of [['admin','admin','Admin123456!'],['operations','review_ops','Review123456'],['finance','review_finance','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456']]){
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const shot=async label=>{for(const width of [1440,375]){await page.setViewportSize({width,height:1100});if(await page.locator('.studio-app').getAttribute('data-menu-open')==='true')await page.locator('.menu-toggle').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'页面不应横向溢出');const dialog=page.locator('dialog[open]');assert((await dialog.count())<=1,'不能嵌套抽屉');if(await dialog.count()){assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await dialog.screenshot({path:path.join(out,`feedback-${role}-${label}-${width}.png`),animations:'disabled'});}else await page.screenshot({path:path.join(out,`feedback-${role}-${label}-${width}.png`),fullPage:true,animations:'disabled'});}await page.setViewportSize({width:1440,height:1100});};
  try{
   await page.goto(base+'/app/login');await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[type="password"]').fill(password);const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type="submit"]').click();const login=await logging;assert.equal(login.status(),200);await page.waitForURL(url=>!url.pathname.endsWith('/login'));const headers={Authorization:'Bearer '+(await login.json()).data.token,'X-Client-Id':login.request().headers()['x-client-id']};
   if(role==='admin'){
    const options=await context.request.get(base+'/api/v1/modules/zhihu/attribution-options?projectId=1&accountId=1',{headers});assert.equal(options.status(),200);const channel=(await options.json()).data.mappings[0].channelName;
    await page.goto(base+'/app/modules/zhihu/finance');
    await page.getByLabel('拉新订单',{exact:false}).check();
    await page.locator('input[type="file"]').setInputFiles({name:'归属反馈验收.csv',mimeType:'text/csv',buffer:Buffer.from(`日期,渠道,关键词,订单量\n${day},${channel},旧词复核甲,3\n${day},${channel},历史执行复核,4`)});
    await page.getByRole('button',{name:'上传并自动分析',exact:true}).click();
    await page.getByRole('button',{name:'沿用原记录与执行人',exact:true}).waitFor();assert(!(await page.locator('.analysis-run').innerText()).includes('是「旧词复核乙」'));await shot('original-record');
    const saved=page.waitForResponse(r=>r.url().endsWith('/answers')&&r.request().method()==='POST');await page.getByRole('button',{name:'沿用原记录与执行人',exact:true}).click();assert.equal((await saved).status(),200);await page.getByText(/已保存选择，报表已更新/).waitFor();assert.equal(await page.locator('.issues tbody tr').filter({hasText:'旧词复核甲'}).count(),0);
    const row=page.locator('.bill-details tbody tr').filter({hasText:'历史执行复核'});await row.getByRole('button',{name:'核对执行与作品',exact:true}).click();
    const drawer=page.getByRole('dialog',{name:'历史执行复核 · 执行进度'});await drawer.waitFor();await drawer.getByLabel('实际开始日期').fill(day);await drawer.getByLabel('历史作品链接').fill('https://example.com/history-proof');await drawer.getByLabel('作品说明').fill('已有历史作品，核对实际执行时间');await shot('history-form');
    const recording=page.waitForResponse(r=>r.url().endsWith('/execution-history'));await drawer.getByRole('button',{name:'保存历史执行并更新报表'}).click();const recorded=await recording;assert.equal(recorded.status(),200,await recorded.text());await drawer.waitFor({state:'hidden'});
    const history=page.locator('.execution-followup .historical-works');await history.getByRole('button',{name:'核验作品',exact:true}).waitFor();await shot('history-saved');
    await history.getByRole('button',{name:'核验作品',exact:true}).click();const evidence=page.getByRole('dialog',{name:'历史执行复核',exact:true});await evidence.getByRole('button',{name:'核验通过',exact:true}).waitFor();await shot('history-review');
    const reviewing=page.waitForResponse(r=>r.url().includes('/evidence/')&&r.url().endsWith('/review'));await evidence.getByRole('button',{name:'核验通过',exact:true}).click();assert.equal((await reviewing).status(),200);await evidence.waitFor({state:'hidden'});await page.getByText('作品处理结果已保存，金额和待办已自动更新。',{exact:true}).waitFor();await page.locator('.bill-details tbody tr').filter({hasText:'历史执行复核'}).getByText('待财务确认',{exact:true}).waitFor();await shot('history-ready');
    await page.getByRole('button',{name:'收起执行进度',exact:true}).click();
    await page.locator('input[name="reportType"][value="activation"]').check();
    await page.locator('input[type="file"]').setInputFiles({name:'代理反馈验收.csv',mimeType:'text/csv',buffer:Buffer.from(`日期,渠道,关键词,拉活量,代理名称\n${day},${channel},代理名称复核,3,反馈测试代理`)});await page.getByRole('button',{name:'上传并自动分析',exact:true}).click();
    await page.locator('.bill-details tbody tr').filter({hasText:'代理名称复核'}).getByRole('button',{name:'核对代理名称',exact:true}).waitFor();
    await page.getByText('报表问题与更正',{exact:true}).click();const agency=page.locator('.issues tbody tr').filter({hasText:'代理名称复核'});await agency.getByRole('button',{name:'核对代理名称',exact:true}).waitFor();assert.equal(await agency.getByRole('button',{name:'指定执行人',exact:true}).count(),0);await shot('agency-correct-action');
   }else if(role==='operations'){
    await page.goto(base+'/app/modules/zhihu/operations?tab=issues');const row=page.locator('.issues tbody tr').filter({hasText:'代理名称复核'});await row.getByRole('button',{name:'核对代理名称',exact:true}).waitFor();assert.equal(await row.getByRole('button',{name:'指定执行人',exact:true}).count(),0);assert(!(await page.locator('.issues').innerText()).includes('¥'));await shot('inbox');
   }else if(role==='finance'){
    await page.goto(base+'/app/modules/zhihu/finance');await page.getByText(/结果更新于/).waitFor();await page.getByRole('button',{name:'刷新结果',exact:true}).click();await page.getByText('已刷新金额与待办，请查看最新处理结果。',{exact:true}).waitFor();await shot('refreshed');
   }else{
    await page.goto(base+'/app/modules/zhihu/wallet');await page.getByRole('heading',{name:role==='leader'?'团队业绩与分成':'我的收入明细',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'保存历史执行并更新报表'}).count(),0);await shot('wallet');
   }
   assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:path.join(out,'feedback-failed-'+role+'.png'),fullPage:true});require('node:fs').writeFileSync(path.join(out,'feedback-failed-'+role+'.txt'),await page.locator('body').innerText());throw error;}finally{await context.close();}
 }
 require('node:fs').writeFileSync(path.join(out,'feedback-result.json'),JSON.stringify({date,roles:['admin','operations','finance','leader','creator','independent'],widths:[1440,375],status:'passed'},null,2));
};
