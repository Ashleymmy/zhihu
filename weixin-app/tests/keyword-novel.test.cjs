const test=require('node:test');
const assert=require('node:assert/strict');
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
