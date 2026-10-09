const screen=require('../../utils/screen');
const request=require('../../utils/request');
const actions=require('../../utils/actions');
const nav=require('../../utils/nav');
Page(screen('work-data',{
  infinite:true,
  data:{from:actions.today().slice(0,8)+'01',to:actions.today(),view:'self',summary:null,list:[],views:[],
    activity:null,activityError:'',activityPage:1,activityType:'',activityOwner:'',activityOwnerName:'',activityOpen:false},
  async fetch({scope,user}){
    if(this.data.from>this.data.to)throw new Error('开始日期不能晚于结束日期');
    const views=[{key:'self',label:'我的作品'},...(user.role==='creator'?[]:[user.role==='leader'?{key:'team',label:'团队成员'}:{key:'all',label:'项目全部'}])];
    const view=views.some(v=>v.key===this.data.view)?this.data.view:'self';
    const [result,activityResult]=await Promise.all([
      request.get('/modules/zhihu/workbench/work-activity',{...scope,from:this.data.from,to:this.data.to,view,page:this.data.page,pageSize:20}),
      request.get('/core/activity',{...scope,moduleId:'zhihu',from:this.data.from,to:this.data.to,view,page:this.data.activityPage,pageSize:20,
        ...(this.data.activityType?{metricType:this.data.activityType}:{}),...(this.data.activityOwner?{ownerId:this.data.activityOwner}:{})})
        .then(value=>({value})).catch(error=>({error:error.message||'业绩暂时没加载出来，请重试'}))]);
    return {...result,views,view,activity:activityResult.value||null,activityError:activityResult.error||''};
  },
  changeView(e){if(this.data.loading)return;this.setData({view:e.currentTarget.dataset.view,summary:null,list:[],activity:null,activityPage:1,activityOwner:'',activityOwnerName:'',activityOpen:false});return this.load();},
  dateChange(e){this.setData({[e.currentTarget.dataset.name]:e.detail.value,summary:null,list:[],activity:null,activityPage:1});return this.load();},
  activity(e){if(!this.canAct()||this.data.loading)return;const d=e.currentTarget.dataset;this.setData({activityOpen:true,activityPage:1,activityType:d.type||'',activityOwner:d.id||'',activityOwnerName:d.name||''});return this.load();},
  activityPage(e){if(this.data.loading||!this.data.activity)return;const page=this.data.activityPage+Number(e.currentTarget.dataset.step);if(page<1||page>Math.ceil(this.data.activity.total/20))return;this.setData({activityPage:page});return this.load();},
  keyword(e){if(this.canAct())nav.go('/pages/keywords/index?search='+encodeURIComponent(e.currentTarget.dataset.name));},
  works(e){if(!this.canAct()||this.data.loading)return;const d=e.currentTarget.dataset;const q={from:this.data.from,to:this.data.to,view:this.data.view,registeredOnly:'1',...(d.id?{ownerId:d.id,ownerName:d.name}:{}),...(d.result?{result:d.result}:{})};nav.go('/pages/works/index?'+Object.keys(q).map(k=>k+'='+encodeURIComponent(q[k])).join('&'));}
}));
