const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
module.exports=async({browser,port,out,enabled})=>{
 const results=[],mode=enabled?'sample':'disabled';
 for(const [role,user] of [['admin','admin'],['operations','review_ops'],['finance','review_finance'],['leader','leader_wang'],['creator','creator_li'],['independent','creator_chen']]){
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  try{
   await page.goto(`http://127.0.0.1:${port}/app/login`);await page.locator('input[autocomplete="username"]').fill(user);await page.locator('input[type="password"]').fill('Review123456');const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type="submit"]').click();const login=await logging;assert.equal(login.status(),200,await login.text());await page.waitForURL(u=>!u.pathname.endsWith('/login'));
   const headers={Authorization:'Bearer '+(await login.json()).data.token,'X-Client-Id':login.request().headers()['x-client-id']};
   const routes=role==='finance'?['dashboard']:['dashboard',...(role==='creator'||role==='leader'||role==='independent'?['task-hall','tasks']:['tasks'])];
   for(const route of routes){
    await page.goto(`http://127.0.0.1:${port}/app/${route}`);await page.locator(route==='dashboard'?'.home-page[aria-busy="false"]':'.platform-tasks[aria-busy="false"]').waitFor();
    const response=await context.request.get(`http://127.0.0.1:${port}/api/v1/core/${route==='dashboard'?'dashboard':'tasks'}`,{headers});assert.equal(response.status(),200);const data=(await response.json()).data;
    if(!enabled){assert.equal(data.projects.length,0);assert.equal(data.groups.length,0);}else{assert.equal(data.projects.length,role==='independent'?1:2);assert(data.projects.every(p=>p.name.startsWith('示例')));}
    assert(!(await page.locator('body').innerText()).includes('知乎'));assert.equal(await page.locator('.home-error').count(),0);
    for(const width of [1440,375]){await page.setViewportSize({width,height:1050});if(await page.locator('.studio-app').getAttribute('data-menu-open')==='true')await page.locator('.menu-toggle').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`${mode}-${role}-${route}-${width}.png`),fullPage:true,animations:'disabled'});}
    if(enabled&&role==='creator'&&route==='task-hall'){
     await page.getByRole('button',{name:'示例甲可领取任务',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'领取任务',exact:true}).click();await dialog.getByRole('button',{name:'确认领取任务',exact:true}).click();await page.getByText('任务已领取',{exact:true}).waitFor();await dialog.waitFor({state:'hidden'});
    }
    results.push({role,route,widths:[1440,375]});
   }
   assert.deepEqual(errors,[]);console.log(mode+' '+role+' verified');
  }catch(e){await page.screenshot({path:path.join(out,'failed-'+mode+'.png'),fullPage:true});fs.writeFileSync(path.join(out,'failed-'+mode+'.txt'),await page.locator('body').innerText());throw e;}finally{await context.close();}
 }
 fs.writeFileSync(path.join(out,mode+'-results.json'),JSON.stringify({mode,results},null,2));
};
