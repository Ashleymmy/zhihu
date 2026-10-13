const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.OPC_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.resolve(root,'../.opc-work/works-search-ui');fs.mkdirSync(out,{recursive:true});
async function main(){
 const log=fs.createWriteStream(path.join(out,'host.log'));
 const host=spawn(process.execPath,['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(__dirname,'review-host.ts')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,REMEDIATION_REVIEW:'1'}});host.stdout.pipe(log);host.stderr.pipe(log);
 let browser;const results=[];
 try{
  const {port}=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('隔离演示启动超时')),120000);host.once('message',r=>{clearTimeout(t);resolve(r)});host.once('exit',c=>{clearTimeout(t);reject(Error('演示退出 '+c))})});
  const base=`http://127.0.0.1:${port}`,endpoint=base+'/api/v1/modules/zhihu/workbench/works';
  browser=await chromium.launch({headless:true,channel:'msedge'});
  for(const [role,username,password] of [['admin','admin','Admin123456!'],['finance','review_finance','Review123456'],['operations','review_ops','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456']]){
   const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
   await page.goto(base+'/app/login');await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[type="password"]').fill(password);const logging=page.waitForResponse(r=>r.url().endsWith('/core/auth/login'));await page.locator('button[type="submit"]').click();const login=await logging;assert.equal(login.status(),200);const token=(await login.json()).data.token;await page.waitForURL(u=>!u.pathname.endsWith('/login'));
   const headers={Authorization:'Bearer '+token,'X-Client-Id':login.request().headers()['x-client-id']};
   const query=async(search,projectId='1')=>context.request.get(endpoint+'?'+new URLSearchParams({projectId,accountId:'1',page:'1',pageSize:'25',search}),{headers});
   const allResponse=await query('');assert.equal(allResponse.status(),200);const all=(await allResponse.json()).data;
   if(role==='finance'){
    if(all.list.length){const r=await query(all.list[0].keyword);assert.equal(r.status(),200);assert((await r.json()).data.list.some(w=>w.id===all.list[0].id));}
    assert.equal((await query('作品','999999')).status(),403);
    await page.goto(base+'/app/works');await page.waitForURL(u=>u.pathname!=='/app/works');assert.equal(await page.getByRole('search',{name:'搜索作品'}).count(),0);
    results.push({role,visibleRecords:all.total,readSearch:true,workPageRemainsRestricted:true,scopeRejected:true});await context.close();continue;
   }
   await page.goto(base+'/app/works');const form=page.getByRole('search',{name:'搜索作品'});await form.waitFor();await page.locator('.work-count').getByText(`共 ${all.total} 条作品`,{exact:true}).waitFor();
   const search=async(text,enter=false)=>{await form.getByRole('searchbox').fill(text);const response=page.waitForResponse(r=>r.url().startsWith(endpoint)&&new URL(r.url()).searchParams.get('search')===text.trim());if(enter)await form.getByRole('searchbox').press('Enter');else await form.getByRole('button',{name:'搜索',exact:true}).click();const r=await response;assert.equal(r.status(),200);const data=(await r.json()).data;await page.locator('.work-count').getByText(`共 ${data.total} 条作品符合搜索条件`,{exact:true}).waitFor();return data};
   if(all.list.length){const row=all.list[0];for(const text of [row.keyword,row.description,row.executorName,row.workUrl].filter(Boolean)){const found=await search(text,true);assert(found.list.some(w=>w.id===row.id),role+' missing search result');}}
   const missing=await search('绝不存在的作品名称');assert.equal(missing.total,0);await page.getByText('没有找到匹配的作品，换个搜索词试试。',{exact:true}).waitFor();await page.getByRole('button',{name:'查看全部作品',exact:true}).click();await page.locator('.work-count').getByText(`共 ${all.total} 条作品`,{exact:true}).waitFor();assert.equal(await form.getByRole('searchbox').inputValue(),'');
   if(all.list.length)await search(all.list[0].keyword);
   for(const width of [1440,375]){await page.setViewportSize({width,height:1050});if(await page.locator('.studio-app').getAttribute('data-menu-open')==='true')await page.locator('.menu-toggle').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),role+' horizontal overflow');assert(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:path.join(out,role+'-search-'+width+'.png'),fullPage:true,animations:'disabled'});}
   assert.equal((await query('作品','999999')).status(),403);assert.equal((await query('长'.repeat(201))).status(),422);assert.deepEqual(errors,[]);results.push({role,visibleRecords:all.total,widths:[1440,375],search:true,clear:true,scopeRejected:true});await context.close();
  }
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:'passed',results},null,2));console.log('作品搜索六角色浏览器验收通过');
 }finally{await browser?.close();if(host.connected){host.send('stop');await new Promise(resolve=>{const t=setTimeout(()=>{host.kill();resolve()},20000);host.once('exit',()=>{clearTimeout(t);resolve()})})}log.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
