// Original 28-page UI against the disposable real API through the real bridge.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),session=JSON.parse(fs.readFileSync(path.join(root,'.opc-work/p2-mini-ui/session.json')));
const automator=require(process.env.WECHAT_AUTOMATOR_MODULE||path.join(root,'.runtime/wechat-tools/node_modules/miniprogram-automator'));
const out=path.join(root,'改造/截图_2026-10-09/P2-mini-minimal');fs.mkdirSync(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));const event=(dataset={},value)=>({currentTarget:{dataset},detail:{value}});
async function until(read,check,label){let value;for(let i=0;i<100;i++){value=await read();if(check(value))return value;await pause(200);}throw Error(label+' timed out');}
(async()=>{
 const m=await automator.connect({wsEndpoint:session.endpoint}),results=process.env.MINI_REVIEW_ROLES&&fs.existsSync(path.join(out,'result.json'))?JSON.parse(fs.readFileSync(path.join(out,'result.json'))).results.filter(r=>!process.env.MINI_REVIEW_ROLES.split(',').includes(r.role)):[],errors=[];
 m.on('exception',e=>errors.push(String(e.message||e)));
 const loaded=async p=>{const d=await until(()=>p.data(),d=>!d.loading&&!d.busy,'load '+p.path);assert(!d.error,p.path+': '+d.error);return d;};
 async function open(route){console.log('OPEN',route);await m[['home','income','mine'].includes(route)?'switchTab':'navigateTo']('/pages/'+route+'/index');const p=await until(()=>m.currentPage(),p=>p.path==='pages/'+route+'/index',route);await loaded(p);return p;}
 async function shot(name,selector){await m.callWxMethod('pageScrollTo',{...(selector?{selector}:{scrollTop:0}),duration:0});await pause(200);const layout=await m.evaluate(()=>new Promise(resolve=>{const info=wx.getSystemInfoSync();wx.createSelectorQuery().selectAll('view,button,input,picker,textarea').boundingClientRect(rects=>resolve({width:info.windowWidth,overflow:rects.filter(r=>r.width>0&&(r.left < -1||r.right>info.windowWidth+1)).map(r=>({id:r.id,left:r.left,right:r.right,width:r.width}))})).exec();}));assert.equal(layout.width,375);assert.equal(layout.overflow.length,0,name+': '+JSON.stringify(layout.overflow));await m.screenshot({path:path.join(out,name+'.png')});}
 async function login(username,password){
  if(await m.evaluate(()=>!!getApp().globalData.user)){const p=await open('mine');await p.callMethod('logout');}
  await m.reLaunch('/pages/login/index');const p=await until(()=>m.currentPage(),p=>p.path==='pages/login/index','login page');
  await(await p.$('input[data-name="username"]')).input(username);await(await p.$('input[data-name="password"]')).input(password);
  await(await p.$('checkbox-group')).trigger('change',{value:['agree']});await(await p.$('.login-btn')).tap();
  await until(()=>m.currentPage(),p=>p.path!=='pages/login/index','login '+username);await loaded(await m.currentPage());
 }
 try{
 if(process.env.MINI_REVIEW_REPORTS_ONLY==='1'){
  await login('review_finance','Review123456');const p=await open('reports'),d=await loaded(p);
  assert(d.list.some(r=>r.status==='processed'&&r.statusText==='已读取'));
  await shot('finance-reports');await p.callMethod('inspect',event({id:d.list[0].id}));await loaded(p);await shot('finance-report-progress','.report-row');
  assert.equal(errors.length,0);console.log('REPORT_STATUS_PASSED');return;
 }
 for(const [role,user,password] of [['admin','admin','Admin123456!'],['operations','review_ops','Review123456'],['leader','leader_wang','Review123456'],['creator','creator_li','Review123456'],['independent','creator_chen','Review123456'],['finance','review_finance','Review123456']].filter(([r])=>!process.env.MINI_REVIEW_ROLES||process.env.MINI_REVIEW_ROLES.split(',').includes(r))){
  console.log('ROLE',role);await login(user,password);await open('home');await shot(role+'-home');
  let p=await open('work-data');let d=await loaded(p);assert(!d.activityError,d.activityError);await shot(role+'-work-data');
  if(role!=='creator'&&role!=='independent'){await p.callMethod('changeView',event({view:role==='leader'?'team':'all'}));d=await loaded(p);await shot(role+'-team-data');}
  await p.callMethod('activity',event({type:'activation'}));d=await loaded(p);assert(d.activity.list.every(x=>x.metricType==='activation'));await shot(role+'-activation-data','.activity-detail');
  p=await open('income');d=await loaded(p);await shot(role+'-income');
  if(role==='operations'){assert(d.restricted);assert.equal(d.summary,null);}else if(!d.restricted){
   await p.callMethod('filter',event({field:'metricType',value:'activation'}));d=await loaded(p);assert(d.records.every(x=>x.metricType==='activation'));await shot(role+'-activation-income');
   if(d.records.length){await p.callMethod('detail',event({id:d.records[0].id}));await until(()=>p.data(),d=>!d.historyLoading,'history');assert(!(await p.data()).historyError);await shot(role+'-income-detail','.income-detail');}
   if(role==='leader'){await p.callMethod('filter',event({field:'group',value:'team'}));await loaded(p);await shot('leader-team-income');}
  }
  p=await open('prices');d=await loaded(p);assert.equal(d.denied,role==='operations');if(!d.denied)await shot(role+'-prices');
  p=await open('wallet');d=await loaded(p);assert.equal(d.denied,role==='operations');if(!d.denied){await shot(role+'-wallet');if(d.visibleEntries.length){await p.callMethod('inspect',event({id:d.visibleEntries[0].id}));await shot(role+'-bill-detail','.list-item .notice');}p=await open('withdrawals');await shot(role+'-withdrawals');}
  p=await open('reports');d=await loaded(p);if(['admin','finance'].includes(role)){assert(!d.denied);await shot(role+'-reports');if(d.list.length){await p.callMethod('inspect',event({id:d.list[0].id}));await loaded(p);assert((await p.data()).detail.steps.length);await shot(role+'-report-progress','.report-row');}await p.callMethod('section',event({section:'exceptions'}));await loaded(p);await shot(role+'-issues');}else assert(d.denied);
  p=await open('keywords');d=await loaded(p);if(role==='finance')assert(d.denied);else {await shot(role+'-keywords');if(d.list.length){const record=d.list[0];await p.callMethod('followup',event({id:record.id}));d=await loaded(p);assert(d.followupRecord);await shot(role+'-keyword-progress','.kw-card .notice');await m.evaluate(()=>{const page=getCurrentPages().slice(-1)[0];setTimeout(()=>page.followupWorks(),50);return true;});p=await until(()=>m.currentPage(),p=>p.path==='pages/works/index','keyword works');d=await loaded(p);assert(d.list.every(w=>String(w.planId)===String(record.planId)));await shot(role+'-keyword-works');if(d.list.length){await m.evaluate(id=>{const page=getCurrentPages().slice(-1)[0];setTimeout(()=>page.showDetail({currentTarget:{dataset:{id}}}),50);return true;},d.list[0].id);p=await until(()=>m.currentPage(),p=>p.path==='pages/work-detail/index','work detail');await loaded(p);await shot(role+'-work-detail');}}}
  await open('mine');await shot(role+'-mine');results.push({role,width:375,status:'passed'});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({results,errors},null,2));console.log('ROLE_PASSED',role);
 }
 assert.equal(errors.length,0,JSON.stringify(errors));fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({results,errors},null,2));console.log('MINIMAL_UI_PASSED',JSON.stringify(results));
 }catch(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({message:e.message,stack:e.stack,results,errors},null,2));await m.screenshot({path:path.join(out,'failure.png')});throw e;}finally{await m.disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
