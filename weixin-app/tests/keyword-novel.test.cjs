const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {harness,scoped}=require('./harness.cjs');
const user={id:'3',role:'creator'};
function setup() {
 const word={id:'9',keyword:'推广词',novelTitle:'原书名',landingUrl:'https://example.com/original',novelUrl:'https://example.com/original',canEditNovel:1,readOnly:1};
 const h=harness(call=>{
  const scope=scoped(call);if(scope!==undefined)return scope;
  if(call.path==='/core/auth/me')return user;
  if(call.path.endsWith('/attribution-options'))return{tasks:[{id:'1'}],channels:[{id:'2',name:'渠道'}],mappings:[],users:[]};
  if(call.path.endsWith('/novel')){Object.assign(word,{novelTitle:call.data.novel.title,novelUrl:call.data.novel.url});return{id:'9'}}
  if(call.path.endsWith('/keywords'))return call.method==='POST'?{id:'10'}:{list:[word],total:1};
  if(call.path.endsWith('/edit-retry'))return{id:'9'};
  throw Error('Unexpected '+call.path);
 });h.session(user);return {h,word};
}
test('creator sees legacy original link and can copy it, and edits only novel metadata',async()=>{
 const {h}=setup();let copied='';h.wx.setClipboardData=v=>{copied=v.data};
 const page=h.page('keywords');await page.onShow();
 const row=page.data.filteredList[0];assert.equal(row.novelLink,'https://example.com/original');
 page.copy({currentTarget:{dataset:{text:row.novelLink}}});assert.equal(copied,row.novelLink);
 page.choose({currentTarget:{dataset:{index:0,action:'novel'}}});
 assert.equal(page.data.editNovelTitle,'原书名');assert.equal(page.data.editNovelUrl,row.novelLink);
 page.setData({editNovelTitle:'小说完整原名',editNovelUrl:'https://example.com/read'});await page.runAction();
 const sent=h.calls.find(c=>c.method==='POST');assert.match(sent.path,/\/keywords\/9\/novel$/);
 assert.equal(sent.data.novel.title,'小说完整原名');assert.equal(sent.data.keyword,undefined);assert.equal(sent.data.landingUrl,undefined);
 assert.equal(page.data.filteredList[0].novelTitle,'小说完整原名');page.onHide();
});
test('unsafe original links are not offered for copying and viewers cannot edit',()=>{
 const k=harness().load('utils/keyword-actions');
 const row=k.decorate(user,{novelUrl:'javascript:alert(1)',canEditNovel:0,readOnly:1},{users:[],tasks:[]});
 assert.equal(row.novelLink,'');assert(!row.actions.some(a=>a.key==='novel'));
});
test('creation sends the optional original name using moderated title field',async()=>{
 const {h}=setup();h.wx.navigateBack=()=>{};
 const page=h.page('keywords/create');await page.onShow();
 page.inputKeyword({currentTarget:{dataset:{index:0}},detail:{value:'新推广词'}});
 page.inputUrl({currentTarget:{dataset:{index:0}},detail:{value:'https://example.com/original'}});
 page.inputTitle({currentTarget:{dataset:{index:0}},detail:{value:'原始小说名'}});
 await page.confirm();const sent=h.calls.find(c=>c.method==='POST');
 assert.equal(sent.data.novel.title,'原始小说名');assert.equal(sent.data.landingUrl,'https://example.com/original');
 const {textsFor}=require('../cloudfunctions/opc-bridge/content-safety');
 assert(textsFor(sent.path,'POST',sent.data).includes('原始小说名'));
});

