const test=require('node:test'),assert=require('node:assert/strict');
const {harness,scoped}=require('./harness.cjs');
const policy={enabled:true,version:'2026-10-21-v2',lines:['不设最低起提金额，不限申请次数','手续费 1%'],details:['全天可提交'],dailyAmountLimit:'100.0000',todayAmount:'0.0000',remainingAmount:'100.0000'};
const quoted={amount:'100.0000',feeAmount:'1.0000',netAmount:'99.0000',policyVersion:policy.version,quoteToken:'a'.repeat(64),tier:'small',reviewDeadline:'2026-10-16',settlementDeadline:'2026-10-16',invoiceRequired:false};
async function setup(options={}){
 const h=harness(c=>{const common=scoped(c);if(common!==undefined)return common;if(options.handle){const handled=options.handle(c);if(handled!==undefined)return handled;}if(c.path==='/core/finance/withdrawal-policy')return {...policy};if(c.path==='/core/finance/withdrawal-quote')return {...quoted};if(c.path==='/core/finance')return {balance:{available:'100.0099'},withdrawals:options.rows||[],total:0,canManage:!!options.staff,withdrawalPolicy:{...policy}};if(c.method==='POST')return {id:'1'};return {};});
 h.session(options.user||{id:'2',role:'creator'});const p=h.page('withdrawals');await p.onShow();return {h,p};
}
const fill=p=>p.setData({form:{amount:'100',receiverName:'测试',bankName:'银行',bankAccount:'TEST ONLY'}});
test('withdrawal previews server fee/net and requires explicit confirmation before posting',async()=>{
 const {h,p}=await setup();assert.equal(p.data.error,'');p.openApply();fill(p);await p.apply();assert.equal(p.data.quote.netAmount,'99.00');assert(!h.calls.some(c=>c.method==='POST'));await p.apply();assert.match(p.data.error,/核对/);assert(!h.calls.some(c=>c.method==='POST'));p.acceptRules({detail:{value:['yes']}});await p.apply();const call=h.calls.find(c=>c.method==='POST');assert.equal(call.data.quoteToken,quoted.quoteToken);assert.equal(call.data.policyVersion,policy.version);assert.equal(call.data.amount,'100');
});
test('all-withdraw floors fractional cents and editing invalidates the quote and consent',async()=>{
 const {p}=await setup();p.openApply();p.fillAll();assert.equal(p.data.form.amount,'100.00');await p.apply();p.acceptRules({detail:{value:['yes']}});p.amountInput({detail:{value:'500'}});assert.equal(p.data.quote,null);assert.equal(p.data.rulesAccepted,false);
});
test('uncertain submission retries the same request key and does not silently refresh its terms',async()=>{
 let attempts=0;const {h,p}=await setup({handle:c=>{if(c.method==='POST'&&c.path==='/core/finance/withdrawals'){attempts++;if(attempts===1)return {networkError:'timeout'};return {id:'1'};}}});p.openApply();fill(p);await p.apply();p.acceptRules({detail:{value:['yes']}});await p.apply();assert(p.data.error);await p.apply();const posts=h.calls.filter(c=>c.path==='/core/finance/withdrawals'&&c.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].data.requestKey,posts[1].data.requestKey);assert.equal(posts[0].data.quoteToken,posts[1].data.quoteToken);
});
test('server quote failure preserves rules and allows an in-place retry',async()=>{
 let fail=true;const {p}=await setup({handle:c=>c.path==='/core/finance/withdrawal-quote'&&fail?{http:422,body:{code:42200,message:'今日剩余可申请额度为 40.00 元'}}:undefined});p.openApply();fill(p);await p.apply();assert.equal(p.data.quote,null);assert.match(p.data.error,/40.00 元/);assert.equal(p.data.policy.lines.length,2);fail=false;await p.apply();assert.equal(p.data.quote.netAmount,'99.00');
});
test('invoice actions belong to required leader records and creator payment is not blocked',async()=>{
 const {p}=await setup({staff:true,user:{id:'1',role:'admin',adminDuty:'finance'},rows:[{id:'1',status:'approved',amount:'600',netAmount:'594',invoiceRequired:0},{id:'2',status:'approved',amount:'600',netAmount:'594',invoiceRequired:1,invoiceStatus:'pending',invoiceVersion:1}]});assert.equal(p.data.view.withdrawals[0].canPay,true);assert.equal(p.data.view.withdrawals[1].canPay,false);p.invoice({currentTarget:{dataset:{index:0}}});assert.equal(p.data.invoiceItem,null);p.invoice({currentTarget:{dataset:{index:1}}});assert.equal(p.data.invoiceItem.id,'2');
});
test('operations cannot read finance or new withdrawal rules',async()=>{
 const {h,p}=await setup({user:{id:'4',role:'admin',adminDuty:'operations'}});assert.equal(p.data.denied,true);assert(!h.calls.some(c=>c.path.startsWith('/core/finance')));
});
test('a changed rule clears the old quote and requires confirmation again in the same form',async()=>{
 const {p}=await setup({handle:c=>c.method==='POST'&&c.path==='/core/finance/withdrawals'?{http:409,body:{code:40910,message:'提现规则已更新'}}:undefined});
 p.openApply();fill(p);await p.apply();p.acceptRules({detail:{value:['yes']}});await p.apply();assert(p.data.applyOpen);assert.equal(p.data.quote,null);assert.equal(p.data.rulesAccepted,false);assert.match(p.data.error,/重新核对/);await p.apply();assert.equal(p.data.quote.netAmount,'99.00');assert.equal(p.data.rulesAccepted,false);
});

