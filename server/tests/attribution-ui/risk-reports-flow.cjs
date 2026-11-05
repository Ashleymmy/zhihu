const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.OPC_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.resolve(root,'../.opc-work/risk-reports/ui');
fs.mkdirSync(out,{recursive:true});
async function main(){
 const log=fs.createWriteStream(path.join(out,'host.log'));
 const host=spawn(process.execPath,['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(__dirname,'review-host.ts')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,REMEDIATION_REVIEW:'1',OPC_REVIEW_IMPORT_RECOVERY:'1',OPC_REVIEW_RISK_REPORTS:'1'}});
 host.stdout.pipe(log);host.stderr.pipe(log);
 let browser,db;const sessions={};
 try{
  const {port,importRecoveryDb}=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Disposable review host timed out')),120000);host.once('message',r=>{clearTimeout(t);resolve(r)});host.once('exit',c=>{clearTimeout(t);reject(Error('Review host exited '+c))})});
  assert.equal(importRecoveryDb.database,'remediation_review_test');assert(['localhost','127.0.0.1'].includes(importRecoveryDb.host));
  db=await require('mysql2/promise').createConnection(importRecoveryDb);
  await db.query("INSERT INTO users(username,password_hash,role,display_name,is_active,must_change_pwd) VALUES('review_developer',?,'developer','开发测试',1,0)",[await require('bcryptjs').hash('Review123456',4)]);
  await db.query("UPDATE compositions SET sync_status='synced',zhihu_composition_id=CONCAT('2071000000000000',id)");
  await db.query("INSERT INTO users(username,password_hash,role,display_name,is_active,must_change_pwd) VALUES('review_operator',?,'operator','普通运营',1,0)",[await require('bcryptjs').hash('Review123456',4)]);
  const base=`http://127.0.0.1:${port}`,scope={projectId:'1',accountId:'1'},today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),month=today.slice(0,7);
  browser=await chromium.launch({headless:true,channel:process.env.OPC_BROWSER_CHANNEL||'msedge'});
  for(const [role,username,password] of [['admin','admin','Admin123456!'],['developer','review_developer','Review123456'],['finance','review_finance','Review123456'],['operations','review_ops','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456'],['operator','review_operator','Review123456']]){
   const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
   await page.goto(base+'/app/login');await page.getByRole('button',{name:'使用原账号登录',exact:true}).click();await page.locator('input[autocomplete=username]').fill(username);await page.locator('input[type=password]').fill(password);
   const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type=submit]').click();const response=await logging;assert.equal(response.status(),200);const token=(await response.json()).data.token;await page.waitForURL(u=>!u.pathname.endsWith('/login'));
   sessions[role]={page,context,errors,headers:{Authorization:'Bearer '+token,'X-Client-Id':response.request().headers()['x-client-id']}};
  }

  const baselineMoney=JSON.stringify((await db.query('SELECT * FROM opc_income_entries ORDER BY id'))[0]);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGQAAAABJRU5ErkJggg==','base64');
  const shot=async(role,name)=>{const p=sessions[role].page;for(const width of [1440,375]){await p.setViewportSize({width,height:1000});if(await p.locator('.studio-app').getAttribute('data-menu-open')==='true')await p.locator('.menu-toggle').click();await p.screenshot({path:path.join(out,`${role}-${name}-${width}.png`),fullPage:true,animations:'disabled'});const dims=await p.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));assert(dims.scroll<=dims.width+1,JSON.stringify({role,name,dims}));}};
  for(const role of ['admin','developer','operations']){
    const {page:p}=sessions[role];await p.goto(base+'/app/works');await p.getByRole('button',{name:'风险举报',exact:true}).click();
    await p.getByText('示例截流词',{exact:true}).waitFor();await shot(role,'outgoing');
    await p.getByRole('button',{name:'我方被举报',exact:true}).click();await p.getByText('示例搬运词',{exact:true}).waitFor();await p.getByText('判定违规',{exact:true}).last().waitFor();await shot(role,'incoming');
    await p.getByRole('button',{name:'提交举报',exact:true}).click();await p.locator('.risk-work input').first().check();await p.getByLabel('风险词',{exact:true}).fill('隔离举报-'+role);await p.getByLabel('风险类型',{exact:true}).selectOption('2');await p.getByLabel('风险链接（必填）',{exact:true}).fill('https://example.com/risk');
    await p.getByLabel('上传举报截图').setInputFiles({name:'oversized.png',mimeType:'image/png',buffer:Buffer.alloc(2*1024*1024+1)});await p.getByRole('alert').getByText('请选择不超过 2 MB 的 PNG 或 JPEG 截图',{exact:true}).waitFor();
    const imageDone=p.waitForResponse(r=>r.url().includes('/risk-reports/images?'));await p.getByLabel('上传举报截图').setInputFiles({name:'举报截图.png',mimeType:'image/png',buffer:png});assert.equal((await imageDone).status(),200);await p.getByRole('button',{name:'移除截图',exact:true}).waitFor();await shot(role,'compose');
    const submitting=p.waitForResponse(r=>r.url().endsWith('/risk-reports')&&r.request().method()==='POST');await p.getByRole('button',{name:'提交举报',exact:true}).click();const submitted=await submitting;assert.equal(submitted.status(),200,await submitted.text());assert.equal((await submitted.json()).data.status,'submitted');await p.getByRole('button',{name:'刷新记录',exact:true}).waitFor();await p.getByText('隔离举报-'+role,{exact:true}).waitFor();await shot(role,'history');
    await p.getByRole('button',{name:'我方举报',exact:true}).click();await p.getByText('隔离举报-'+role,{exact:true}).waitFor();
    await p.reload();await p.getByRole('button',{name:'风险举报',exact:true}).click();await p.getByText('隔离举报-'+role,{exact:true}).waitFor();
    console.log(role+' risk flow checked');
  }

  const u=sessions.admin.page;
  await u.getByRole('button',{name:'提交举报',exact:true}).click();await u.locator('.risk-work input').first().check();await u.getByLabel('风险词',{exact:true}).fill('隔离待核对');
  const imgDone=u.waitForResponse(r=>r.url().includes('/risk-reports/images?'));await u.getByLabel('上传举报截图').setInputFiles({name:'截图.png',mimeType:'image/png',buffer:png});assert.equal((await imgDone).status(),200);
  const uncertain=u.waitForResponse(r=>r.url().endsWith('/risk-reports')&&r.request().method()==='POST');await u.getByRole('button',{name:'提交举报',exact:true}).click();assert.equal((await uncertain).status(),200);
  await u.getByRole('button',{name:'核对后重试',exact:true}).click();const drawer=u.getByRole('dialog',{name:'核对举报后重试'});await drawer.waitFor();assert(await drawer.getByRole('button',{name:'确认重新提交',exact:true}).isDisabled());
  await shot('admin','uncertain-review');await drawer.getByLabel('我已核对知乎记录，确认本次举报未被接收。').check();const resent=u.waitForResponse(r=>r.url().endsWith('/retry'));await drawer.getByRole('button',{name:'确认重新提交',exact:true}).click();assert.equal((await resent).status(),200);await drawer.waitFor({state:'hidden'});await u.getByRole('button',{name:'核对后重试',exact:true}).waitFor({state:'hidden'});
  const p=sessions.operations.page;
  await p.route('**/risk-reports?*',r=>r.fulfill({status:502,contentType:'application/json',body:JSON.stringify({code:50002,message:'暂时无法读取知乎举报结果，请重新查询',data:null})}),{times:1});await p.getByRole('button',{name:'查询',exact:true}).click();await p.getByRole('alert').waitFor();assert.equal(await p.locator('.risk-empty').count(),0);await shot('operations','query-error');await p.getByRole('button',{name:'重新查询',exact:true}).click();await p.getByText('隔离举报-operations',{exact:true}).waitFor();
  for(const role of ['finance','operator','leader','creator','independent']){const s=sessions[role];await s.page.goto(base+'/app/works');await s.page.waitForLoadState('networkidle');assert.equal(await s.page.getByRole('button',{name:'风险举报',exact:true}).count(),0);await shot(role,'no-entry');const r=await s.context.request.get(base+'/api/v1/modules/zhihu/risk-reports',{headers:s.headers,params:scope});assert.equal(r.status(),403);}
  assert.equal(JSON.stringify((await db.query('SELECT * FROM opc_income_entries ORDER BY id'))[0]),baselineMoney);
  assert.equal((await db.query("SELECT COUNT(*) n FROM audit_logs WHERE action='zhihu.risk.submit'"))[0][0].n,4);
  for(const s of Object.values(sessions))assert.deepEqual(s.errors,[]);
  const result={passed:true,roles:Object.keys(sessions),widths:[1440,375],submit:true,uploadValidation:true,upstreamResults:true,persistentHistory:true,errorsNotEmpty:true,financialWritesFromReports:0};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){for(const [role,s] of Object.entries(sessions)){await s.page.screenshot({path:path.join(out,'failed-'+role+'.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,'failed-'+role+'.txt'),await s.page.locator('body').innerText().catch(()=>''))}throw e}
 finally{await db?.end();await browser?.close();if(host.connected)host.send('stop');await new Promise(resolve=>{if(host.exitCode!==null)return resolve();const t=setTimeout(()=>{host.kill();resolve()},30000);host.once('exit',()=>{clearTimeout(t);resolve()})});log.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
