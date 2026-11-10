const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.OPC_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.resolve(root,'../.opc-work/report-management-ui');
fs.mkdirSync(out,{recursive:true});
async function main(){
 const log=fs.createWriteStream(path.join(out,'host.log'));
 const host=spawn(process.execPath,['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(__dirname,'review-host.ts')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,REMEDIATION_REVIEW:'1',OPC_REVIEW_IMPORT_RECOVERY:'1'}});
 host.stdout.pipe(log);host.stderr.pipe(log);
 let browser,db;const sessions={};
 try{
  const {port,importRecoveryDb}=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Disposable review host timed out')),120000);host.once('message',r=>{clearTimeout(t);resolve(r)});host.once('exit',c=>{clearTimeout(t);reject(Error('Review host exited '+c))})});
  assert.equal(importRecoveryDb.database,'remediation_review_test');assert(['localhost','127.0.0.1'].includes(importRecoveryDb.host));
  db=await require('mysql2/promise').createConnection(importRecoveryDb);
  await db.query("INSERT INTO users(username,password_hash,role,display_name,is_active,must_change_pwd) VALUES('review_developer',?,'developer','开发测试',1,0)",[await require('bcryptjs').hash('Review123456',4)]);
  const base=`http://127.0.0.1:${port}`,scope={projectId:'1',accountId:'1'},today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),month=today.slice(0,7);
  browser=await chromium.launch({headless:true,channel:process.env.OPC_BROWSER_CHANNEL||'msedge'});
  for(const [role,username,password] of [['admin','admin','Admin123456!'],['developer','review_developer','Review123456'],['finance','review_finance','Review123456'],['operations','review_ops','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456']]){
   const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
   await page.goto(base+'/app/login');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'使用原账号登录',exact:true}).click({force:true});await page.locator('input[autocomplete=username]').fill(username);await page.locator('input[type=password]').fill(password);
   const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type=submit]').click({force:true});const response=await logging;assert.equal(response.status(),200);const token=(await response.json()).data.token;await page.waitForURL(u=>!u.pathname.endsWith('/login'));
   sessions[role]={page,context,errors,headers:{Authorization:'Bearer '+token,'X-Client-Id':response.request().headers()['x-client-id']}};
  }
  const endpoint=tail=>base+'/api/v1/modules/zhihu/'+tail;
  const get=async(tail,role='finance')=>{const s=sessions[role],r=await s.context.request.get(endpoint(tail),{headers:s.headers,params:scope});assert.equal(r.status(),200,await r.text());return(await r.json()).data};
  const post=async(tail,data={},role='finance')=>{const s=sessions[role],r=await s.context.request.post(endpoint(tail),{headers:s.headers,data:{...scope,requestKey:crypto.randomUUID(),...data}});assert(r.ok(),await r.text());return(await r.json()).data};
  async function upload(name,word,commit=true){
   const s=sessions.finance,r=await s.context.request.post(endpoint('workbench/import/preview'),{headers:s.headers,multipart:{...scope,reportType:'new_user',requestKey:crypto.randomUUID(),file:{name,mimeType:'text/csv',buffer:Buffer.from(`日期,渠道名称,关键词,订单量\n${today},知乎故事一代渠道,${word},23`)}}});
   assert.equal(r.status(),200,await r.text());const p=(await r.json()).data;
   if(commit){await post('workbench/import/'+p.id+'/commit',{previewHash:p.previewHash});await post('imports/'+p.id+'/process');for(let n=0;n<60;n++){const d=await get('imports/'+p.id);if(!d.counts.some(c=>c.processingStatus==='pending'))return p;await new Promise(r=>setTimeout(r,500))}throw Error('Report processing timed out')}
   return p;
  }
  const pending=await upload('仅预览待删除.csv','预览记录验收',false),wrong=await upload('传错报表待撤销.csv','撤销入口验收'),hidden=await upload('已隐藏的错误报表.csv','隐藏记录验收');
  await post('imports/'+hidden.id+'/archive',{archived:true});
  const ledgerBefore=JSON.stringify((await db.query("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id"))[0]);
  const shot=async(role,label)=>{const p=sessions[role].page;for(const width of [1440,375]){await p.setViewportSize({width,height:1050});if(await p.locator('.studio-app').getAttribute('data-menu-open')==='true')await p.locator('.menu-toggle').click();assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow: '+role+' '+label);const d=p.locator('dialog[open]');if(await d.count()){assert.equal(await d.count(),1);await d.screenshot({path:path.join(out,`${role}-${label}-${width}.png`),animations:'disabled'})}else await p.screenshot({path:path.join(out,`${role}-${label}-${width}.png`),fullPage:true,animations:'disabled'})}await p.setViewportSize({width:1440,height:1050})};
  const open=async role=>{const p=sessions[role].page;await p.goto(base+'/app/finance');await p.getByLabel('项目与来源').selectOption('1:1');await p.getByRole('button',{name:'← 账期列表',exact:true}).click();await p.getByRole('button',{name:'上传记录 / 撤销',exact:true}).click();await p.getByRole('heading',{name:'上传记录',exact:true}).waitFor();await p.waitForFunction(()=>document.querySelector('.import-history-list')?.getAttribute('aria-busy')==='false');return p};
  for(const role of ['admin','developer','finance']){await open(role);await shot(role,'management');console.log(role+' report management checked');}
  const f=sessions.finance.page,row=id=>f.locator(`[data-report-id="${id}"]`);
  await row(pending.id).getByRole('button',{name:'删除上传记录',exact:true}).click();const deleting=f.getByRole('dialog',{name:'删除这份上传记录',exact:true});await deleting.waitFor();await shot('finance','delete-preview');await deleting.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await get('imports/'+pending.id)).status,'preview');
  await row(pending.id).getByRole('button',{name:'删除上传记录',exact:true}).click();await deleting.getByRole('button',{name:'确认删除上传记录',exact:true}).click();await row(pending.id).waitFor({state:'detached'});assert.equal((await get('imports/'+pending.id)).status,'withdrawn');
  await row(wrong.id).getByRole('button',{name:'撤销并移除',exact:true}).click();const modal=f.getByRole('dialog',{name:'撤销这份报表',exact:true});await modal.waitFor();await shot('finance','withdraw-impact');
  let attempts=0;const withdrawalUrl=endpoint('imports/'+wrong.id+'/withdrawal');
  await f.route(withdrawalUrl,async route=>{if(route.request().method()==='POST'&&attempts++===0)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:40900,message:'报表数据已变化，请重新查看撤销影响',data:null})});return route.continue()});
  await modal.getByRole('button',{name:'确认撤销并移除',exact:true}).click();await modal.getByRole('button',{name:'重新核对影响',exact:true}).waitFor();assert.equal(attempts,1);assert.notEqual((await get('imports/'+wrong.id)).status,'withdrawn');
  await modal.getByRole('button',{name:'重新核对影响',exact:true}).click();await modal.getByRole('button',{name:'确认撤销并移除',exact:true}).click();await row(wrong.id).waitFor({state:'detached'});assert.equal((await get('imports/'+wrong.id)).status,'withdrawn');
  await f.getByRole('button',{name:'查看已隐藏记录',exact:true}).click();await row(hidden.id).getByRole('button',{name:'撤销并移除',exact:true}).click();await modal.getByRole('button',{name:'确认撤销并移除',exact:true}).click();await row(hidden.id).waitFor({state:'detached'});assert.equal((await get('imports/'+hidden.id)).status,'withdrawn');
  assert.equal(JSON.stringify((await db.query("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id"))[0]),ledgerBefore);
  const again=await upload('传错报表待撤销.csv','撤销入口验收',false);assert.notEqual(again.id,wrong.id);
  await f.getByRole('button',{name:'返回有效上传记录',exact:true}).click();await row(again.id).getByRole('button',{name:'继续预览',exact:true}).click();await f.getByRole('dialog',{name:'确认报表内容',exact:true}).waitFor();await f.keyboard.press('Escape');
  await f.getByRole('button',{name:'本期报表 / 撤销',exact:true}).click();await f.locator('input[type=month]').waitFor();assert.equal(await f.locator('input[type=month]').inputValue(),month);
  await f.locator('input[type=month]').fill('2020-01');await f.locator('input[type=month]').dispatchEvent('change');await f.getByRole('button',{name:'查看全部月份',exact:true}).waitFor();await shot('finance','empty-period');
  await f.getByRole('button',{name:'查看全部月份',exact:true}).click();await row(again.id).waitFor();
  await f.route('**/imports?*',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({code:50000,message:'隔离测试读取失败',data:null})}),{times:1});await f.getByRole('button',{name:'刷新记录',exact:true}).click();await f.getByRole('alert').getByText('隔离测试读取失败',{exact:false}).waitFor();assert.equal(await f.locator('.import-history .empty').count(),0);await f.getByRole('button',{name:'重新加载',exact:true}).click();await row(again.id).waitFor();
  for(const role of ['operations','leader','creator','independent']){
   const s=sessions[role];await s.page.goto(base+'/app/finance');await s.page.waitForLoadState('networkidle');assert.equal(await s.page.getByRole('button',{name:'上传记录 / 撤销',exact:true}).count(),0);
   const response=await s.context.request.post(endpoint('imports/'+again.id+'/withdrawal'),{headers:s.headers,data:{...scope,requestKey:crypto.randomUUID(),reviewHash:'a'.repeat(64)}});assert.equal(response.status(),403);
  }
  for(const s of Object.values(sessions))assert.deepEqual(s.errors,[]);
  const result={passed:true,roles:Object.keys(sessions),widths:[1440,375],previewDelete:true,withdraw:true,hiddenWithdraw:true,reupload:true,staleReview:true,periodFilter:true,errorsNotEmpty:true,confirmedLedgerUnchanged:true};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){for(const [role,s] of Object.entries(sessions)){await s.page.screenshot({path:path.join(out,'failed-'+role+'.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,'failed-'+role+'.txt'),await s.page.locator('body').innerText().catch(()=>''))}throw e}
 finally{await db?.end();await browser?.close();if(host.connected)host.send('stop');await new Promise(resolve=>{if(host.exitCode!==null)return resolve();const t=setTimeout(()=>{host.kill();resolve()},30000);host.once('exit',()=>{clearTimeout(t);resolve()})});log.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
