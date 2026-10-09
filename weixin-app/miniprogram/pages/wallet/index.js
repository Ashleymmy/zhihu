const screen=require('../../utils/screen');
const request=require('../../utils/request');
const actions=require('../../utils/actions');
const permissions=require('../../utils/permissions');
const amount=require('../../utils/amount');
const web=require('../../utils/web-link');
Page(screen('wallet',{
  pageSize:25,
  data:{view:null,report:null,from:actions.today().slice(0,8)+'01',to:actions.today(),fundingAcknowledged:false,reference:'',visibleEntries:[],detail:null},
  async fetch({scope,user}){
    if(this.data.from>this.data.to)throw new Error('开始日期不能晚于结束日期');
    const period={from:this.data.from,to:this.data.to},staff=permissions.isAdmin(user);
    const [report,view]=await Promise.all([
      request.get(staff?'/core/finance/workspace/entries':'/core/earnings/mine',{...scope,...period,...(staff?{moduleId:'zhihu'}:{}),page:this.data.page,...(staff?{}:{pageSize:25})}),
      request.get('/core/finance',{...scope,moduleId:'zhihu',page:1})]);
    if(view.balance)for(const k of ['available','held','processing','paid','offset'])view.balance[k]=amount.money(view.balance[k]);
    if(view.funding)view.funding.amount=amount.money(view.funding.amount);
    const summary=staff?{confirmed:amount.money(report.amount),pending:null}: {confirmed:amount.money(report.summary.confirmedAmount),pending:amount.money(report.summary.pendingAmount)};
    const entries=report.list.map(e=>({...e,amountText:amount.label(e.amount),priceText:amount.price(e.unitPrice),confirmedText:amount.label(e.confirmedAmount),pendingText:amount.label(e.pendingAmount),
      statusText:staff?'已确认':Number(e.isReady)!==1?'待核对':e.confirmedAt?(amount.units(e.pendingAmount)!==BigInt(0)?'差额待确认':'已确认'):'待确认'}));
    return {view,report:{summary},visibleEntries:entries,total:report.total,fundingAcknowledged:false,detail:null};
  },
  dateChange(e){if(this.data.busy)return;this.setData({[e.currentTarget.dataset.name]:e.detail.value,report:null,view:null,page:1,fundingAcknowledged:false});return this.load();},
  acknowledgeFunding(e){this.setData({fundingAcknowledged:e.detail.value.includes('yes')});},
  inspect(e){if(this.canAct())this.setData({detail:this.data.visibleEntries.find(x=>String(x.id)===String(e.currentTarget.dataset.id))||null});},
  web(){web.copy(this,'finance',{from:this.data.from,to:this.data.to});},
  async releaseFunding(){
    if(await this.action(async({user,scope})=>{
      if(!permissions.canFinance(user)||!permissions.isAdmin(user)||!this.data.view?.canManage||!this.data.fundingAcknowledged||!this.data.reference.trim())throw new Error('请核对待开放总额并填写到账凭据');
      await actions.post(this,'/core/finance/funding',{...scope,moduleId:'zhihu',hash:this.data.view.funding.hash,reference:this.data.reference.trim()});
    },'已核对的款项已开放提现')){this.setData({reference:''});await this.load();}
  },
}));
