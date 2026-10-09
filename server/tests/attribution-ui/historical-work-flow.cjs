const path=require('node:path');
const fs=require('node:fs');
const assert=require('node:assert/strict');
module.exports=async function historicalWorkFlow({browser,port,out}){
 const accounts={creator:['creator_li','Review123456'],leader:['leader_wang','Review123456'],operations:['review_ops','Review123456'],finance:['review_finance','Review123456'],independent:['creator_chen','Review123456'],admin:['admin','Admin123456!']};
 for(const [role,action] of [['creator','submit'],['finance','pending'],['operations','reject'],['creator','resubmit'],['leader','accept'],['admin','dispute'],['operations','resolve'],['independent','isolated'],['admin','ready']]){
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const shot=async label=>{for(const width of [1440,375]){await page.setViewportSize({width,height:1100});
   if(await page.locator('.studio-app').getAttribute('data-menu-open')==='true')await page.locator('.menu-toggle').click();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),role+' horizontal overflow');
   const dialog=page.locator('dialog[open]');await (await dialog.count()?dialog:page.locator('.historical-works')).screenshot({path:path.join(out,`historical-work-${role}-${label}-${width}.png`),animations:'disabled',style:'.studio-header {visibility:hidden}'});
  }};
  try{
   await page.goto(`http://127.0.0.1:${port}/app/login`);await page.locator('input[autocomplete="username"]').fill(accounts[role][0]);await page.locator('input[type="password"]').fill(accounts[role][1]);
   const logging=page.waitForResponse(response=>response.url().endsWith('/core/auth/login'));await page.locator('button[type="submit"]').click();const login=await logging;assert.equal(login.status(),200);
   const headers={Authorization:'Bearer '+(await login.json()).data.token,'X-Client-Id':login.request().headers()['x-client-id']};await page.waitForURL(url=>!url.pathname.endsWith('/login'));
   const api=async endpoint=>{const response=await context.request.get(`http://127.0.0.1:${port}/api/v1/modules/zhihu/${endpoint}`,{headers});return{response,body:await response.json()}};
   if(action==='dispute'){
    const evidence=await api('evidence?projectId=1&accountId=1&pageSize=100'),work=evidence.body.data.list.find(item=>item.keyword==='外部历史词');assert(work);
    const marked=await context.request.post(`http://127.0.0.1:${port}/api/v1/modules/zhihu/evidence-bindings/${work.bindingId}/dispute`,{headers,data:{projectId:'1',accountId:'1',resolve:false,reason:'隔离验证首页争议待办',requestKey:require('node:crypto').randomUUID()}});assert.equal(marked.status(),200,await marked.text());
    await page.goto(`http://127.0.0.1:${port}/app/`);await page.getByRole('link',{name:/核实作品归属/}).click();await page.waitForURL(url=>url.pathname.endsWith('/works'));await page.locator('.historical-works').getByRole('button',{name:'核实作品争议',exact:true}).first().waitFor();await shot('disputed-list');
   }else if(['finance','admin'].includes(role)){
    const imports=await api('imports?projectId=1&accountId=1&pageSize=100'),batch=imports.body.data.list.find(item=>item.fileName==='新渠道验收.csv');assert(batch);
    const analysis=await api(`imports/${batch.id}/analysis?projectId=1&accountId=1`);assert.equal(analysis.response.status(),200);assert.equal(analysis.body.data.totals.billableAmount,'8.5000');assert.equal(analysis.body.data.totals.confirmableAmount,role==='admin'?'8.5000':'0.0000');
    if(role==='finance')assert.equal((await api('evidence/historical-tasks?projectId=1&accountId=1')).response.status(),403);
    await page.goto(`http://127.0.0.1:${port}/app/modules/zhihu/finance`);await page.getByText('上传知乎报表，自动计算每个人的金额',{exact:true}).waitFor();
    for(const width of [1440,375]){await page.setViewportSize({width,height:1100});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`historical-work-${role}-${action}-${width}.png`),fullPage:true});}
   }else{
    if(role!=='independent'){
     await page.getByRole('heading',{name:'现在要做',exact:true}).waitFor();
     await page.getByRole('link',{name:action==='resolve'?/核实作品归属/:role==='creator'?/补登记历史作品/:/核验历史作品/}).click();
     await page.waitForURL(url=>url.pathname.endsWith('/works'));
    }else await page.goto(`http://127.0.0.1:${port}/app/works`);
    await page.getByRole('heading',{name:'作品记录',level:2,exact:true}).waitFor();
    if(role==='independent'){
     const result=await api('evidence/historical-tasks?projectId=1&accountId=1');assert.equal(result.response.status(),200);assert(!result.body.data.list.some(work=>work.keyword==='外部历史词'));assert.equal(await page.locator('.historical-works').count(),0);
     for(const width of [1440,375]){await page.setViewportSize({width,height:1100});await page.screenshot({path:path.join(out,`historical-work-${role}-${action}-${width}.png`),fullPage:true});}
    }else{
     const history=page.locator('.historical-works');await history.getByText('外部历史词',{exact:true}).first().waitFor();await shot(action+'-list');
     await history.getByRole('button',{name:action==='resolve'?'核实作品争议':role==='creator'?'补登记作品':'核验作品',exact:true}).click();
     const dialog=page.getByRole('dialog',{name:'外部历史词'});await dialog.waitFor();
     if(role==='creator'){
      await dialog.getByLabel('作品链接').fill('https://example.com/historical/'+action);await dialog.getByLabel('作品名称').fill('历史作品补登记');await shot(action+'-form');
      const saving=page.waitForResponse(response=>response.url().endsWith('/evidence')&&response.request().method()==='POST');await dialog.getByRole('button',{name:'保存作品',exact:true}).click();assert.equal((await saving).status(),201);await dialog.getByText('下一步：团长或运营核验作品，通过后自动更新金额。',{exact:true}).waitFor();await shot(action+'-saved');
     }else if(action==='resolve'){
      await dialog.getByLabel('核实结果').fill('已核实原作品属于当前执行人');await shot('resolve-form');await dialog.getByRole('button',{name:'解除争议',exact:true}).click();await dialog.waitFor({state:'hidden'});
      await page.goto(`http://127.0.0.1:${port}/app/`);await page.getByRole('heading',{name:'现在要做',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:/核实作品归属/}).count(),0);
     }else if(role==='operations'){
      await dialog.getByRole('button',{name:'退回补充',exact:true}).click();await dialog.getByLabel('哪里需要补充').fill('请补充原始发布链接');await shot('reject-form');
      const reviewing=page.waitForResponse(response=>response.url().endsWith('/review'));await dialog.getByRole('button',{name:'退回补充',exact:true}).click();assert.equal((await reviewing).status(),200);await dialog.getByLabel('作品链接').waitFor();
     }else{
      await shot('accept-form');const reviewing=page.waitForResponse(response=>response.url().endsWith('/review'));await dialog.getByRole('button',{name:'核验通过',exact:true}).click();assert.equal((await reviewing).status(),200);await dialog.waitFor({state:'hidden'});
     }
    }
   }
   assert.deepEqual(errors,[]);console.log(role+' 历史作品 '+action+' 验收通过');
  }catch(error){await page.screenshot({path:path.join(out,`failed-work-${role}-${action}.png`),fullPage:true});fs.writeFileSync(path.join(out,`failed-work-${role}-${action}.txt`),await page.locator('body').innerText());throw error;}
  finally{await context.close();}
 }
};
