const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.OPC_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.resolve(root,'../.opc-work/salt-boards/ui');
fs.mkdirSync(out,{recursive:true});
async function main(){
 const log=fs.createWriteStream(path.join(out,'host.log'));
 const host=spawn(process.execPath,['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(__dirname,'review-host.ts')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,REMEDIATION_REVIEW:'1',OPC_REVIEW_IMPORT_RECOVERY:'1',OPC_REVIEW_SALT_BOARDS:'1'}});
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
   const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
   await page.goto(base+'/app/login');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'使用原账号登录',exact:true}).click({force:true});await page.locator('input[autocomplete=username]').fill(username);await page.locator('input[type=password]').fill(password);
   const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type=submit]').click({force:true});const response=await logging;assert.equal(response.status(),200);const token=(await response.json()).data.token;await page.waitForURL(u=>!u.pathname.endsWith('/login'));
   sessions[role]={page,context,errors,headers:{Authorization:'Bearer '+token,'X-Client-Id':response.request().headers()['x-client-id']}};
  }


  const shot=async(role,name)=>{const p=sessions[role].page;for(const width of [1440,375]){await p.setViewportSize({width,height:1000});if(await p.locator('.studio-app').getAttribute('data-menu-open')==='true')await p.locator('.menu-toggle').click();await p.screenshot({path:path.join(out,role+'-'+name+'-'+width+'.png'),fullPage:true,animations:'disabled'});const dims=await p.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));assert(dims.scroll<=dims.width+1,JSON.stringify({role,name,dims}));}};
  const ids=['1661766472115556352','1710322868645269504','1710322868645269505'];
  for(const role of ['admin','developer','operations','operator']){
   const {page:p}=sessions[role];await p.goto(base+'/app/projects');await p.getByRole('link',{name:'盐选榜单 →',exact:true}).click();
   await p.getByRole('heading',{name:'盐选榜单',exact:true}).waitFor();await p.getByRole('button',{name:'榜单小说1',exact:true}).first().waitFor();await shot(role,'list');
   await p.getByRole('button',{name:'下一页',exact:true}).click();await p.getByRole('button',{name:'榜单小说21',exact:true}).first().waitFor();assert(await p.getByRole('button',{name:'下一页',exact:true}).isDisabled());await shot(role,'page-two');
   await p.getByRole('button',{name:'上一页',exact:true}).click();await p.getByRole('button',{name:'榜单小说1',exact:true}).first().waitFor();
   await p.getByPlaceholder('筛选本页小说名或标签').fill('榜单小说19');await p.getByRole('button',{name:'榜单小说19',exact:true}).last().click();const detail=p.getByRole('dialog',{name:'榜单小说19',exact:true});await detail.waitFor();assert((await detail.getByRole('link',{name:'查看原文',exact:true}).getAttribute('href')).includes('/section/18'));
   await detail.getByRole('button',{name:'复制原文链接',exact:true}).click();await detail.getByText('原文链接已复制',{exact:true}).waitFor();await shot(role,'details');await detail.getByRole('button',{name:'关闭详情',exact:true}).click();
   await p.getByLabel('选择榜单',{exact:true}).selectOption(ids[1]);await p.getByRole('button',{name:'推荐小说1',exact:true}).last().click();await p.getByRole('dialog').getByText('家庭 / 婚姻',{exact:false}).waitFor();await shot(role,'recommendation');await p.getByRole('button',{name:'关闭详情',exact:true}).click();
   await p.getByLabel('选择榜单',{exact:true}).selectOption(ids[2]);await p.getByText('这一页没有内容。可以切换榜单，或返回上一页查看。',{exact:true}).waitFor();assert(await p.getByRole('button',{name:'下一页',exact:true}).isDisabled());await shot(role,'empty');
   console.log(role+' salt boards verified');
  }
  const p=sessions.admin.page;
  await p.route('**/salt/boards?*',r=>r.fulfill({status:502,contentType:'application/json',body:JSON.stringify({code:50002,message:'暂时无法读取知乎榜单，请重新加载',data:null})}),{times:1});await p.getByRole('button',{name:'刷新榜单',exact:true}).click();await p.getByRole('alert').waitFor();assert.equal(await p.locator('.grid-empty').count(),0);await shot('admin','board-error');await p.getByRole('button',{name:'重新加载榜单',exact:true}).click();await p.getByRole('button',{name:'榜单小说1',exact:true}).last().waitFor();
  await p.route('**/salt/boards/*/contents?*',r=>r.fulfill({status:502,contentType:'application/json',body:JSON.stringify({code:50002,message:'暂时无法读取榜单内容，请重试或切换榜单',data:null})}),{times:1});await p.getByRole('button',{name:'下一页',exact:true}).click();await p.getByRole('button',{name:'重试内容查询',exact:true}).waitFor();assert.equal(await p.locator('.grid-empty').count(),0);await shot('admin','contents-error');await p.getByRole('button',{name:'重试内容查询',exact:true}).click();await p.getByRole('button',{name:'榜单小说21',exact:true}).last().waitFor();
  await p.route('**/salt/boards/'+ids[0]+'/contents?*',async r=>{await new Promise(resolve=>setTimeout(resolve,1200));await r.continue()},{times:1});await p.getByRole('button',{name:'上一页',exact:true}).click();await p.getByLabel('选择榜单',{exact:true}).selectOption(ids[1]);await p.getByRole('button',{name:'推荐小说1',exact:true}).last().waitFor();await p.waitForTimeout(1500);assert.equal(await p.getByRole('button',{name:'榜单小说1',exact:true}).count(),0);
  for(const role of ['finance','leader','creator','independent']){const s=sessions[role];await s.page.goto(base+'/app/modules/zhihu/salt?projectId=1&accountId=1');await s.page.waitForLoadState('networkidle');assert.equal(await s.page.locator('.salt-page').count(),0);const r=await s.context.request.get(base+'/api/v1/modules/zhihu/zhihu-content/salt/boards',{headers:s.headers,params:scope});assert.equal(r.status(),403);await shot(role,'no-entry');}
  for(const s of Object.values(sessions))assert.deepEqual(s.errors,[]);
  const result={passed:true,roles:Object.keys(sessions),widths:[1440,375],pagination:true,details:true,clipboard:true,empty:true,errorsNotEmpty:true,staleResponseIgnored:true};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){for(const [role,s] of Object.entries(sessions)){await s.page.screenshot({path:path.join(out,'failed-'+role+'.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,'failed-'+role+'.txt'),await s.page.locator('body').innerText().catch(()=>''))}throw e}
 finally{await db?.end();await browser?.close();if(host.connected)host.send('stop');await new Promise(resolve=>{if(host.exitCode!==null)return resolve();const t=setTimeout(()=>{host.kill();resolve()},30000);host.once('exit',()=>{clearTimeout(t);resolve()})});log.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
