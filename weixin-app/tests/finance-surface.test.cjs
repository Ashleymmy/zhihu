const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {harness, scoped} = require('./harness.cjs');
const app = require('../miniprogram/app.json');
const roles = [
  {role:'creator',parentId:null}, {role:'creator',parentId:'2'}, {role:'leader'},
  {role:'admin',adminDuty:'finance'}, {role:'admin',adminDuty:'operations'},
  {role:'admin',adminDuty:'all'}, {role:'developer'}, {role:'operator'},
];
const amounts = {total:'20.00',today:'5.00',yesterday:'15.00'};
function setup(role) {
 const user={id:'3',username:'test',displayName:'验收',hasPassword:true,...role};
 const h=harness(c=>{
  if(c.path==='/core/auth/me'||c.path==='/core/auth/profile')return user;
  const common=scoped(c);if(common!==undefined)return common;
  if(c.path==='/core/announcements/active')return [];
  if(c.path==='/modules/zhihu/home-summary')return {todayReceivable:'5.00',todayPayable:'6.00',keywords:12,works:3};
  if(c.path==='/core/member-summary')return {direct:amounts,team:{memberCount:4,reward:amounts,turnover:null}};
  if(c.path==='/core/earnings/mine')return {list:[],groups:[],total:0,summary:{amount:'20.00',confirmedAmount:'15.00',pendingAmount:'5.00',internalAmount:'6.00'}};
  if(c.path.startsWith('/core/finance'))throw Error('Mini payment services have been removed');
  return {};
 });h.session(user);return {h,user};
}
test('wallet and withdrawal pages are absent from the mini package and denied for every role',()=>{
 for(const name of ['wallet','withdrawals']) {
  assert(!app.pages.includes('pages/'+name+'/index'));
  assert(!fs.existsSync(path.join(__dirname,'../miniprogram/pages',name,'index.js')));
  for(const role of roles)assert.equal(harness().load('utils/permissions').allowed(role,name),false);
 }
});
test('home, mine, income and tools still load for all roles without querying payment data',async()=>{
 for(const role of roles) {
  const {h,user}=setup(role);
  for(const name of ['home','mine','income','tools']) {
   const p=h.page(name);await p.onShow();assert.equal(p.data.error,'',role.role+':'+name);assert.equal(p.data.allowed,true);
   assert(!(p.data.menus||[]).some(m=>['wallet','withdrawals'].includes(m.key)));
   if(name==='home') {assert.equal(p.data.summary.keywordCount,12);assert.equal(p.data.summary.workCount,3);assert.equal(p.data.balance,undefined);}
   if(name==='income'&&['creator','leader'].includes(user.role)) {assert.equal(p.data.summary.receivable,'20.00');assert.equal(p.data.summary.confirmedReceivable,'15.00');assert.equal(p.data.summary.pendingReceivable,'5.00');}
   if(name==='mine'&&['creator','leader'].includes(user.role))assert(p.data.memberSummary.direct.total.includes('20.00'));
   if(name==='income'&&user.role==='leader')assert.equal(p.data.memberSummary.team.memberCount,4);
  }
  assert(!h.calls.some(c=>c.path.startsWith('/core/finance')));
  assert.equal(h.load('utils/auth').entryPath(user),'/pages/home/index');
 }
});
test('data query tool opens the existing earnings tab',async()=>{
 const {h}=setup({role:'creator'}),p=h.page('tools');await p.onShow();
 p.openTool({currentTarget:{dataset:{key:'income'}}});assert.equal(h.navigation.at(-1),'/pages/income/index');
 assert(!p.data.tools.some(t=>t.path&&/wallet|withdrawals/.test(t.path)));
});
test('active templates and mini agreements contain no withdrawal advertising or retired page links',()=>{
 for(const p of app.pages) {
  const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram',p+'.wxml'),'utf8');
  assert(!/提现|pages\/(wallet|withdrawals)\//.test(wxml),p);
 }
 const documents=require('../miniprogram/pages/agreement/documents.js');
 assert(!JSON.stringify(documents).includes('提现'));
 assert(JSON.stringify(documents).includes('本版本不提供钱包'));
});
