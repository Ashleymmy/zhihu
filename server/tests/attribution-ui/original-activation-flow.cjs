const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
// The original stays outside the repository. All writes use review-host's disposable database.
module.exports=async function originalActivationFlow({browser,port,out,sample}){
 const file=process.env.OPC_ACTIVATION_SAMPLE;assert(file&&fs.existsSync(file));assert.equal(sample.length,4);
 assert.equal(sample.reduce((n,r)=>n+BigInt(r.activations),0n),5n);
 const dates=sample.map(r=>r.date).sort(),from=dates[0],to=dates.at(-1),base=`http://127.0.0.1:${port}`,sessions={},results=[];
 const evidence=path.join(out,'original-activation');fs.mkdirSync(evidence,{recursive:true});
 const digest=buffer=>createHash('sha256').update(buffer).digest('hex'),sourceHash=digest(fs.readFileSync(file));
 let batch,current;
 async function shot(role,label){const page=sessions[role].page;for(const width of [1440,375]){await page.setViewportSize({width,height:1100});if(await page.locator('.studio-app').getAttribute('data-menu-open')==='true')await page.locator('.menu-toggle').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),role+' '+label+' 页面溢出');await page.screenshot({path:path.join(evidence,`${role}-${label}-${width}.png`),fullPage:true,animations:'disabled'});}}
 async function api(role,endpoint){const s=sessions[role],r=await s.context.request.get(base+'/api/v1/'+endpoint,{headers:s.headers});return {response:r,body:await r.json()};}
 const importPath=()=>`modules/zhihu/imports/${batch}/analysis?projectId=1&accountId=1`;
 async function upload(page){await page.locator('input[type="file"]').setInputFiles(file);await page.getByRole('button',{name:'上传并自动分析',exact:true}).click();}
 async function income(role){
  const page=sessions[role].page;await page.goto(base+'/app/income');await page.getByRole('heading',{name:role==='leader'?'团队业绩与分成':'我的收入明细',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.platform-income')?.getAttribute('aria-busy')==='false');
  await page.getByLabel('开始日期',{exact:true}).fill(from);await page.getByLabel('结束日期',{exact:true}).fill(to);
  await page.getByRole('button',{name:'查看收益',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.platform-income')?.getAttribute('aria-busy')==='false');
  // Options come from this person's own earnings; an unrelated member has no activation option.
  const metric=page.getByLabel('业绩类型');
  if(await metric.locator('option[value="activation"]').count()){
   await metric.selectOption('activation');await page.getByRole('button',{name:'查看收益',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.platform-income')?.getAttribute('aria-busy')==='false');
  }else assert.equal(role,'independent');
  await shot(role,'income');
 }
 try{
  for(const [role,username,password] of [['admin','admin','Admin123456!'],['creator','creator_li','Review123456'],['leader','leader_wang','Review123456'],['finance','review_finance','Review123456'],['operations','review_ops','Review123456'],['independent','creator_chen','Review123456']]){
   const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];current=page;page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
   await page.goto(base+'/app/login');await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[type="password"]').fill(password);const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type="submit"]').click();const login=await logging;assert.equal(login.status(),200);await page.waitForURL(u=>!u.pathname.endsWith('/login'));sessions[role]={context,page,errors,headers:{Authorization:'Bearer '+(await login.json()).data.token,'X-Client-Id':login.request().headers()['x-client-id']}};
   if(role==='admin'){
    await page.goto(base+'/app/finance');await upload(page);await page.getByText('这份文件有“拉活量”列，看起来是拉活表。',{exact:true}).waitFor();await shot(role,'type-check');
    const switching=page.waitForResponse(r=>r.url().endsWith('/workbench/import')&&r.request().method()==='POST');await page.getByRole('button',{name:'按拉活处理',exact:true}).click();const imported=await switching;assert.equal(imported.status(),202,await imported.text());batch=(await imported.json()).data.id;
    const analysis=page.locator('.analysis-run');await analysis.getByRole('button',{name:'其他或新渠道',exact:true}).first().click();const channel=page.getByRole('dialog',{name:'确认报表中的渠道'});await channel.getByLabel('对应哪个渠道').selectOption('mapping:1');await channel.getByRole('button',{name:'确认并继续',exact:true}).click();await channel.waitFor({state:'hidden'});
    for(const row of sample){
     await page.setViewportSize({width:1440,height:1100});const ask=analysis.getByRole('group').filter({hasText:'关键词「'+row.keyword+'」'});await ask.getByRole('button',{name:/^(登记并指定执行人|其他或登记历史关键词)$/}).click();const dialog=page.getByRole('dialog',{name:'登记历史关键词'});if(await dialog.getByLabel('使用哪条记录').count())await dialog.getByLabel('使用哪条记录').selectOption('new');await dialog.getByLabel('推广活动').selectOption('1');await dialog.getByLabel('执行人').selectOption('3');await dialog.getByLabel('从哪天开始',{exact:true}).fill(row.date);await dialog.getByRole('button',{name:'确认并继续',exact:true}).click();await dialog.waitFor({state:'hidden'});
    }
    await page.locator('.agency-check').getByRole('button',{name:'核对代理名称',exact:true}).click();const agency=page.getByRole('dialog',{name:'拉活代理名称'});await agency.getByLabel('本项目的代理名称').fill(sample[0].agency);await agency.getByRole('button',{name:'保存并核对',exact:true}).click();await agency.waitFor({state:'hidden'});await page.locator('.agency-check').waitFor({state:'hidden'});
    const parsed=await api(role,importPath());assert.equal(parsed.response.status(),200);assert.equal(parsed.body.data.progress.total,4);assert.deepEqual(parsed.body.data.totals,{billableQuantity:'5',billableAmount:'8.0000',confirmableAmount:'0.0000',pendingQuantity:'0',excludedQuantity:'0'});await shot(role,'parsed-pending-work');
    const original=await context.request.get(base+`/api/v1/modules/zhihu/imports/${batch}/file?projectId=1&accountId=1`,{headers:sessions[role].headers});assert.equal(original.status(),200);assert.equal(digest(await original.body()),sourceHash);
   }else if(role==='creator'||role==='leader'){
    assert.equal((await api(role,importPath())).response.status(),403);await page.goto(base+'/app/works');await page.locator('.historical-works').waitFor();
    for(const row of sample){
     await page.setViewportSize({width:1440,height:1100});const line=page.locator('.historical-works .grid-row').filter({hasText:row.keyword});await line.getByRole('button',{name:role==='creator'?'补登记作品':'核验作品',exact:true}).click();const dialog=page.getByRole('dialog',{name:row.keyword,exact:true});
     if(role==='creator'){await dialog.getByLabel('作品链接').fill('https://example.com/original-activation/'+sample.indexOf(row));await dialog.getByLabel('作品名称').fill('隔离验收作品');await dialog.getByRole('button',{name:'保存作品',exact:true}).click();await dialog.getByText('下一步：团长或运营核验作品，通过后自动更新金额。',{exact:true}).waitFor();await page.keyboard.press('Escape');}
     else{await dialog.getByRole('button',{name:'核验通过',exact:true}).click();await dialog.waitFor({state:'hidden'});}
    }
    await income(role);
   }else if(role==='finance'){
    await page.goto(base+'/app/finance');await page.getByRole('radio',{name:/^拉活/}).check();const duplicate=page.waitForResponse(r=>r.url().endsWith('/workbench/import')&&r.request().method()==='POST');await upload(page);const response=await duplicate;assert.equal(response.status(),202);assert.equal((await response.json()).data.id,batch);await page.getByText('拉活：可计费 5 个 ¥8.00',{exact:true}).waitFor();const parsed=await api(role,importPath());assert.equal(parsed.body.data.totals.confirmableAmount,'8.0000');
    await page.getByRole('button',{name:'核对并确认账单',exact:true}).click();await page.getByRole('checkbox',{name:'我已核对报表、人员和计算金额',exact:true}).check();await page.getByRole('button',{name:'确认核对结果',exact:true}).click();await page.getByText(/确认 4 条账单/).waitFor();await page.getByRole('button',{name:'登记到账并开放提现',exact:true}).click();await page.getByLabel('到账流水或核对说明').fill('原始报表隔离验收，无真实付款');await page.getByRole('button',{name:'确认款项可用',exact:true}).click();await page.getByText('已登记款项可用，相关人员可以申请提现。',{exact:true}).waitFor();await shot(role,'confirmed');
   }else if(role==='operations'){
    const parsed=await api(role,importPath());assert.equal(parsed.response.status(),200);assert.equal(parsed.body.data.progress.total,4);assert(!Object.hasOwn(parsed.body.data,'totals'));assert.equal((await api(role,`modules/zhihu/workbench?projectId=1&accountId=1&from=${from}&to=${to}`)).response.status(),403);await page.goto(base+'/app/data-issues');await page.getByRole('heading',{level:1}).waitFor();await shot(role,'restricted');
   }else{assert.equal((await api(role,importPath())).response.status(),403);await income(role);}
   assert.deepEqual(errors,[]);results.push({role,widths:[1440,375]});console.log(role+' 原始拉活表验收通过');
  }
  for(const [role,amount] of [['creator','6.0000'],['leader','2.0000'],['independent','0.0000']]){
   const rows=await api(role,`core/earnings/mine?from=${from}&to=${to}&metricType=activation`);assert.equal(rows.response.status(),200);assert.equal(rows.body.data.list.length,role==='independent'?0:4);assert(rows.body.data.list.every(r=>r.confirmedAt));
   const cash=await api(role,'core/finance?projectId=1&accountId=1&moduleId=zhihu');assert.equal(cash.response.status(),200);assert.equal(cash.body.data.balance.available,amount);await income(role);
  }
  assert.equal(digest(fs.readFileSync(file)),sourceHash);for(const session of Object.values(sessions))assert.deepEqual(session.errors,[]);
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({sourceUnchanged:true,rows:4,activationQuantity:'5',upstreamSettlement:'10.0000',memberPayable:'8.0000',creatorAvailable:'6.0000',leaderAvailable:'2.0000',results},null,2));
 }catch(error){if(current&&!current.isClosed()){await current.screenshot({path:path.join(evidence,'failed.png'),fullPage:true});fs.writeFileSync(path.join(evidence,'failed.txt'),await current.locator('body').innerText());}throw error;}
 finally{for(const session of Object.values(sessions))await session.context.close();}
};
