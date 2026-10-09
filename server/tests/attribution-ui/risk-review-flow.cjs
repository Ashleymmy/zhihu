const path=require('node:path');
const fs=require('node:fs');
const assert=require('node:assert/strict');
module.exports=async function riskReviewFlow({browser,port,out,date}){
 const base=`http://127.0.0.1:${port}`,sessions={},errors=[];
 const accounts={admin:['admin','Admin123456!'],finance:['review_finance','Review123456'],leader:['leader_wang','Review123456'],creator:['creator_li','Review123456'],independent:['creator_chen','Review123456'],operations:['review_ops','Review123456']};
 let current;
 const shot=async(role,label)=>{const {page}=sessions[role];current=page;for(const width of [1440,375]){
  await page.setViewportSize({width,height:1100});
  if(await page.locator('.studio-app').getAttribute('data-menu-open')==='true')await page.locator('.menu-toggle').click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${role} ${label} ${width} overflow`);
  const dialog=page.locator('dialog[open]');
  if(await dialog.count())await dialog.screenshot({path:path.join(out,`risk-${role}-${label}-${width}.png`),animations:'disabled',style:'.studio-header{visibility:hidden}'});
  else await page.screenshot({path:path.join(out,`risk-${role}-${label}-${width}.png`),fullPage:true,animations:'disabled'});
 }};
 const open=async(role,route)=>{const {page}=sessions[role];current=page;await page.setViewportSize({width:1440,height:1100});await page.goto(base+'/app/'+route);await (route==='data-issues'?page.getByRole('heading',{level:2,name:'数据待办',exact:true}):page.getByText(role==='leader'?'团队业绩与分成':role==='creator'||role==='independent'?'我的收入明细':'上传知乎报表，自动计算每个人的金额',{exact:true}).first()).waitFor();return page;};
 const overview=async(role)=>{const {context,headers}=sessions[role];const r=await context.request.get(base+`/api/v1/modules/zhihu/workbench?projectId=1&accountId=1&from=${date}&to=${date}&viewVersion=2`,{headers});assert.equal(r.status(),200,await r.text());return(await r.json()).data;};
 const rows=async(role)=>(await overview(role)).entries.filter(row=>row.keyword==='重生千金');
 const upload=async(role,quantity,risk)=>{const page=await open(role,'finance');await page.locator('input[type="file"]').setInputFiles({name:`风险${quantity}验收.csv`,mimeType:'text/csv',buffer:Buffer.from(`日期,渠道名称,关键词,订单量,风险判定\n${date},知乎故事一代渠道,重生千金,${quantity},${risk}`)});await page.getByRole('button',{name:'上传并自动分析',exact:true}).click();const choosing=page.waitForResponse(r=>r.url().endsWith('/answers')&&r.request().method()==='POST');await page.locator('.analysis-run').getByRole('button',{name:'采用这份报表',exact:true}).click();const chosen=await choosing;assert.equal(chosen.status(),200,await chosen.text());await page.locator('.risk-cases').getByText('知乎标记：'+risk,{exact:true}).waitFor();return page;};
 const confirm=async()=>{const page=await open('finance','finance');await page.getByRole('button',{name:'核对并确认账单',exact:true}).click();await page.getByLabel('我已核对报表、人员和计算金额').check();const saving=page.waitForResponse(r=>r.url().endsWith('/workbench/confirm'));await page.getByRole('button',{name:'确认核对结果',exact:true}).click();const response=await saving;assert.equal(response.status(),200,await response.text());assert.equal((await response.json()).data.confirmed,1);await page.getByText(/已核对本期金额，确认 1 条账单/).waitFor();};
 const decide=async(decision,reason)=>{const page=await open('operations','data-issues');await page.getByRole('button',{name:'核实风险',exact:true}).click();const dialog=page.getByRole('dialog',{name:'核实报表风险'});await dialog.getByLabel('核实说明').fill(reason);await shot('operations',decision+'-form');const saving=page.waitForResponse(r=>r.url().endsWith('/risk-review'));await dialog.getByRole('button',{name:decision==='accepted'?'核实没问题':'确实有问题，不计费',exact:true}).click();const response=await saving;assert.equal(response.status(),200,await response.text());await dialog.waitFor({state:'hidden'});await shot('operations',decision+'-saved');assert(!(await page.locator('.issues').innerText()).includes('¥'));};
 try{
  for(const [role,credentials] of Object.entries(accounts)){
   const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();current=page;page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(role+': '+e.message));
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   await page.goto(base+'/app/login');await page.locator('input[autocomplete="username"]').fill(credentials[0]);await page.locator('input[type="password"]').fill(credentials[1]);const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type="submit"]').click();const login=await logging;assert.equal(login.status(),200,await login.text());await page.waitForURL(url=>!url.pathname.endsWith('/login'));
   sessions[role]={context,page,headers:{Authorization:'Bearer '+(await login.json()).data.token,'X-Client-Id':login.request().headers()['x-client-id']}};
   if(role==='admin'){
    await upload(role,20,'待核实推广行为');assert.deepEqual((await rows(role)).map(row=>row.amount).sort(),['10.0000','160.0000']);assert((await rows(role)).every(row=>!row.ready));await shot(role,'pending');
    await page.locator('.risk-cases').getByRole('button',{name:'核实风险',exact:true}).click();await shot(role,'drawer');await page.getByRole('dialog',{name:'核实报表风险'}).getByRole('button',{name:'暂时跳过',exact:true}).click();
   }else if(role==='operations'){
    await decide('accepted','已核对原始记录，本次推广有效');
   }else{
    await open(role,role==='finance'?'finance':'income');const list=await rows(role);
    if(role==='independent')assert.equal(list.length,0);
    else{assert(list.every(row=>row.reasonCode==='RISK_REVIEW_REQUIRED'&&!row.ready));if(role==='leader')assert.deepEqual(list.map(row=>row.amount),['10.0000']);if(role==='creator')assert.deepEqual(list.map(row=>row.amount),['160.0000']);}
    assert.equal(await page.getByRole('button',{name:'核实风险',exact:true}).count(),0);await shot(role,'pending');
   }
   console.log(role+' 风险页面与权限验收通过');
  }
  await confirm();assert((await rows('finance')).every(row=>row.status==='confirmed'));await shot('finance','accepted-confirmed');
  await upload('finance',21,'核实后需要排除的新来源');assert((await rows('finance')).every(row=>row.reasonCode==='RISK_REVIEW_REQUIRED'&&!row.ready));await shot('finance','changed-pending');
  await decide('excluded','核对上游材料后，确认本条属于无效推广');
  const excluded=await rows('finance');assert.deepEqual(excluded.map(row=>row.pendingAmount).sort(),['-10.0000','-160.0000']);assert(excluded.every(row=>row.amount==='0.0000'&&row.ready));await open('finance','finance');await shot('finance','excluded-correction');
  await confirm();assert((await rows('finance')).every(row=>row.amount==='0.0000'&&row.status==='confirmed'));await shot('finance','excluded-confirmed');
  for(const role of ['leader','creator']){await open(role,'income');const list=await rows(role);assert(list.every(row=>row.amount==='0.0000'&&row.status==='confirmed'));const card=sessions[role].page.locator('.income-details .grid-row').filter({hasText:'重生千金'});assert((await card.innerText()).includes('已确认'));assert(!(await card.innerText()).includes('平台核对中'));await shot(role,'excluded-confirmed');}
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'risk-result.json'),JSON.stringify({date,roles:Object.keys(sessions),widths:[1440,375],errors},null,2));
 }catch(error){if(current&&!current.isClosed()){await current.screenshot({path:path.join(out,'failed-risk.png'),fullPage:true});fs.writeFileSync(path.join(out,'failed-risk.txt'),await current.locator('body').innerText());}throw error;}
 finally{for(const session of Object.values(sessions))await session.context.close();}
};