test('pasting a complete mobile share URL keeps parameters beyond the native 140-character default',async()=>{
 const {h}=setup();h.wx.navigateBack=()=>{};
 const page=h.page('keywords/create');await page.onShow();
 const url='https://soia.zhihu.com/km_paid_content/share?is_delivery=true&source=e9f03bea58b4524092f6cb42207b6a5f&package=zhihushare0812&channel_id=67154024128158&appkey=2400&ustkn=1&is_share_data=true&fallback_url=zhvip%3A%2F%2Ftab%2Fhome&mst=fixture-complete-story-reference';
 assert.equal(url.slice(0,140).endsWith('channel_id=6715'),true);
 const template=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/keywords/create/index.wxml'),'utf8');
 const input=template.match(/<input\b[^>]*bindinput="inputUrl"[^>]*\/>/)[0];
 // Model native paste length, not just calling the handler with an already intact value.
 const maximum=Number(input.match(/maxlength="(-?\d+)"/)?.[1]??140);
 const pasted=maximum<0?url:url.slice(0,maximum);
 page.inputKeyword({currentTarget:{dataset:{index:0}},detail:{value:'手机分享测试词'}});
 page.inputUrl({currentTarget:{dataset:{index:0}},detail:{value:pasted}});
 await page.confirm();const sent=h.calls.find(c=>c.method==='POST');
 assert.equal(sent.data.landingUrl,url);
 assert.equal(new URL(sent.data.landingUrl).searchParams.get('mst'),'fixture-complete-story-reference');
 assert.equal(maximum,-1);
});

const share='https://soia.zhihu.com/km_paid_content/share?is_delivery=true&source=e9f03bea58b4524092f6cb42207b6a5f&package=zhihushare0812&channel_id=67154024128158&appkey=2400&ustkn=1&is_share_data=true&fallback_url=zhvip%3A%2F%2Ftab%2Fhome&mst=OYNl35gg5oQoWF0q4lkGqe1g0Ju9Qezjl';
const inputEvent=(value,index=0)=>({currentTarget:{dataset:{index}},detail:{value}});
test('the actual signed cloud bridge serializes the complete URL unchanged for creation and retry',async()=>{
 const {createBridge}=require('../cloudfunctions/opc-bridge/bridge');
 const forwarded=[];
 const bridge=createBridge({context:()=>({APPID:'wx22b91776ccf37354',OPENID:'isolated-review'}),secret:'isolated_cloud_bridge_secret_long_enough',
  check:async()=>({errCode:0,result:{suggest:'pass'}}),send:async(_target,payload)=>{forwarded.push(JSON.parse(payload).data);return{code:0,statusCode:200}}});
 for(const path of ['/modules/zhihu/keywords','/modules/zhihu/keywords/9/edit-retry']) {
  const result=await bridge({path,method:'POST',data:{keyword:'完整链接',landingUrl:share,novel:{url:share}}});
  assert.equal(result.statusCode,200);
 }
 assert.equal(forwarded.length,2);
 for(const data of forwarded){assert.equal(data.landingUrl,share);assert.equal(data.novel.url,share);}
});

test('first creation reads the complete clipboard even with share text longer than 1024 and preserves opaque parameters',async()=>{
 for(const mode of ['button','native']) {
  const {h}=setup();h.wx.navigateBack=()=>{};
  const text='推荐小说'.repeat(300)+'\n【'+share+'】';
  h.wx.getClipboardData=({success})=>success({data:text});
  const page=h.page('keywords/create');await page.onShow();
  page.inputKeyword(inputEvent('首次创建完整链接'));
  if(mode==='button')await page.pasteUrl(inputEvent(''));else page.inputUrl(inputEvent(text));
  await page.confirm();
  const sent=h.calls.filter(c=>c.method==='POST');assert.equal(sent.length,1);
  assert.equal(sent[0].data.landingUrl,share);assert.equal(page.data.items[0].landingUrl,share);
 }
});

test('overlong URL is never clipped; native and clipboard entry retain it and do not send a request',async()=>{
 for(const mode of ['button','native']) {
  const {h}=setup();const page=h.page('keywords/create');await page.onShow();
  const url=share+'&extra='+('x'.repeat(1200));
  h.wx.getClipboardData=({success})=>success({data:url});page.inputKeyword(inputEvent('超过上限'));
  if(mode==='button')await page.pasteUrl(inputEvent(''));else page.inputUrl(inputEvent(url));
  await page.confirm();assert.equal(page.data.items[0].landingUrl,url);
  assert.equal(h.calls.filter(c=>c.method==='POST').length,0);assert.match(page.data.error,/1024/);
 }
});

