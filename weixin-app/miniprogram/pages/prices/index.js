const screen=require('../../utils/screen');
const request=require('../../utils/request');
const web=require('../../utils/web-link');
Page(screen('prices',{
  data:{metrics:[],businessDate:''},
  async fetch({scope}){
    const data=await request.get('/core/rates',{projectId:scope.projectId,moduleId:'zhihu'});
    return {businessDate:data.businessDate,metrics:data.metrics.map(metric=>({...metric,versions:data.versions.filter(v=>v.metricType===metric.code).map(v=>({...v,
      ruleLabel:metric.rules.find(rule=>rule.code===v.ruleCode)?.label||'适用规则',
      state:v.effectiveFrom>data.businessDate?'待生效':v.effectiveTo&&v.effectiveTo<=data.businessDate?'已结束':'当前有效'}))}))};
  },
  web(){web.copy(this,'prices');},
}));
