const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function issuesPagination({browser,port,out}){
 const base=`http://127.0.0.1:${port}`,results=[];
 for(const [role,username,password] of [['admin','admin','Admin123456!'],['operations','review_ops','Review123456'],['finance','review_finance','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456']]){
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const shot=async label=>{for(const width of [1440,375]){await page.setViewportSize({width,height:1100});if(await page.locator('.studio-app').getAttribute('data-menu-open')==='true')await page.locator('.menu-toggle').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`issues-${role}-${label}-${width}.png`),fullPage:true,animations:'disabled'});}};
  try{
   await page.goto(base+'/app/login');await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[type="password"]').fill(password);const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type="submit"]').click();const login=await logging;assert.equal(login.status(),200);await page.waitForURL(u=>!u.pathname.endsWith('/login'));
   const headers={Authorization:'Bearer '+(await login.json()).data.token,'X-Client-Id':login.request().headers()['x-client-id']};
   const response=await context.request.get(base+'/api/v1/modules/zhihu/exceptions?projectId=1&accountId=1&status=open&page=1&pageSize=25',{headers});
   if(['admin','operations','finance'].includes(role)){
    assert.equal(response.status(),200);const expected=(await response.json()).data;assert(expected.total>0);assert(expected.counts.done>=30);
    await page.goto(base+(role==='finance'?'/app/finance':'/app/data-issues'));
    if(role==='finance')await page.getByText('报表问题与更正',{exact:true}).click();
    const section=page.locator('.issues');await section.locator('.grid-row').first().waitFor();
    const loaded=()=>page.waitForFunction(()=>document.querySelector('.issues .data-grid')?.getAttribute('aria-busy')==='false');await loaded();
    assert.equal(await section.locator('.grid-row').count(),Math.min(expected.total,25));
    if(role==='operations')assert(!(await section.innerText()).includes('¥'));
    await shot('pending');
    await section.getByRole('button',{name:/^已处理/}).click();await loaded();await section.getByRole('button',{name:'下一页',exact:true}).waitFor();
    assert.equal(await section.locator('.grid-row').count(),25);await section.getByRole('button',{name:'下一页',exact:true}).click();await loaded();await section.getByText(/第 2 页/).waitFor();assert((await section.locator('.grid-row').count())>0);await shot('done-page-two');
    await section.getByRole('button',{name:/^需要跟进/}).click();await loaded();assert.equal(await section.locator('.grid-row').count(),Math.min(expected.total,25));
    const keyword=expected.list[0].normalizedJson?.keyword||expected.list[0].keyword;
    if(keyword){await section.getByLabel('搜索关键词',{exact:true}).fill(keyword);await section.getByRole('button',{name:'查找',exact:true}).click();await loaded();assert((await section.locator('.grid-row').count())>0);await shot('search');}
    await section.getByLabel('搜索关键词',{exact:true}).fill('不存在的隔离测试关键词');await section.getByRole('button',{name:'查找',exact:true}).click();await loaded();await section.getByText('没有找到这个关键词，清空搜索后可查看其他待办。',{exact:true}).waitFor();assert.equal(await section.locator('.grid-row').count(),0);await shot('empty');
    await section.getByRole('button',{name:'清空搜索',exact:true}).click();await loaded();assert.equal(await section.locator('.grid-row').count(),Math.min(expected.total,25));
    if(role==='admin'||role==='operations'){
     await page.setViewportSize({width:1440,height:1100});await section.getByRole('button',{name:'指定执行人',exact:true}).click();const dialog=page.getByRole('dialog',{name:'指定执行人 · 悬疑短篇',exact:true});await dialog.getByLabel('执行人',{exact:true}).selectOption('3');assert.equal(await page.locator('dialog[open]').count(),1);await shot('assign');
     if(role==='admin')await dialog.getByRole('button',{name:'取消',exact:true}).click();
     else{await dialog.getByRole('button',{name:'确定',exact:true}).click();await dialog.waitFor({state:'hidden'});await section.getByText('已指定给 小李，相关报表已自动更新。',{exact:true}).waitFor();await loaded();assert.equal(await section.getByRole('button',{name:'指定执行人',exact:true}).count(),0);await shot('assigned');}
    }else assert.equal(await section.getByRole('button',{name:'指定执行人',exact:true}).count(),0);
   }else{assert.equal(response.status(),403);await page.goto(base+'/app/data-issues');await page.getByRole('heading',{level:1}).waitFor();assert.equal(await page.locator('.issues').count(),0);await shot('restricted');}
   assert.deepEqual(errors,[]);results.push({role,widths:[1440,375],errors});console.log(role+' 数据待办分页验收通过');
  }catch(error){await page.screenshot({path:path.join(out,'failed-issues-'+role+'.png'),fullPage:true});fs.writeFileSync(path.join(out,'failed-issues-'+role+'.txt'),await page.locator('body').innerText());throw error;}
  finally{await context.close();}
 }
 fs.writeFileSync(path.join(out,'issues-pagination-result.json'),JSON.stringify(results,null,2));
};