test('clipboard failure or ambiguous contents preserves the current input and permits manual paste',async()=>{
 for(const value of [null,share+' https://example.com/another']) {
  const {h}=setup();const page=h.page('keywords/create');await page.onShow();
  page.inputUrl(inputEvent('https://example.com/original'));
  h.wx.getClipboardData=({success,fail})=>value===null?fail({errMsg:'denied'}):success({data:value});
  await page.pasteUrl(inputEvent(''));assert.equal(page.data.items[0].landingUrl,'https://example.com/original');
  assert(page.data.error);assert.equal(page.data.linkPasting,false);
 }
});

test('late clipboard callbacks cannot overwrite typing, a removed row, a hidden page, or another session',async()=>{
 for(const change of ['typing','remove','hide','session']) {
  const {h}=setup();const page=h.page('keywords/create');await page.onShow();
  page.inputKeyword(inputEvent('保护输入'));page.inputUrl(inputEvent('https://example.com/old'));
  let callback;h.wx.getClipboardData=({success})=>{callback=success};
  const pending=page.pasteUrl(inputEvent(''));
  await page.confirm();assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
  if(change==='typing')page.inputUrl(inputEvent('https://example.com/new'));
  if(change==='remove'){page.addItem();page.removeItem(inputEvent(''));}
  if(change==='hide')page.onHide();
  if(change==='session')h.session({id:'4',role:'creator'},'new-token');
  const before=page.data.items[0].landingUrl;callback({data:share});await pending;
  assert.equal(page.data.items[0].landingUrl,before);assert.equal(page.data.linkPasting,false);
 }
});

test('edit retry sends exactly the full pasted link and metadata editing uses the same extraction',async()=>{
 const {h,word}=setup();Object.assign(word,{canEditFailed:1,taskId:'1',mappingId:'2'});
 const page=h.page('keywords');await page.onShow();
 page.data.options.mappings=[{id:'2',channelName:'渠道'}];
 h.wx.getClipboardData=({success})=>success({data:'小说链接：'+share+'。'});
 page.choose({currentTarget:{dataset:{index:0,action:'edit-retry'}}});
 await page.pasteStoryUrl({currentTarget:{dataset:{name:'editLandingUrl'}}});
 await page.runAction();const sent=h.calls.find(c=>c.path.endsWith('/edit-retry'));
 assert.equal(sent.data.landingUrl,share);assert.equal(sent.data.keyword,word.keyword);
 page.choose({currentTarget:{dataset:{index:0,action:'novel'}}});
 page.setData({editNovelUrl:'小说链接：'+share+'。'});await page.runAction();
 assert.equal(h.calls.find(c=>c.path.endsWith('/novel')).data.novel.url,share);page.onHide();
});

test('the editor ignores clipboard results after selection changes and all novel inputs have no native cutoff',async()=>{
 const {h}=setup();const page=h.page('keywords');await page.onShow();
 page.choose({currentTarget:{dataset:{index:0,action:'novel'}}});
 let callback;h.wx.getClipboardData=({success})=>{callback=success};
 const pending=page.pasteStoryUrl({currentTarget:{dataset:{name:'editNovelUrl'}}});
 page.close();page.choose({currentTarget:{dataset:{index:0,action:'novel'}}});
 const original=page.data.editNovelUrl;callback({data:share});await pending;
 assert.equal(page.data.editNovelUrl,original);page.onHide();
 const template=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/keywords/index.wxml'),'utf8');
 const inputs=template.match(/<input\b[^>]*data-name="edit(?:Landing|Novel)Url"[^>]*\/>/g);
 assert.equal(inputs.length,3);for(const input of inputs)assert.match(input,/maxlength="-1"/);
});
