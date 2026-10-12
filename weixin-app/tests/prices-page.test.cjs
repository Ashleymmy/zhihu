const test=require('node:test'),assert=require('node:assert/strict');
const {harness,scoped}=require('./harness.cjs');
const data={businessDate:'2026-10-09',metrics:[{code:'activation',label:'拉活',unit:'个',rules:[{code:'creator',label:'达人'}]}],versions:[{id:'1',metricType:'activation',ruleCode:'creator',unitPrice:'1.2345',effectiveFrom:'2026-10-01',effectiveTo:'2026-10-10'},{id:'2',metricType:'activation',ruleCode:'creator',unitPrice:'1.6000',effectiveFrom:'2026-10-10',effectiveTo:null}]};
test('finance reads effective type rules without old pricing writes',async()=>{const h=harness(c=>scoped(c)??data);h.session({id:'1',role:'admin',adminDuty:'finance'});const p=h.page('prices');await p.onShow();assert.equal(p.data.error,'');assert.equal(p.data.metrics[0].versions[0].state,'当前有效');assert.equal(p.data.metrics[0].versions[1].state,'待生效');assert.equal(p.data.metrics[0].versions[0].unitPrice,'1.2345');assert.equal(typeof p.create,'undefined');assert(h.calls.some(c=>c.path==='/core/rates'));});
test('members cannot enter pricing from an old route or request pricing data', async () => {
  for (const user of [
    { id: '2', role: 'creator', parentId: null },
    { id: '3', role: 'creator', parentId: '4' },
    { id: '4', role: 'leader' },
  ]) {
    const h = harness();
    h.session(user);
    const page = h.page('prices');
    let copied = false;
    h.wx.setClipboardData = () => { copied = true; };
    await page.onShow();
    assert.equal(page.data.allowed, false);
    assert.equal(page.data.denied, true);
    assert.equal(page.canAct(), false);
    await page.load();
    page.web();
    assert.equal(copied, false);
    assert.equal(h.calls.length, 0, 'Denied routes must not fetch rules or member tasks');
    page.home();
    assert.equal(h.navigation.at(-1), '/pages/home/index');
  }
});
test('full administrators and developers retain pricing access', async () => {
  for (const user of [
    { id: '1', role: 'admin', adminDuty: 'all' },
    { id: '1', role: 'admin' },
    { id: '2', role: 'developer', adminDuty: 'all' },
  ]) {
    const h = harness(c => scoped(c) ?? data);
    h.session(user);
    const page = h.page('prices');
    await page.onShow();
    assert.equal(page.data.allowed, true);
    assert.equal(page.data.error, '');
    assert(h.calls.some(c => c.path === '/core/rates'));
    assert(!h.calls.some(c => c.path === '/core/tasks'));
  }
});
test('operations never request prices even via a direct page route',async()=>{const h=harness();h.session({id:'1',role:'admin',adminDuty:'operations'});const p=h.page('prices');await p.onShow();assert.equal(p.data.denied,true);assert(!h.calls.some(c=>c.path.includes('/rates')||c.path.includes('/tasks')));});
