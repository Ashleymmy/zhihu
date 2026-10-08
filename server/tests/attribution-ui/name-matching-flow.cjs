const path=require('node:path');
const fs=require('node:fs');
const assert=require('node:assert/strict');
module.exports=async function nameMatchingFlow({browser,port,out,date}){
 const report={name:'名称确认验收.csv',mimeType:'text/csv',buffer:Buffer.from(`日期,渠道名称,关键词,订单量\n${date},知乎故事一代渠到,重生干金,21`)};
 for(const [role,username,password] of [['admin','admin','Admin123456!'],['finance','review_finance','Review123456'],['operations','review_ops','Review123456']]){
  await new Promise(resolve=>setTimeout(resolve,20000));
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const shot=async label=>{for(const width of [1440,375]){
   await page.setViewportSize({width,height:1100});
   if(await page.locator('.studio-app').getAttribute('data-menu-open')==='true')await page.locator('.menu-toggle').click();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' horizontal overflow');
   const dialog=page.getByRole('dialog',{name:'确认报表中的渠道'});
   await (await dialog.isVisible()?dialog:page.locator('.analysis-run')).screenshot({path:path.join(out,`names-${role}-${label}-${width}.png`),animations:'disabled',style:'.studio-header {visibility:hidden}'});
  }};
  try{
   await page.goto(`http://127.0.0.1:${port}/app/login`);await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[type="password"]').fill(password);
   await page.locator('button[type="submit"]').click();await page.waitForURL(url=>!url.pathname.endsWith('/login'));
   if(role!=='operations'){
    await page.goto(`http://127.0.0.1:${port}/app/modules/zhihu/finance`);
    await page.locator('input[type="file"]').setInputFiles(report);await page.getByRole('button',{name:'上传并自动分析',exact:true}).click();
    const ask=page.locator('.analysis-run').getByRole('group',{name:/渠道「知乎故事一代渠到」/});await ask.waitFor();
    if(role==='finance')assert(await ask.getByRole('button',{name:'是「知乎故事一代渠道」',exact:true}).isDisabled());
    else assert(await ask.getByRole('button',{name:'是「知乎故事一代渠道」',exact:true}).isEnabled());
    await shot('question');
    if(role==='admin'){
     await page.locator('input[type="file"]').setInputFiles({name:'新渠道验收.csv',mimeType:'text/csv',buffer:Buffer.from(`日期,渠道名称,关键词,订单量\n${date},补登渠道九号,外部历史词,1`)});
     await page.getByRole('button',{name:'上传并自动分析',exact:true}).click();
     await page.locator('.analysis-run').getByRole('group',{name:/渠道「补登渠道九号」/}).waitFor();
    }
   }else{
    await page.goto(`http://127.0.0.1:${port}/app/modules/zhihu/operations?tab=issues`);
    await page.locator('.issues tbody tr').filter({hasText:'重生干金'}).getByRole('button',{name:'确认渠道',exact:true}).click();
    let analysis=page.locator('.analysis-run');await analysis.getByRole('group',{name:/渠道「知乎故事一代渠到」/}).waitFor();
    assert(!(await analysis.innerText()).includes('¥'));await shot('channel');
    await analysis.getByRole('button',{name:'是「知乎故事一代渠道」',exact:true}).click();
    await analysis.getByRole('group',{name:/关键词「重生干金」/}).waitFor();await shot('keyword');
    await analysis.getByRole('button',{name:'是「重生千金」',exact:true}).click();
    await analysis.getByRole('heading',{name:'确认关键词',exact:true}).locator('..').getByText('已完成',{exact:true}).waitFor();
    assert(!(await analysis.innerText()).includes('¥'));assert.equal(await analysis.locator('.ask-box').count(),0);await shot('done');
    await page.setViewportSize({width:1440,height:1100});await page.locator('.issues tbody tr').filter({hasText:'外部历史词'}).getByRole('button',{name:'确认渠道',exact:true}).click();
    await analysis.getByRole('button',{name:'其他或新渠道',exact:true}).click();
    const drawer=page.getByRole('dialog',{name:'确认报表中的渠道'});await drawer.waitFor();
    await drawer.getByLabel('对应哪个渠道').selectOption('new');await drawer.getByLabel('知乎渠道号').fill('review-names-local');await shot('new-channel');
    await drawer.getByRole('button',{name:'确认并继续',exact:true}).click();await drawer.waitFor({state:'hidden'});
    await analysis.getByRole('heading',{name:'确认渠道',exact:true}).locator('..').getByText('已完成',{exact:true}).waitFor();
    await analysis.getByRole('group',{name:/关键词「外部历史词」/}).waitFor();assert(!(await analysis.innerText()).includes('¥'));await shot('new-channel-saved');
   }
   assert.deepEqual(errors,[]);console.log(role+' 名称确认页面验收通过');
  }catch(error){await page.screenshot({path:path.join(out,'failed-names-'+role+'.png'),fullPage:true});fs.writeFileSync(path.join(out,'failed-names-'+role+'.txt'),await page.locator('body').innerText());throw error;}
  finally{await context.close();}
 }
};
