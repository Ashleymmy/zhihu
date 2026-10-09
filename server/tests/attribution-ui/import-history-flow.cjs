const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
module.exports=async function importHistoryFlow({browser,port,out,date}){
 const base=`http://127.0.0.1:${port}`,results=[];
 for(const [role,username,password] of [['admin','admin','Admin123456!'],['finance','review_finance','Review123456'],['operations','review_ops','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456']]){
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const shot=async label=>{for(const width of [1440,375]){await page.setViewportSize({width,height:1100});if(await page.locator('.studio-app').getAttribute('data-menu-open')==='true')await page.locator('.menu-toggle').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'页面不应横向溢出');const dialog=page.locator('dialog[open]');assert((await dialog.count())<=1);if(await dialog.count())await dialog.screenshot({path:path.join(out,`import-history-${role}-${label}-${width}.png`),animations:'disabled'});else await page.screenshot({path:path.join(out,`import-history-${role}-${label}-${width}.png`),fullPage:true,animations:'disabled'});}await page.setViewportSize({width:1440,height:1100});};
  try{
   await page.goto(base+'/app/login');await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[type="password"]').fill(password);const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type="submit"]').click();const login=await logging;assert.equal(login.status(),200);await page.waitForURL(url=>!url.pathname.endsWith('/login'));
   if(role==='admin'||role==='finance'){
    await page.goto(base+'/app/modules/zhihu/finance');await page.getByText(/结果更新于/).waitFor();await page.locator('input[name="reportType"][value="new_user"]').check();
    const name=`记录操作-${role}.csv`,file={name,mimeType:'text/csv',buffer:Buffer.from(`日期,渠道,关键词,订单量\n${date},知乎故事一代渠道,重生千金,${role==='admin'?23:25}`)};
    const upload=async value=>{await page.locator('input[type="file"]').setInputFiles(value);const response=page.waitForResponse(r=>r.url().endsWith('/workbench/import'));await page.getByRole('button',{name:'上传并自动分析',exact:true}).click();const r=await response;assert.equal(r.status(),202,await r.text());await page.getByRole('button',{name:'收起分析',exact:true}).waitFor();await page.getByRole('button',{name:'刷新结果',exact:true}).waitFor();return (await r.json()).data;};
    const original=await upload(file),current=page.getByRole('region',{name:'当前报表分析',exact:true});
    await current.getByRole('button',{name:'重新分析',exact:true}).click();await page.getByText(/已重新检查原报表/).waitFor();await shot('reanalyzed');
    await current.getByRole('button',{name:'收起分析',exact:true}).click();await current.waitFor({state:'hidden'});
    const history=page.locator('.import-history');await history.locator('summary').click();const row=()=>history.locator('li').filter({hasText:name}).first();await row().getByRole('button',{name:'查看分析',exact:true}).click();await current.waitFor();
    await current.getByRole('button',{name:'清除记录',exact:true}).click();const dialog=page.getByRole('dialog',{name:'清除这条分析记录',exact:true});await dialog.waitFor();await shot('clear-dialog');await dialog.getByRole('button',{name:'清除记录并保留账单'}).click();await dialog.waitFor({state:'hidden'});await page.getByText(/已清理这条分析记录/).waitFor();assert.equal(await row().count(),0);assert.equal(await current.count(),0);
    await history.getByRole('button',{name:'已清理',exact:true}).click();await row().getByRole('button',{name:'恢复记录',exact:true}).waitFor();await shot('archived');
    // Archived state persists across reload; the original report can still be inspected.
    await page.reload();await page.getByText(/结果更新于/).waitFor();await history.locator('summary').click();await history.getByRole('button',{name:'已清理',exact:true}).click();await row().getByRole('button',{name:'查看分析',exact:true}).click();await current.getByRole('button',{name:'恢复记录',exact:true}).click();await page.getByText('已恢复上传记录，可查看或重新分析。',{exact:true}).waitFor();
    const chooser=page.waitForEvent('filechooser');await current.getByRole('button',{name:'重新上传',exact:true}).click();await (await chooser).setFiles(file);await page.getByText(/正在重新上传：/).waitFor();
    const duplicateResponse=page.waitForResponse(r=>r.url().endsWith('/workbench/import'));await page.getByRole('button',{name:'上传并自动分析',exact:true}).click();const duplicate=await duplicateResponse;assert.equal(duplicate.status(),202);assert.equal((await duplicate.json()).data.id,original.id);await page.getByText(/这份报表已上传过，已重新检查，不会重复计账/).waitFor();await shot('duplicate');
    if(role==='admin'){
     const picker=page.waitForEvent('filechooser');await current.getByRole('button',{name:'重新上传',exact:true}).click();await (await picker).setFiles({...file,name:'修正后的记录.csv',buffer:Buffer.from(`日期,渠道,关键词,订单量\n${date},知乎故事一代渠道,重生千金,29`)});await page.getByRole('button',{name:'上传并自动分析',exact:true}).click();await page.locator('.analysis-run').getByRole('button',{name:'采用这份报表',exact:true}).waitFor();await shot('corrected-file');
    }
   }else if(role==='operations'){
    await page.goto(base+'/app/modules/zhihu/operations?tab=issues');await page.locator('.issues').waitFor();assert.equal(await page.getByRole('button',{name:'清除记录',exact:true}).count(),0);await shot('inbox');
   }else{
    await page.goto(base+'/app/income');await page.getByRole('heading',{name:role==='leader'?'团队业绩与分成':'我的收入明细',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'清除记录',exact:true}).count(),0);await shot('income');
   }
   assert.deepEqual(errors,[]);results.push({role,widths:[1440,375],status:'passed'});
  }catch(error){await page.screenshot({path:path.join(out,'import-history-failed-'+role+'.png'),fullPage:true});fs.writeFileSync(path.join(out,'import-history-failed-'+role+'.txt'),await page.locator('body').innerText());throw error;}finally{await context.close();}
 }
 fs.writeFileSync(path.join(out,'import-history-result.json'),JSON.stringify(results,null,2));
};
