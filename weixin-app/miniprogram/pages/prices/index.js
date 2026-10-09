const screen=require('../../utils/screen');
const request=require('../../utils/request');
const permissions=require('../../utils/permissions');
const web=require('../../utils/web-link');
Page(screen('prices',{
  data:{list:[],metrics:[],businessDate:'',search:''},
  async fetch({user,scope}){
    if(permissions.isAdmin(user)){
      const data=await request.get('/core/rates',{projectId:scope.projectId,moduleId:'zhihu'});
      return {businessDate:data.businessDate,total:0,list:[],metrics:data.metrics.map(metric=>({...metric,versions:data.versions.filter(v=>v.metricType===metric.code).map(v=>({...v,
        ruleLabel:metric.rules.find(rule=>rule.code===v.ruleCode)?.label||'适用规则',
        state:v.effectiveFrom>data.businessDate?'待生效':v.effectiveTo&&v.effectiveTo<=data.businessDate?'已结束':'当前有效'}))}))};
    }
    const data=await request.get('/core/tasks',{...scope,page:this.data.page,pageSize:20,view:'owned',search:this.data.search.trim()});
    const group=data.groups.find(g=>String(g.accountId)===String(scope.accountId)&&String(g.projectId)===String(scope.projectId)&&g.moduleId==='zhihu');
    if(!group||group.status!=='ready')throw new Error('适用单价暂时没加载出来，请刷新重试');
    return {list:group.list.map(row=>({...row,prices:row.metrics.filter(m=>m.label.includes('单价')||m.label.includes('分成'))})),total:group.total,metrics:[]};
  },
  search(){this.setData({page:1});return this.load();},
  web(){web.copy(this,'prices');},
  keywords(){if(this.canAct())wx.navigateTo({url:'/pages/keywords/index'});},
}));
