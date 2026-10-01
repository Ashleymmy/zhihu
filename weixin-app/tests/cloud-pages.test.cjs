const test=require('node:test')
const assert=require('node:assert/strict')
const {harness,scoped,deferred}=require('./harness.cjs')
function setup(role='finance') {
  const user={id:'4',role:'admin',adminDuty:role}
  const h=harness(c=>{
    if(c.path==='/core/auth/me')return user
    const common=scoped(c);if(common!==undefined)return common
    if(c.path==='/modules/zhihu/imports')return {list:[],total:0}
    if(c.path==='/core/finance')return {canManage:true,total:1,withdrawals:[{id:'80',status:'approved',amount:'5.00'}]}
    return {id:'ok'}
  })
  h.session(user)
  return h
}
test('report tools allow finance but deny operations, leaders and creators without data calls',async()=>{
  for(const user of [{role:'admin',adminDuty:'operations'},{role:'leader'},{role:'creator'}]){
    const h=harness(c=>c.path==='/core/auth/me'?{id:'7',...user}:scoped(c))
    h.session({id:'7',...user});const page=h.page('reports');await page.onShow()
    assert.equal(page.data.denied,true)
    assert.equal(h.calls.some(c=>c.path.includes('/imports')),false)
  }
  const h=setup(),page=h.page('reports');await page.onShow();assert.equal(page.data.allowed,true)
})
test('report commit requires preview acknowledgement and preserves exact scope and preview hash',async()=>{
  const h=setup(),page=h.page('reports');await page.onShow()
  page.setData({detail:{id:'import-id',previewHash:'reviewed-hash'},acknowledged:false})
  await page.commit();assert.equal(h.calls.some(c=>c.path.endsWith('/commit')),false)
  page.setData({acknowledged:true});await page.commit()
  const call=h.calls.find(c=>c.path.endsWith('/commit'))
  assert.equal(call.data.previewHash,'reviewed-hash');assert.equal(call.data.projectId,'1');assert.equal(call.data.accountId,'10');assert.ok(call.data.requestKey)
})
test('payment UI requires proof and acknowledgement before registration',async()=>{
  const h=setup(),page=h.page('withdrawals');await page.onShow();page.pay({currentTarget:{dataset:{index:0}}})
  page.setData({'paymentForm.reference':'bank-001'});await page.recordPayment()
  assert.equal(h.calls.some(c=>c.path.endsWith('/pay')),false)
  page.setData({proofFileId:'100','paymentForm.acknowledged':true});await page.recordPayment()
  const call=h.calls.find(c=>c.path.endsWith('/pay'))
  assert.equal(call.data.fileId,'100');assert.equal(call.data.acknowledged,true);assert.ok(call.data.requestKey)
})
test('file selection interrupted by context change never prepares or uploads a file',async()=>{
  const h=setup(),choice=deferred();h.wx.chooseMessageFile=()=>choice.promise
  let active=true,uploaded=false;h.wx.cloud.uploadFile=async()=>{uploaded=true}
  const pending=h.load('utils/upload').upload({projectId:'1',accountId:'10'},'report',()=>active)
  active=false;choice.resolve({tempFiles:[{name:'report.xlsx',size:10,path:'local'}]})
  await assert.rejects(pending,/页面或项目已变化/)
  assert.equal(uploaded,false);assert.equal(h.calls.length,0)
})
