const test = require('node:test');
const assert = require('node:assert/strict');
const {harness} = require('./harness.cjs');
const fields={phone:'13900001234',password:'Sms_test_123',inviteCode:'ABCDEFGH',agreed:true};
function setup(overrides={}) {
 return harness(call=>{
  if(overrides[call.path]) return overrides[call.path](call);
  if(call.path==='/core/auth/registration-policy') return {smsRequired:true};
  if(call.path==='/core/auth/registration-code') return {retryAfterSeconds:60,expiresInSeconds:300};
  if(call.path==='/core/auth/register')return {token:'sms_test_token'};
  if(call.path==='/core/auth/me')return {id:'1',role:'creator',phoneVerifiedAt:'2026-10-01T00:00:00Z'};
  return {};
 });
}
test('loads server policy, preserves hidden invitation and refuses registration without six digits',async()=>{
 const h=setup(),p=h.page('register');await p.onLoad({code:'abcdefgh'});p.setData(fields);
 assert.equal(p.data.smsRequired,true);assert.equal(p.data.inviteCode,'ABCDEFGH');
 assert.equal(h.calls.find(c=>c.path.endsWith('/registration-policy')).data.inviteCode,'ABCDEFGH');
 await p.submit();assert.match(p.data.error,/6 位/);assert.equal(h.calls.filter(c=>c.path.endsWith('/register')).length,0);
 p.setData({smsCode:'123456'});await p.submit();const sent=h.calls.find(c=>c.path.endsWith('/register'));assert.equal(sent.data.smsCode,'123456');assert.equal(sent.data.inviteCode,'ABCDEFGH');assert.ok(h.navigation.includes('/pages/home/index'));
});
test('cannot silently bypass policy on network failure; retry can recover',async()=>{
 let failed=true;const h=setup({'/core/auth/registration-policy':()=>failed?{http:503,body:{code:50320,message:'稍后重试'}}:{smsRequired:false}}),p=h.page('register');
 await p.onLoad();p.setData(fields);await p.submit();assert.equal(p.data.policyReady,false);assert.equal(h.calls.filter(c=>c.path.endsWith('/register')).length,0);
 failed=false;await p.loadPolicy();await p.submit();assert.equal(h.calls.find(c=>c.path.endsWith('/register')).data.smsCode,undefined);
});
test('requires consent and valid invite before sending; repeated taps send only once',async()=>{
 const h=setup(),p=h.page('register');await p.onLoad();p.setData({...fields,agreed:false});await p.sendCode();assert.match(p.data.error,/同意/);
 p.setData({agreed:true,inviteCode:''});await p.sendCode();assert.match(p.data.error,/邀请码/);
 p.setData({inviteCode:'abcdefgh'});await Promise.all([p.sendCode(),p.sendCode()]);assert.equal(h.calls.filter(c=>c.path.endsWith('/registration-code')).length,1);assert.equal(p.data.cooldown,60);assert.match(p.data.codeNotice,/已发送/);
 await p.sendCode();assert.equal(h.calls.filter(c=>c.path.endsWith('/registration-code')).length,1);p.onUnload();
});
test('changing phone clears code; hiding and reopening does not reset cooldown',async()=>{
 const h=setup(),p=h.page('register');await p.onLoad();p.setData(fields);await p.sendCode();p.setData({smsCode:'123456'});
 p.input({currentTarget:{dataset:{name:'phone'}},detail:{value:'13900001235'}});assert.equal(p.data.smsCode,'');assert.equal(p.data.codeNotice,'');p.onHide();p.onShow();assert.ok(p.data.cooldown>0);
 p._retryAt=Date.now()-1;p.onShow();assert.equal(p.data.cooldown,0);p.onUnload();
});
test('provider failure never displays sent notice or starts success countdown',async()=>{
 const h=setup({'/core/auth/registration-code':()=>({http:503,body:{code:50321,message:'短信暂时无法发送，请稍后再试'}})}),p=h.page('register');await p.onLoad();p.setData(fields);await p.sendCode();assert.equal(p.data.sendingCode,false);assert.equal(p.data.cooldown,0);assert.equal(p.data.codeNotice,'');assert.match(p.data.error,/无法发送/);
});
test('server enabling SMS after page load refreshes policy instead of falling back',async()=>{
 let enabled=false;const h=setup({'/core/auth/registration-policy':()=>({smsRequired:enabled}),'/core/auth/register':()=>{enabled=true;return {http:422,body:{code:42220,message:'请填写短信验证码'}}}}),p=h.page('register');await p.onLoad();p.setData(fields);await p.submit();assert.equal(p.data.smsRequired,true);assert.match(p.data.error,/验证码/);assert.equal(h.navigation.length,0);
});
test('changing invitation reloads its policy and ignores a stale response',async()=>{
 let releaseOld;
 const h=setup({'/core/auth/registration-policy':call=>call.data.inviteCode==='ABCDEFGH'
   ? new Promise(resolve=>{releaseOld=resolve}) : {smsRequired:false}}),p=h.page('register');
 await p.onLoad();
 p.setData({smsCode:'123456',codeNotice:'old notice'});
 const first=p.input({currentTarget:{dataset:{name:'inviteCode'}},detail:{value:'ABCDEFGH'}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(p.data.policyReady,false);assert.equal(p.data.smsCode,'');
 await p.input({currentTarget:{dataset:{name:'inviteCode'}},detail:{value:'JKLMNPQR'}});
 assert.equal(p.data.smsRequired,false);assert.equal(p.data.policyReady,true);
 releaseOld({smsRequired:true});await first;
 assert.equal(p.data.smsRequired,false);assert.equal(p.data.policyLoading,false);
});
