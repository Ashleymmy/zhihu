const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.OPC_PLAYWRIGHT_MODULE||'playwright');
const serverRoot=path.resolve(__dirname,'../..'),out=path.resolve(serverRoot,'../.opc-work/linkage-ui');
fs.mkdirSync(out,{recursive:true});

async function main(){
  const child=spawn(process.execPath,['--import',pathToFileURL(path.join(serverRoot,'node_modules/tsx/dist/loader.mjs')).href,path.join(__dirname,'host.ts')],{
    cwd:serverRoot,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,ATTRIBUTION_UI_TEST:'1',ATTRIBUTION_LINKAGE_TEST:'1',ATTRIBUTION_DEMO_OUT:''},
  });
  const log=fs.createWriteStream(path.join(out,'host.log'));child.stdout.pipe(log);child.stderr.pipe(log);
  let browser,page;
  try{
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('隔离主机启动超时')),90000);
      child.once('message',message=>{clearTimeout(timer);resolve(message.port)});
      child.once('exit',code=>{clearTimeout(timer);reject(Error('隔离主机退出 '+code))});
    });
    const origin='http://127.0.0.1:'+port;
    browser=await chromium.launch({headless:true,channel:process.env.OPC_BROWSER_CHANNEL||'msedge'});
    page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
    page.setDefaultTimeout(25000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await page.goto(origin+'/app/login');
    await page.locator('input[autocomplete=username]').fill('admin');
    await page.locator('input[type=password]').fill('isolated_password');
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/dashboard');
    await page.goto(origin+'/app/modules/zhihu/operations');
    await page.getByRole('cell',{name:/旧版无作品计划/}).waitFor();
    await page.getByRole('button',{name:'作品审核',exact:true}).click();
    await page.getByText('请补充关键词',{exact:true}).first().waitFor();
    assert.equal(await page.locator('tbody tr').count(),25);
    assert.equal(await page.getByRole('button',{name:'审核通过',exact:true}).count(),0);
    await page.getByRole('button',{name:'下一页',exact:true}).click();
    await page.getByText('第 2 页，共 27 条',{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===2);
    await page.screenshot({path:path.join(out,'works-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'渠道与任务',exact:true}).click();
    await page.getByText('¥8.25',{exact:true}).waitFor();
    child.send('linkage-update');
    await page.getByText('¥9.25',{exact:true}).waitFor();
    await page.getByText('暂停',{exact:true}).waitFor();
    await page.screenshot({path:path.join(out,'catalog-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'作品审核',exact:true}).click();
    await page.getByRole('cell',{name:/已通过/}).first().waitFor();
    await page.getByRole('link',{name:'管理推广作品',exact:true}).first().click();
    await page.getByRole('cell',{name:/已通过/}).first().waitFor();
    await page.getByRole('link',{name:'查看平台核验',exact:true}).first().click();
    await page.getByText('未提交平台核验',{exact:true}).first().waitFor();
    await page.setViewportSize({width:390,height:844});
    await page.reload();
    await page.getByText('未提交平台核验',{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'下一页',exact:true}).click();
    await page.getByText('第 2 页，共 27 条',{exact:true}).waitFor();
    await page.screenshot({path:path.join(out,'works-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    console.log('通过：历史关键词、旧作品分页、两边审核结果一致、目录自动刷新、手机布局。截图：'+out);
  }catch(error){
    if(page){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});console.error(page.url(),await page.locator('body').innerText())}
    throw error;
  }finally{
    if(browser)await browser.close();
    if(child.connected)child.send('stop');
    await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{child.kill();resolve()},15000);child.once('exit',()=>{clearTimeout(timer);resolve()})});
    log.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