test('fill available uses the smaller balance and account-wide daily allowance',async()=>{
 const {p}=await setup({handle:c=>c.path==='/core/finance'?{balance:{available:'1000.9999'},withdrawals:[],total:0,canManage:false,withdrawalPolicy:{...policy,todayAmount:'60.0000',remainingAmount:'40.0000'}}:undefined});
 p.openApply();p.fillAll();assert.equal(p.data.form.amount,'40.00');assert.equal(p.data.view.canWithdraw,true);
});
test('no arbitrary minimum or fixed count remains and zero daily allowance disables applying',async()=>{
 const make=remaining=>setup({handle:c=>c.path==='/core/finance'?{balance:{available:'0.0100'},withdrawals:[],total:0,canManage:false,withdrawalPolicy:{...policy,todayAmount:'99.9900',remainingAmount:remaining}}:undefined});
 const {p}=await make('0.0100');assert.equal(p.data.view.canWithdraw,true);p.fillAll();assert.equal(p.data.form.amount,'0.01');
 const exhausted=(await make('0.0000')).p;assert.equal(exhausted.data.view.canWithdraw,false);exhausted.openApply();assert.equal(exhausted.data.applyOpen,false);
});
test('status sync reads Web decisions and pauses while hidden or editing, then reloads on return',async()=>{
 let status='pending',remark='';
 const {h,p}=await setup({handle:c=>c.path==='/core/finance'?{balance:{available:'90.00'},withdrawals:[{id:'1',userId:'2',amount:'10',netAmount:'9.90',status,remark}],total:1,canManage:false,withdrawalPolicy:{...policy}}:undefined});
 assert.equal(p.data.view.withdrawals[0].statusText,'待审核');
 status='approved';await p.syncStatus();assert.equal(p.data.view.withdrawals[0].statusText,'审核通过，待打款');
 p.openApply();status='paid';await p.syncStatus();assert.equal(p.data.view.withdrawals[0].status,'approved');p.close();await p.syncStatus();assert.equal(p.data.view.withdrawals[0].statusText,'已打款');
 p.onHide();const count=h.calls.length;status='rejected';remark='收款信息需要核对';await p.syncStatus();assert.equal(h.calls.length,count);assert.equal(p._syncTimer,null);
 await p.onShow();assert.equal(p.data.view.withdrawals[0].remark,remark);assert.equal(p.data.view.withdrawals[0].statusText,'已退回');p.onUnload();assert.equal(p._syncTimer,null);
});
