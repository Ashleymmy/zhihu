const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./harness.cjs');
function setup(role='creator') {
  const user={id:'20',role}, state={team:null,applications:[]};
  const leaders=Array.from({length:12},(_,i)=>({id:String(i+30),username:'leader'+i,displayName:'团长'+i,memberCount:i}));
  const h=harness(c=>{
    if(c.path==='/core/auth/me') return user;
    if(c.path==='/core/team/affiliation') return {team:state.team};
    if(c.path==='/core/team/leaders') return leaders;
    if(c.path==='/core/team/applications/mine') return state.applications;
    if(c.path==='/core/team/applications'&&c.method==='POST') {state.applications=[{id:'1',leaderName:'团长11',status:'pending'}];return{id:'1'}}
    if(c.path.endsWith('/cancel')) {state.applications=[{id:'1',leaderName:'团长11',status:'cancelled'}];return null}
    throw Error('Unexpected request '+c.path);
  });
  h.session(user);return {h,state,leaders,page:h.page('join-team')};
}
test('independent creator can find all leaders and apply without an authorized business project',async()=>{
  const {h,page}=setup();await page.onShow();
  assert.equal(page.data.filteredLeaders.length,12);
  page.searchLeader({detail:{value:'leader11'}});assert.equal(page.data.filteredLeaders.length,1);
  page.pickLeader({currentTarget:{dataset:{id:'41'}}});
  await page.apply();
  assert.equal(h.calls.find(c=>c.method==='POST').data.leaderUsername,'leader11');
  assert.equal(page.data.pending.status,'pending');
  assert.equal(h.calls.some(c=>c.path==='/core/projects'),false);
  await page.apply();assert.equal(h.calls.filter(c=>c.path==='/core/team/applications').length,1);
});
test('withdrawal allows selecting a different leader; approved affiliation hides application',async()=>{
  const {page,state}=setup();state.applications=[{id:'1',status:'pending',leaderName:'原团长'}];
  await page.onShow();await page.cancel();assert.equal(page.data.pending,null);
  state.team={leaderName:'新团长'};await page.onShow();assert.equal(page.data.affiliation.team.leaderName,'新团长');
});
test('leaders do not receive the creator join page or send its APIs',async()=>{
  const {h,page}=setup('leader');await page.onShow();
  assert.equal(page.data.denied,true);assert.equal(h.calls.some(c=>c.path.startsWith('/core/team')),false);
});
test('leaving the page prevents submitting a stale choice',async()=>{
  const {h,page}=setup();await page.onShow();page.pickLeader({currentTarget:{dataset:{id:'30'}}});
  page.onHide();await page.apply();assert.equal(h.calls.some(c=>c.method==='POST'),false);
});
