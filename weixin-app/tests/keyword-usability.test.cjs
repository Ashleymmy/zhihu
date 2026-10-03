const test=require('node:test');
const assert=require('node:assert/strict');
const {harness,scoped}=require('./harness.cjs');
const leader={id:'2',role:'leader'},creator={id:'3',role:'creator'};
const options={tasks:[],users:[],hasTeamLeader:true};
test('failed, queued and stopped words never expose assign or work actions; failure overrides used label',()=>{
 const k=harness().load('utils/keyword-actions');
 for(const lifecycleStatus of ['reserved','assigned','active']) for(const syncStatus of ['local','syncing','failed']) {
  const item={id:'1',bindingId:'1',leaderId:'2',executorId:'3',lifecycleStatus,syncStatus,usageReady:0,planStatus:'pending'};
  for(const user of [leader,creator]){const d=k.decorate(user,item,options);assert(!d.actions.some(a=>['assign','work','claim','distribute'].includes(a.key)));if(syncStatus==='failed')assert.match(d.statusText,/知乎创建失败/)}
 }
 const usable={bindingId:'1',leaderId:'2',executorId:'3',lifecycleStatus:'assigned',syncStatus:'synced',usageReady:1};
 assert(k.flags(leader,usable).includes('assign'));assert(k.flags(creator,usable).includes('work'));
 assert(!k.flags(leader,{...usable,hasUsageHistory:1}).includes('assign'));
 assert(!k.flags(creator,{...usable,usageReady:0}).includes('work'));
});
test('pool actions require server eligibility and reject historical use',()=>{
 const k=harness().load('utils/keyword-actions');
 const word={lifecycleStatus:'available',syncStatus:'synced',planStatus:'active',allocationReady:1};
 assert(k.flags(leader,word).includes('claim'));
 for(const denied of [{allocationReady:0},{hasUsageHistory:1},{bindingId:'9'}]) assert(!k.flags(leader,{...word,...denied}).includes('claim'));
});
test('correction actions follow backend ownership and preserve history restrictions',()=>{
 const k=harness().load('utils/keyword-actions');
 const editable={syncStatus:'failed',canEditFailed:1,canDeleteFailed:1};
 assert.deepEqual(Array.from(k.flags(leader,editable)),['edit-retry','delete']);
 const used={...editable,canEditFailed:0,canCopyFailed:1,hasUsageHistory:1,readOnly:1};
 assert.deepEqual(Array.from(k.flags(leader,used)),['copy-retry','delete']);
 assert.deepEqual(Array.from(k.flags(creator,{...used,canCopyFailed:0,canDeleteFailed:0})),[]);
});
test('failed word editor prefills all creation fields and allows changing each one',async()=>{
 const opts={tasks:[{id:'1',name:'原任务'},{id:'2',name:'新任务'}],users:[],mappings:[{id:'10',channelName:'原渠道'},{id:'11',channelName:'新渠道'}]};
 const h=harness(call=>scoped(call)??(call.path.endsWith('/attribution-options')?opts:{list:[{id:'7',keyword:'旧词',taskId:'1',mappingId:'10',landingUrl:'https://example.com/old',syncStatus:'failed',canEditFailed:1,canDeleteFailed:1}],total:1}));
 h.session(leader);const p=h.page('keywords');await p.onShow();
 p.choose({currentTarget:{dataset:{index:0,action:'edit-retry'}}});
 assert.equal(p.data.editKeyword,'旧词');assert.equal(p.data.editTaskIndex,0);assert.equal(p.data.editMappingIndex,0);assert.equal(p.data.editLandingUrl,'https://example.com/old');
 p.setData({editKeyword:'新词',editTaskIndex:1,editMappingIndex:1,editLandingUrl:'https://example.com/new'});await p.runAction();
 const request=h.calls.find(c=>c.method==='POST');assert.equal(request.path,'/modules/zhihu/keywords/7/edit-retry');assert.equal(request.data.keyword,'新词');assert.equal(request.data.taskId,'2');assert.equal(request.data.mappingId,'11');assert.equal(request.data.landingUrl,'https://example.com/new');
});
test('work card explains keyword rejection without falsely suggesting a pending official review',async()=>{
 const h=harness(call=>scoped(call)??{list:[{id:'1',source:'evidence',status:'pending',compositionId:'1',syncStatus:'failed',planSyncStatus:'failed',failureReason:'关键词不符合知乎规则，请更换关键词'}],total:1});
 h.session(creator);const page=h.page('works');await page.onShow();
 assert.match(page.data.list[0].upstreamText,/关键词创建失败/);assert.match(page.data.list[0].upstreamReason,/更换关键词/);
});
