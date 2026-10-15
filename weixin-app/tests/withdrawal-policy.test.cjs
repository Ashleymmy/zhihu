const test=require('node:test'),assert=require('node:assert/strict');
const {harness,scoped}=require('./harness.cjs');
const policy={enabled:true,version:'2026-10-13-v1',lines:['10 元起提，每日 1 次','手续费 1%'],details:['全天可提交'],todayUsed:false};
const quoted={amount:'100.0000',feeAmount:'1.0000',netAmount:'99.0000',policyVersion:policy.version,quoteToken:'a'.repeat(64),tier:'small',reviewDeadline:'2026-10-16',settlementDeadline:'2026-10-16',invoiceRequired:false};
async function setup(options={}){
 const h=harness(c=>{const common=scoped(c);if(common!==undefined)return common;if(options.handle){const handled=options.handle(c);if(handled!==undefined)return handled;}if(c.path==='/core/finance/withdrawal-policy')return {...policy};if(c.path==='/core/finance/withdrawal-quote')return {...quoted};if(c.path==='/core/finance')return {balance:{available:'100.0099'},withdrawals:options.rows||[],total:0,canManage:!!options.staff,withdrawalPolicy:{...policy}};if(c.method==='POST')return {id:'1'};return {};});
 h.session(options.user||{id:'2',role:'creator'});const p=h.page('withdrawals');await p.onShow();return {h,p};
}
test('mini keeps balances and history but exposes no application or quote action for any member',async()=>{
 for(const role of ['creator','leader']) {
  const {h,p}=await setup({user:{id:'2',role},rows:[{id:'1',status:'pending',amount:'100',netAmount:'99',policyVersion:policy.version}]});
  assert.equal(p.data.error,'');assert.equal(p.data.view.balance.availableDisplay,'100.00');
  assert.equal(p.data.view.withdrawals[0].statusText,'待审核');
  assert.equal(typeof p.openApply,'undefined');assert.equal(typeof p.apply,'undefined');assert.equal(typeof p.previewAmount,'undefined');
  assert(!h.calls.some(c=>c.method==='POST'||c.path.endsWith('/withdrawal-quote')));
  p.choose({currentTarget:{dataset:{index:0,action:'cancel'}}});assert.equal(p.data.selected.id,'1');
 }
});

test('invoice actions belong to required leader records and creator payment is not blocked',async()=>{
 const {p}=await setup({staff:true,user:{id:'1',role:'admin',adminDuty:'finance'},rows:[{id:'1',status:'approved',amount:'600',netAmount:'594',invoiceRequired:0},{id:'2',status:'approved',amount:'600',netAmount:'594',invoiceRequired:1,invoiceStatus:'pending',invoiceVersion:1}]});assert.equal(p.data.view.withdrawals[0].canPay,true);assert.equal(p.data.view.withdrawals[1].canPay,false);p.invoice({currentTarget:{dataset:{index:0}}});assert.equal(p.data.invoiceItem,null);p.invoice({currentTarget:{dataset:{index:1}}});assert.equal(p.data.invoiceItem.id,'2');
});
test('operations cannot read finance or new withdrawal rules',async()=>{
 const {h,p}=await setup({user:{id:'4',role:'admin',adminDuty:'operations'}});assert.equal(p.data.denied,true);assert(!h.calls.some(c=>c.path.startsWith('/core/finance')));
});
