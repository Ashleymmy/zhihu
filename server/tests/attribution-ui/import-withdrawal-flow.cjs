const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const {chromium}=require(process.env.OPC_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.resolve(root,'../.opc-work/import-withdrawal-ui');fs.mkdirSync(out,{recursive:true});
async function main(){
 const log=fs.createWriteStream(path.join(out,'host.log'));
 const host=spawn(process.execPath,['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(__dirname,'review-host.ts')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,REMEDIATION_REVIEW:'1',OPC_REVIEW_RECONCILIATION:'1',OPC_REVIEW_FINANCE_HISTORY:'1'}});host.stdout.pipe(log);host.stderr.pipe(log);
 let browser;const sessions={};
 try{
  const {port,reconciliation:data}=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('隔离演示启动超时')),120000);host.once('message',value=>{clearTimeout(timer);resolve(value)});host.once('exit',code=>{clearTimeout(timer);reject(Error('演示退出 '+code))})});
  const base=`http://127.0.0.1:${port}`;browser=await chromium.launch({headless:true,channel:process.env.OPC_BROWSER_CHANNEL||'msedge'});
  for(const [role,username,password] of [['finance','review_finance','Review123456'],['admin','admin','Admin123456!'],['operations','review_ops','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456']]){
   const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   await page.goto(base+'/app/login');await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[type="password"]').fill(password);const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type="submit"]').click();const response=await logging;assert.equal(response.status(),200);const result=await response.json();await page.waitForURL(u=>!u.pathname.endsWith('/login'));
   sessions[role]={context,page,errors,headers:{Authorization:'Bearer '+result.data.token,'X-Client-Id':response.request().headers()['x-client-id']}};
  }
  const api=async(role,url)=>{const s=sessions[role],res=await s.context.request.get(base+'/api/v1/'+url,{headers:s.headers});assert.equal(res.status(),200,await res.text());return (await res.json()).data};
  const current=()=>api('finance',`modules/zhihu/workbench?projectId=1&accountId=1&from=${data.from}&to=${data.to}&viewVersion=2`);
  const shot=async(role,label)=>{const {page}=sessions[role];if(['admin','finance'].includes(role)&&!page.url().includes('data-import'))await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='刷新结果'&&!b.disabled));for(const width of [1440,375]){await page.setViewportSize({width,height:1100});if(await page.locator('.studio-app').getAttribute('data-menu-open')==='true')await page.locator('.menu-toggle').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'页面横向溢出');const drawer=page.locator('dialog[open]');if(await drawer.count())await drawer.last().screenshot({path:path.join(out,role+'-'+label+'-'+width+'.png'),animations:'disabled'});else await page.screenshot({path:path.join(out,role+'-'+label+'-'+width+'.png'),fullPage:true,animations:'disabled'})}await page.setViewportSize({width:1440,height:1100})};
  const openFinance=async(role)=>{const page=sessions[role].page;await page.goto(base+'/app/modules/zhihu/finance');await page.getByText(/结果更新于/).waitFor();await page.getByLabel('开始日期',{exact:true}).fill(data.from);await page.getByLabel('结束日期',{exact:true}).fill(data.to);await page.getByRole('button',{name:'查看账单',exact:true}).click();await page.getByRole('button',{name:'刷新结果',exact:true}).waitFor();return page};
  const f=await openFinance('finance'),hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const files=[['new_user',process.env.OPC_NEW_USER_SAMPLE],['activation',process.env.OPC_ACTIVATION_SAMPLE]],hashes=files.map(([,file])=>hash(file));
  const upload=async(type,file)=>{await f.locator(`input[name="reportType"][value="${type}"]`).check();await f.locator('input[type="file"]').setInputFiles(file);const pending=f.waitForResponse(r=>r.url().endsWith('/workbench/import'));await f.getByRole('button',{name:'上传并自动分析',exact:true}).click();const response=await pending;assert.equal(response.status(),202,await response.text());await f.getByRole('region',{name:'当前报表分析'}).waitFor();await f.getByText(/报表已读取|报表已分析完成|这份报表已上传过/).first().waitFor();return(await response.json()).data};
  const original=await upload(...files[1]);
  let view=await current();assert.equal(view.summary.byType.activation.quantity,'5');
  const region=f.getByRole('region',{name:'当前报表分析'});
  await region.getByRole('button',{name:'撤销导入',exact:true}).click();
  const dialog=f.getByRole('dialog',{name:'撤销这份报表',exact:true});await dialog.waitFor();await shot('finance','withdraw-preview');
  await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await current()).summary.byType.activation.quantity,'5');
  await region.getByRole('button',{name:'撤销导入',exact:true}).click();await dialog.getByRole('button',{name:'确认撤销',exact:true}).click();
  await f.getByText(/已撤销并移除上传记录/).waitFor();assert.equal((await current()).summary.byType.activation.quantity,'0');await shot('finance','withdrawn');
  const repeated=await upload(...files[1]);assert.notEqual(repeated.id,original.id);assert.equal(repeated.duplicate,false);assert.equal((await current()).summary.byType.activation.quantity,'5');
  const confirm=async()=>{await f.getByRole('button',{name:'核对并确认账单',exact:true}).click();await f.getByRole('checkbox',{name:'我已核对报表、人员和计算金额'}).check();const pending=f.waitForResponse(r=>r.url().endsWith('/workbench/confirm'));await f.getByRole('button',{name:'确认核对结果',exact:true}).click();const response=await pending;assert.equal(response.status(),200,await response.text());await f.getByText(/已核对本期金额/).waitFor();};
  await confirm();assert.equal((await current()).summary.byType.activation.confirmedPayable,'1.2000');
  const a=await openFinance('admin');await a.locator('.import-history > summary').click();
  const uploadRow=a.locator('.import-history-list li').filter({hasText:path.basename(files[1][1])});await uploadRow.getByRole('button',{name:'撤销导入',exact:true}).click();
  await a.getByRole('dialog',{name:'撤销这份报表',exact:true}).getByText(/1 条已确认过金额/).waitFor();await shot('admin','confirmed-withdraw-preview');
  await a.getByRole('dialog',{name:'撤销这份报表',exact:true}).getByRole('button',{name:'确认撤销',exact:true}).click();await a.getByText(/已撤销并移除上传记录/).waitFor();await shot('admin','correction-ready');
  await f.getByRole('button',{name:'刷新结果',exact:true}).click();await f.getByText('来源报表已撤销',{exact:true}).first().waitFor();await confirm();view=await current();assert.equal(view.summary.byType.activation.confirmedPayable,'0.0000');assert.equal(view.summary.byType.activation.quantity,'0');await shot('finance','correction-confirmed');
  await a.goto(base+'/app/modules/zhihu/data-import');await a.getByRole('button',{name:'九月历史报表.xlsx',exact:true}).first().click();await a.getByRole('button',{name:'删除这份旧报表',exact:true}).click();await a.getByRole('button',{name:'确认删除旧报表',exact:true}).waitFor();await shot('admin','legacy-preview');
  await a.getByRole('button',{name:'确认删除旧报表',exact:true}).click();await a.getByText(/已删除这份旧报表/).waitFor();assert.equal(await a.getByText('九月历史报表.xlsx',{exact:true}).count(),0);await shot('admin','legacy-removed');
  for(const role of ['operations','leader','creator','independent']){const page=sessions[role].page;await page.goto(base+(role==='operations'?'/app/modules/zhihu/operations?tab=issues':'/app/income'));if(role==='operations')await page.locator('.issues').waitFor();else await page.getByRole('heading',{name:role==='leader'?'团队业绩与分成':'我的收入明细',exact:true}).waitFor();await shot(role,'result');assert.equal(await page.getByRole('button',{name:'撤销导入',exact:true}).count(),0);}
  assert.deepEqual(files.map(([,file])=>hash(file)),hashes);for(const s of Object.values(sessions))assert.deepEqual(s.errors,[]);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:'passed',widths:[1440,375],roles:Object.keys(sessions),sourceFilesUnchanged:true,withdrawReupload:true,confirmedCorrection:'1.2000 -> 0.0000',legacyDelete:true},null,2));console.log('报表撤销、重传、更正和旧报表删除：六角色浏览器验收通过');
 }catch(e){for(const [role,s] of Object.entries(sessions)){await s.page.screenshot({path:path.join(out,'failed-'+role+'.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,'failed-'+role+'.txt'),await s.page.locator('body').innerText().catch(()=>''))}throw e}
 finally{await browser?.close();if(host.connected)host.send('stop');await new Promise(resolve=>{if(host.exitCode!==null)return resolve();const t=setTimeout(()=>{host.kill();resolve()},30000);host.once('exit',()=>{clearTimeout(t);resolve()})});log.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
