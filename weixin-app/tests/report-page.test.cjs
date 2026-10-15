const test=require('node:test'),assert=require('node:assert/strict');const {harness,scoped}=require('./harness.cjs');
test('report page reads both metric types, analysis and filtered problems without legacy uploads',async()=>{
 const h=harness(c=>scoped(c)??(c.path.endsWith('/analysis')?{steps:[{key:'read',title:'读取',summary:'已读取'}],conclusion:{title:'拉活',value:'5 个'}}:{list:[{id:'1',reportKind:'activation',status:'committed',jobStatus:'completed'}],total:1}));h.session({id:'1',role:'admin',adminDuty:'finance'});const p=h.page('reports');await p.onShow();assert.equal(p.data.list[0].typeText,'拉活');assert.equal(p.data.list[0].statusText,'处理完成');await p.inspect({currentTarget:{dataset:{id:'1'}}});assert.equal(p.data.detail.steps[0].summary,'已读取');await p.section({currentTarget:{dataset:{section:'exceptions'}}});assert.equal(h.calls.at(-1).data.status,'open');assert.equal(typeof p.uploadReport,'undefined');assert.equal(typeof p.resolve,'undefined');assert(!h.calls.some(c=>c.method==='POST'));
});

test('already read reports do not regress to waiting for a lagging job, but active failures remain visible',async()=>{
 const h=harness(c=>scoped(c)??{list:[{id:'1',status:'processed',jobStatus:'pending'},{id:'2',status:'processed',jobStatus:'failed'}],total:2});
 h.session({id:'1',role:'admin',adminDuty:'finance'});const p=h.page('reports');await p.onShow();
 assert.equal(p.data.list[0].statusText,'已读取');assert.equal(p.data.list[1].statusText,'处理失败');
});
