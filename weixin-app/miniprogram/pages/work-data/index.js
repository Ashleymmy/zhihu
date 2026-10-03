const screen=require('../../utils/screen');
const request=require('../../utils/request');
const actions=require('../../utils/actions');
const nav=require('../../utils/nav');
Page(screen('work-data',{
  infinite:true,
  data:{from:actions.today().slice(0,8)+'01',to:actions.today(),view:'self',summary:null,list:[],views:[]},
  async fetch({scope,user}){
    if(this.data.from>this.data.to)throw new Error('开始日期不能晚于结束日期');
    const views=[{key:'self',label:'我的作品'},...(user.role==='creator'?[]:[user.role==='leader'?{key:'team',label:'团队成员'}:{key:'all',label:'项目全部'}])];
    const view=views.some(v=>v.key===this.data.view)?this.data.view:'self';
    const result=await request.get('/modules/zhihu/workbench/work-activity',{...scope,from:this.data.from,to:this.data.to,view,page:this.data.page,pageSize:20});
    return {...result,views,view};
  },
  changeView(e){if(this.data.loading)return;this.setData({view:e.currentTarget.dataset.view,summary:null,list:[]});return this.load();},
  dateChange(e){this.setData({[e.currentTarget.dataset.name]:e.detail.value,summary:null,list:[]});return this.load();},
  works(e){if(!this.canAct()||this.data.loading)return;const d=e.currentTarget.dataset;const q={from:this.data.from,to:this.data.to,view:this.data.view,registeredOnly:'1',...(d.id?{ownerId:d.id,ownerName:d.name}:{}),...(d.result?{result:d.result}:{})};nav.go('/pages/works/index?'+Object.keys(q).map(k=>k+'='+encodeURIComponent(q[k])).join('&'));}
}));
