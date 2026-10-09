const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
module.exports=async({browser,port,out})=>{
 const base=`http://127.0.0.1:${port}`,sessions={},errors=[],results=[];
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
 let current;
 async function shot(role,label){const p=sessions[role].page;for(const width of [1440,375]){await p.setViewportSize({width,height:1050});if(await p.locator('.studio-app').getAttribute('data-menu-open')==='true')await p.locator('.menu-toggle').click();assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const dialog=p.getByRole('dialog');if(await dialog.count())await dialog.screenshot({path:path.join(out,`${role}-${label}-${width}.png`),animations:'disabled'});else await p.screenshot({path:path.join(out,`${role}-${label}-${width}.png`),fullPage:true,animations:'disabled'});}}
 async function setting(role){const p=sessions[role].page;const d=p.getByRole('dialog',{name:'拉活代理名称',exact:true});await d.locator('input').waitFor();await shot(role,'settings');return d;}
 async function save(role,name){const p=sessions[role].page,d=await setting(role);await d.getByLabel('本项目的代理名称').fill(name);const saving=p.waitForResponse(r=>r.url().endsWith('/project-agency')&&r.request().method()==='POST');await d.getByRole('button',{name:'保存并核对'}).click();const r=await saving;assert.equal(r.status(),200,await r.text());await d.waitFor({state:'hidden'});}
 async function bills(role){const s=sessions[role],r=await s.context.request.get(base+`/api/v1/modules/zhihu/workbench?projectId=1&accountId=1&from=${date}&to=${date}&viewVersion=2`,{headers:s.headers});assert.equal(r.status(),200);return(await r.json()).data;}
 async function upload(role,name){const p=sessions[role].page;await p.goto(base+'/app/finance');await p.locator('input[type="radio"][value="activation"]').check();await p.locator('input[type="file"]').setInputFiles({name:'代理核对.csv',mimeType:'text/csv',buffer:Buffer.from(`日期,渠道名称,关键词,拉活量,结算金额,代理名称\n${date},知乎故事一代渠道,重生千金,4,8,${name}`)});await p.getByRole('button',{name:'上传并自动分析',exact:true}).click();await p.locator(name==='广州渡川二'?'.analysis-run .ask-box':'.agency-check').waitFor();}
 try{
  for(const [role,username,password] of [['admin','admin','Admin123456!'],['operations','review_ops','Review123456'],['finance','review_finance','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456']]){
   const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();current=page;page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(role+': '+e.message));await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await page.goto(base+'/app/login');await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[type="password"]').fill(password);const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type="submit"]').click();const login=await logging;assert.equal(login.status(),200);await page.waitForURL(u=>!u.pathname.endsWith('/login'));sessions[role]={context,page,headers:{Authorization:'Bearer '+(await login.json()).data.token,'X-Client-Id':login.request().headers()['x-client-id']}};
   if(role==='admin'){
    await upload(role,'广州渡川');assert.match(await page.locator('.agency-check').innerText(),/尚未填写/);await shot(role,'missing');await page.locator('.agency-check').getByRole('button',{name:'核对代理名称'}).click();await save(role,'其他代理');await page.locator('.agency-check').getByText(/其他代理/).waitFor();await shot(role,'mismatch');
    const entries=(await bills(role)).entries.filter(r=>r.metricType==='activation');assert(entries.every(r=>r.amount===null&&!r.ready));
   }else if(role==='operations'){
    await page.goto(base+'/app/data-issues');await page.locator('.issues').getByRole('button',{name:'核对代理名称',exact:true}).first().click();await save(role,'广州渡川');await page.locator('.issues').getByRole('button',{name:'核对代理名称',exact:true}).first().waitFor({state:'hidden'});assert(!(await page.locator('.issues').innerText()).includes('¥'));await shot(role,'resolved');
    await page.goto(base+'/app/projects');await page.getByRole('button',{name:/知乎/}).first().click();await page.getByRole('button',{name:'拉活代理名称',exact:true}).click();await setting(role);await page.getByRole('dialog',{name:'拉活代理名称'}).getByRole('button',{name:'关闭详情'}).click();
   }else if(role==='finance'){
    const entries=(await bills(role)).entries.filter(r=>r.metricType==='activation');assert.deepEqual(entries.map(r=>r.amount).sort(),['1.6000','4.8000']);assert(entries.every(r=>r.ready));
    await page.goto(base+'/app/finance');await page.getByText('上传知乎报表，自动计算每个人的金额',{exact:true}).waitFor();await shot(role,'resolved');
    // Reopen the previous report, then verify finance can use its inline drawer too.
    await upload(role,'广州渡川二');const button=page.locator('.analysis-run').getByRole('button',{name:'采用这份报表',exact:true});await button.click();await page.locator('.agency-check').waitFor();await page.locator('.agency-check').getByRole('button',{name:'核对代理名称'}).click();await save(role,'广州渡川二');await page.locator('.agency-check').waitFor({state:'hidden'});await shot(role,'saved');
   }else{
    const r=await context.request.get(base+'/api/v1/modules/zhihu/project-agency?projectId=1&accountId=1',{headers:sessions[role].headers});assert.equal(r.status(),403);await page.goto(base+'/app/income');await page.getByRole('heading',{name:role==='leader'?'团队业绩与分成':'我的收入明细',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'核对代理名称',exact:true}).count(),0);await shot(role,'income');
   }
   results.push({role,widths:[1440,375]});console.log(role+' agency verified');
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({date,results,errors},null,2));
 }catch(e){if(current&&!current.isClosed()){await current.screenshot({path:path.join(out,'failed.png'),fullPage:true});fs.writeFileSync(path.join(out,'failed.txt'),await current.locator('body').innerText());}throw e;}finally{for(const s of Object.values(sessions))await s.context.close();}
};
