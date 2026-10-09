const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
module.exports=async function rolePricesFlow({browser,port,out,date}){
 const base=`http://127.0.0.1:${port}`,results=[];
 for(const [role,username,password] of [['admin','admin','Admin123456!'],['operations','review_ops','Review123456'],['finance','review_finance','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456']]){
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(30000);
  page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(new URL(req.url()).pathname.endsWith('/price-agreements'))errors.push('页面仍在读取成员报价')});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const shot=async label=>{for(const width of [1440,375]){await page.setViewportSize({width,height:1100});if(await page.locator('.studio-app').getAttribute('data-menu-open')==='true')await page.locator('.menu-toggle').click();await page.screenshot({path:path.join(out,`role-prices-${role}-${label}-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${role} ${label} ${width} 页面溢出`);}};
  try{
   await page.goto(base+'/app/login');await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[type="password"]').fill(password);
   const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type="submit"]').click();const login=await logging;assert.equal(login.status(),200);await page.waitForURL(url=>!url.pathname.endsWith('/login'));
   const headers={Authorization:'Bearer '+(await login.json()).data.token,'X-Client-Id':login.request().headers()['x-client-id']};
   const retired=await context.request.get(base+'/api/v1/modules/zhihu/price-agreements?projectId=1&accountId=1',{headers});assert.equal(retired.status(),role==='operations'?403:410);
   await page.goto(base+'/app/modules/zhihu/operations?tab=prices');if(role==='finance')await page.getByText('上传知乎报表，自动计算每个人的金额',{exact:true}).waitFor();else await page.getByRole('heading',{name:'成员报价已合并到计费规则',exact:true}).waitFor();
   assert.equal(await page.locator('.work-tabs').getByRole('button',{name:'定价规则',exact:true}).count(),0);await shot('old-entry');
   if(['admin','finance'].includes(role)){
    await page.getByRole('button',{name:'查看与设置单价',exact:true}).click();const drawer=page.getByRole('dialog',{name:'单价设置',exact:true});await drawer.getByRole('heading',{name:'新增未来单价'}).waitFor();assert.equal(await drawer.getByLabel('业绩类型').inputValue(),'new_user');await shot('role-rules');await page.keyboard.press('Escape');
    await page.goto(base+'/app/finance');await page.getByText('拉新：可计费 37 单 ¥313.00',{exact:true}).waitFor();await page.getByText('按角色单价',{exact:true}).first().waitFor({state:'attached'});await shot('finance');
   }else if(role==='operations'){
    assert.equal(await page.getByRole('button',{name:'查看与设置单价',exact:true}).count(),0);await page.getByRole('link',{name:'查看任务',exact:true}).click();await page.waitForURL('**/app/tasks');
   }else{
    assert.equal(await page.getByRole('button',{name:'查看与设置单价',exact:true}).count(),0);await page.getByRole('link',{name:'查看我的收益',exact:true}).click();await page.getByRole('heading',{name:role==='leader'?'团队业绩与分成':'我的收入明细',exact:true}).waitFor();await shot('income');
    const earned=await context.request.get(base+`/api/v1/core/earnings/mine?from=${date}&to=${date}`,{headers});assert.equal(earned.status(),200);const data=(await earned.json()).data;
    if(role==='leader')assert(data.list.filter(r=>r.earningGroup==='team').every(r=>r.unitPrice==='0.5000'));
    if(role!=='leader'){
     await page.goto(base+'/app/modules/zhihu/operations');await page.getByText('¥8.00 / 单',{exact:true}).first().waitFor();assert(!(await page.locator('.engine').innerText()).includes('¥20.00'));await shot('keywords');
    }
   }
   assert.deepEqual(errors,[]);results.push({role,widths:[1440,375],errors});console.log(role+' 拉新角色单价通过');
  }catch(error){await page.screenshot({path:path.join(out,'failed-role-prices-'+role+'.png'),fullPage:true});fs.writeFileSync(path.join(out,'failed-role-prices-'+role+'.txt'),await page.locator('body').innerText());throw error;}
  finally{await context.close();}
 }
 fs.writeFileSync(path.join(out,'role-prices-result.json'),JSON.stringify(results,null,2));
};
