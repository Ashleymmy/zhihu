const screen=require('../../utils/screen');
const request=require('../../utils/request');
const actions=require('../../utils/actions');
const permissions=require('../../utils/permissions');
const fmt=v=>Number(v||0).toFixed(2);
Page(screen('wallet',{
  data:{view:null,report:null,from:actions.today().slice(0,8)+'01',to:actions.today(),acknowledged:false,fundingAcknowledged:false,reference:'',groupId:'',visibleEntries:[]},
  async fetch({scope}){
    if(this.data.from>this.data.to)throw new Error('开始日期不能晚于结束日期');
    const period={from:this.data.from,to:this.data.to};
    const [report,view]=await Promise.all([request.get('/modules/zhihu/workbench',{...scope,...period}),request.get('/core/finance',{...scope,moduleId:'zhihu',page:1})]);
    this._reportPeriod=period;
    if(view.balance)for(const k of ['available','held','processing','paid','offset'])view.balance[k]=fmt(view.balance[k]);
    if(view.funding)view.funding.amount=fmt(view.funding.amount);
    for(const k of ['receivable','confirmedReceivable','pendingReceivable','payable','confirmedPayable','pendingPayable'])report.summary[k]=fmt(report.summary[k]);
    report.entries=report.entries.map(e=>({...e,amount:fmt(e.amount)}));
    report.groups=report.groups.map(g=>({...g,total:fmt(g.total),confirmed:fmt(g.confirmed),pending:fmt(g.pending)}));
    return {view,report,visibleEntries:report.entries,acknowledged:false,fundingAcknowledged:false,groupId:'',readyCount:new Set(report.entries.filter(e=>e.ready).map(e=>e.factId)).size};
  },
  dateChange(e){if(this.data.busy)return;this.setData({[e.currentTarget.dataset.name]:e.detail.value,report:null,view:null,acknowledged:false,fundingAcknowledged:false});return this.load();},
  acknowledge(e){this.setData({acknowledged:e.detail.value.includes('yes')});},
  acknowledgeFunding(e){this.setData({fundingAcknowledged:e.detail.value.includes('yes')});},
  group(e){const id=e.currentTarget.dataset.id||'';this.setData({groupId:id,visibleEntries:this.data.report.entries.filter(row=>!id||String(row.payeeId)===String(id)||String(row.parentId)===String(id))});},
  async confirmBills(){
    if(await this.action(async({user,scope})=>{
      if(!permissions.isAdmin(user)||!this.data.acknowledged||!this.data.report||this._reportPeriod.from!==this.data.from||this._reportPeriod.to!==this.data.to)throw new Error('请核对本期全部明细并勾选确认');
      await actions.post(this,'/modules/zhihu/workbench/confirm',{...scope,...this._reportPeriod,reviewHash:this.data.report.reviewHash,acknowledged:true});
    },'本期可结算账单已确认'))await this.load();
  },
  async releaseFunding(){
    if(await this.action(async({user,scope})=>{
      if(!permissions.isAdmin(user)||!this.data.view?.canManage||!this.data.fundingAcknowledged||!this.data.reference.trim())throw new Error('请核对待开放总额并填写到账凭据');
      await actions.post(this,'/core/finance/funding',{...scope,moduleId:'zhihu',hash:this.data.view.funding.hash,reference:this.data.reference.trim()});
    },'已核对的款项已开放提现')){this.setData({reference:''});await this.load();}
  },
}));
