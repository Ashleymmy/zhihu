const test = require('node:test');
const assert = require('node:assert/strict');
const {harness,scoped} = require('./harness.cjs');
const periods = {total:'1200.1234',today:'10.0050',yesterday:'0.0000'};
const summary = {businessDate:'2026-10-12',direct:periods,team:{memberCount:12,reward:{total:'33.1200',today:'1.0000',yesterday:'2.0000'},turnover:{...periods,records:{total:4,today:1,yesterday:0},missing:{total:0,today:0,yesterday:0}}}};
function setup(user, response=()=>summary) {
  const h=harness(call=>{
    const common=scoped(call);if(common!==undefined)return common;
    if(call.path==='/core/member-summary')return response();
    if(['/core/team/members','/core/team/applications','/core/projects'].includes(call.path))return [];
    if(call.path==='/modules/zhihu/invite/me')return {code:'ABCD1234',usageCount:4};
    if(call.path==='/modules/zhihu/invite/rewards')return {records:[]};
    return {};
  });h.session(user);return h;
}
test('leader team/invite share one summary; mine separates own promotion income and preserves private share cover',async()=>{
  const h=setup({id:'2',role:'leader'});
  for(const name of ['team','invite','mine']) {
    const page=h.page(name);await page.onShow();
    assert.equal(page.data.error,'');assert.equal(page.data.summaryError,'');
    assert.equal(page.data.memberSummary.direct.total,'¥1200.12');
    assert.equal(page.data.memberSummary.direct.today,'¥10.01');
    assert.equal(page.data.memberSummary.team.reward.total,'¥33.12');
    assert.equal(page.data.memberSummary.team.memberCount,12);
    if(name==='invite') {
      const share=page.onShareAppMessage();
      assert.equal(share.imageUrl,'/images/share/timo-intro.png');
      assert.doesNotMatch(JSON.stringify(share),/1200|33\.12|收益/);
    }
  }
});
test('creator and independent creators see only own earnings; staff/guest never request summary',async()=>{
  for(const parentId of [null,'2']) {
    const h=setup({id:'3',role:'creator',parentId},()=>({...summary,team:null}));
    const page=h.page('mine');await page.onShow();
    assert.equal(page.data.memberSummary.direct.total,'¥1200.12');assert.equal(page.data.memberSummary.team,undefined);
    const invite=h.page('invite');await invite.onShow();assert.equal(invite.data.memberSummary,null);
  }
  for(const user of [null,{id:'1',role:'admin',adminDuty:'all'},{id:'4',role:'admin',adminDuty:'operations'},{id:'5',role:'admin',adminDuty:'finance'}]) {
    const h=setup(user);const page=h.page('mine');await page.onShow();
    assert.equal(h.calls.filter(c=>c.path==='/core/member-summary').length,0);
    assert.equal(page.data.memberSummary,null);
  }
});
test('failed refresh removes stale amounts without breaking menus; retry restores real zero',async()=>{
  let fail=false;
  const h=setup({id:'3',role:'creator'},()=>fail?{http:503,body:{message:'暂不可用'}}:{direct:{total:'0.0000',today:'0.0000',yesterday:'0.0000'},team:null});
  const page=h.page('mine');await page.onShow();assert.equal(page.data.memberSummary.direct.total,'¥0.00');
  fail=true;await page.load();assert.equal(page.data.memberSummary,null);assert.match(page.data.summaryError,/重试/);
  assert.ok(page.data.menus.length>0);assert.equal(page.canAct(),true);
  fail=false;await page.load();assert.equal(page.data.summaryError,'');assert.equal(page.data.memberSummary.direct.total,'¥0.00');
});
test('missing upstream amounts show incomplete totals instead of a misleading zero; large money stays exact',async()=>{
  const data=structuredClone(summary);data.direct.total='9007199254740993.1250';
  data.team.turnover.missing={total:2,today:1,yesterday:0};
  const h=setup({id:'2',role:'leader'},()=>data);const page=h.page('team');await page.onShow();
  assert.equal(page.data.memberSummary.direct.total,'¥9007199254740993.13');
  assert.equal(page.data.memberSummary.team.turnover.total,'¥1200.12（已统计）');
  assert.equal(page.data.memberSummary.team.turnover.today,'待补充');
  assert.match(page.data.memberSummary.team.turnover.note,/2 条/);
});
