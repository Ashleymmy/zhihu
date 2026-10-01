const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {harness,scoped}=require('./harness.cjs');
const {createBridge}=require('../cloudfunctions/opc-bridge/bridge');
const secret='isolated_cloud_bridge_secret_long_enough';
test('cloud relay signs trusted identity and ignores caller destination',async()=>{
 let sent;const bridge=createBridge({context:()=>({APPID:'wx22b91776ccf37354',OPENID:'trusted_wechat_identity'}),secret,send:async(...args)=>{sent=args;return {code:0}}});
 await bridge({path:'/core/auth/wechat-login',method:'POST',openId:'forged',appId:'forged',url:'https://attacker.invalid',data:{}});
 const [url,raw,h]=sent;assert.equal(url,'https://timo.clouddo.cc/api/v1/mini/bridge');assert.equal(JSON.parse(raw).openId,'trusted_wechat_identity');assert.equal(JSON.parse(raw).appId,'wx22b91776ccf37354');
 assert.equal(h['X-Bridge-Signature'],crypto.createHmac('sha256',secret).update(h['X-Bridge-Time']+'\n'+h['X-Bridge-Nonce']+'\n'+raw).digest('hex'));
});
test('relay rejects foreign apps and never retries an uncertain write',async()=>{
 let writes=0;const send=async()=>{writes++;throw new Error('secret must not leak')};
 const denied=createBridge({context:()=>({APPID:'other',OPENID:'id'}),secret,send});assert.equal((await denied({path:'/core/projects'})).statusCode,403);assert.equal(writes,0);
 const bridge=createBridge({context:()=>({APPID:'wx22b91776ccf37354',OPENID:'trusted'}),secret,send});const result=await bridge({path:'/modules/zhihu/mini-works',method:'POST'});assert.equal(result.statusCode,502);assert.equal(writes,1);assert.ok(!result.message.includes('secret'));
});
test('role matrix preserves operator business access, developer access and finance isolation',()=>{
 const h=harness(),p=h.load('utils/permissions');assert.equal(p.allowed({role:'operator'},'team'),true);assert.equal(p.allowed({role:'operator'},'projects'),false);assert.equal(p.allowed({role:'operator'},'wallet'),false);assert.equal(p.allowed({role:'developer'},'projects'),true);assert.equal(p.allowed({role:'admin',adminDuty:'finance'},'invite'),false);assert.equal(p.allowed({role:'creator'},'invite'),true);assert.equal(h.load('config/env').functionName,'opc-bridge');
});
test('compositions carry canonical media account, category and zoned date',()=>{
 const c=harness().load('utils/composition'),v=c.input('8',{mediaAccount:'账号甲',url:'https://example.com/work',platformIndex:2,publishDate:'2026-10-01',workTypeIndex:1,contentTypeIndex:0});assert.equal(v.mediaAccount,'账号甲');assert.equal(v.mediaType,'KOC抖音');assert.equal(v.compositionType,2);assert.equal(v.compositionSubType,5);assert.equal(v.releaseTime,'2026-10-01T00:00:00+08:00');assert.throws(()=>c.input('8',c.blank()));
});
test('batch validates all rows before writing and retains keys after uncertain results',async()=>{
 let fail=true;const word={id:'1',planId:'8',bindingId:'11',executorId:'3',lifecycleStatus:'assigned',releaseStatus:'none',syncStatus:'synced'};
 const h=harness(c=>{const common=scoped(c);if(common!==undefined)return common;if(c.path.endsWith('/attribution-options'))return {tasks:[],mappings:[],users:[]};if(c.path.endsWith('/mini-works'))return fail&&c.data.promoUrl.endsWith('/2')?{networkError:'timeout'}:{id:'10'};return {list:[word],total:1}});
 h.session({id:'3',role:'creator'});const p=h.page('keywords');await p.onShow();p.choose({currentTarget:{dataset:{index:0,action:'work'}}});
 const row={mediaAccount:'账号甲',url:'https://example.com/1',platformIndex:2,publishDate:'2026-10-01',workTypeIndex:0,contentTypeIndex:0};
 p.setData({batchMode:true,batchItems:[row,{...row,url:'bad'}]});await p.runAction();assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
 p.setData({batchItems:[row,{...row,url:'https://example.com/2'}]});await p.runAction();assert.equal(h.calls.filter(c=>c.method==='POST').length,2);assert.ok(p.data.selected);
 fail=false;await p.runAction();const posts=h.calls.filter(c=>c.method==='POST');assert.equal(posts[0].data.requestKey,posts[2].data.requestKey);assert.equal(posts[1].data.requestKey,posts[3].data.requestKey);
});
test('leader project editor preserves memberships outside own scope',async()=>{
 const h=harness(c=>{if(c.path==='/core/team/members')return [{id:'3',role:'creator',displayName:'达人',isActive:1,canManage:true,canAssignProjects:true,projects:[{id:'9',name:'其他项目'}]}];if(c.path==='/core/team/applications')return [];if(c.path==='/core/projects')return [{id:'1',name:'我的项目',isEnabled:true}];return {}});
 h.session({id:'2',role:'leader'});const p=h.page('team');await p.onShow();p.manage({currentTarget:{dataset:{index:0}}});p.projectChange({detail:{value:['1']}});await p.saveMember();assert.deepEqual(Array.from(h.calls.find(c=>c.method==='PATCH').data.projectIds).sort(),['1','9']);
});
test('official rejection never becomes a platform manual approval action',async()=>{
 const h=harness(c=>scoped(c)??{list:[{id:'composition:1',source:'composition',compositionId:'1',status:'active',syncStatus:'synced',zhihuStatusJson:{audit_status:'rejected',reject_reason:'内容不符'}}],total:1});h.session({id:'1',role:'admin'});const p=h.page('works');await p.onShow();assert.equal(p.data.list[0].canReview,false);assert.equal(p.data.list[0].upstreamText,'知乎审核：已拒绝');assert.equal(p.data.list[0].upstreamReason,'内容不符');
});
